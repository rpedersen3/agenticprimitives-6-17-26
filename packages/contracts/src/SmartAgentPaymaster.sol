// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "account-abstraction/core/BasePaymaster.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/interfaces/PackedUserOperation.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./governance/IGovernance.sol";

/**
 * @title SmartAgentPaymaster
 * @notice ERC-4337 paymaster (v0.7+ interface, runs against our v0.9 EntryPoint)
 *         that sponsors gas at the EntryPoint level so users never need ETH.
 *
 * Validation modes (audit C2 — closed in pass 4):
 *   1. **Dev mode** (`_dev=true`): accept every userOp. Local dev /
 *      Anvil only.
 *   2. **Allowlist mode** (`_dev=false` AND `verifyingSigner == address(0)`):
 *      only senders in `_acceptList` are sponsored. Useful when the
 *      set of accounts is bounded + known up front.
 *   3. **Verifying-paymaster mode** (`_dev=false` AND
 *      `verifyingSigner != address(0)`): a designated EOA signs over
 *      `(userOp_canonical, validUntil, validAfter)` off-chain;
 *      `_validatePaymasterUserOp` recovers the signature and accepts
 *      only if it recovers to `verifyingSigner`. Standard production
 *      pattern (Pimlico / Stackup / Alchemy reference); avoids the
 *      per-sender state of allowlist mode while keeping the paymaster
 *      from being drained by arbitrary callers.
 *
 * Wire format of `paymasterAndData` (verifying-paymaster mode):
 * ```
 *   [20 bytes paymaster addr]
 *   [16 bytes paymasterVerificationGasLimit]
 *   [16 bytes paymasterPostOpGasLimit]
 *   [6  bytes validUntil  (uint48 BE)]
 *   [6  bytes validAfter  (uint48 BE)]
 *   [65 bytes ECDSA signature (r,s,v) over getHash(...)]
 * ```
 *
 * Hash signed off-chain (matches the canonical-paymaster reference):
 * ```
 *   keccak256(abi.encode(
 *     sender, nonce, keccak256(initCode), keccak256(callData),
 *     accountGasLimits, preVerificationGas, gasFees,
 *     chainId, address(this), validUntil, validAfter
 *   ))
 * ```
 *
 * Note: the signature itself is NOT in the hash (otherwise recursive).
 * The hash deliberately omits `paymasterAndData` from the userOp
 * because the signature lives there.
 *
 * Construction modes (R5.7 / PKG-PAYMASTER-002 closure — external audit P0-2):
 *   The constructor takes `bool devMode_` + `address verifyingSigner_`
 *   EXPLICITLY. There is no implicit fail-open default; pre-R5.7 the
 *   constructor forcibly set `_dev = true` and production deploys had to
 *   remember to call `setDevMode(false) + setVerifyingSigner(...)` AFTER
 *   the broadcast, which left a window where the paymaster would sponsor
 *   any userOp on the freshly-deployed network. Now: testnet deploys pass
 *   `devMode_=true`; production deploys pass `devMode_=false` with a
 *   verifying signer (or allowlist seed). See `Deploy.s.sol`.
 *
 * Production checklist:
 *   1. Construct with `devMode_=false` AND either:
 *        - a non-zero `verifyingSigner_` for verifying-paymaster mode
 *          (preferred — Pimlico/Stackup/Alchemy pattern), OR
 *        - `verifyingSigner_=address(0)` to start in allowlist mode (no
 *          sender is sponsored until `setAccepted` runs). The fall-back
 *          to allowlist is fail-closed: every userOp reverts with
 *          `SenderNotAccepted` until governance explicitly opts a sender
 *          in. That is the documented safe state.
 *   2. Monitor `getDeposit()` and alert below a runway threshold.
 *   3. PM-2 — hand the Ownable owner to the governance TimelockController via
 *      `Ownable2Step` (`transferOwnership(governance)` then a timelocked
 *      `acceptOwnership`) once deploy-time staking/funding is done. The owner
 *      controls the INHERITED instant `withdrawTo`/stake drains; in production
 *      it MUST be the timelock, not the bootstrap deployer EOA. The
 *      governance-native, TIMELOCKED `scheduleDepositWithdrawal` /
 *      `executeDepositWithdrawal` path below is the sanctioned drain that stays
 *      coupled to governance + delayed regardless of the owner handoff state.
 *      The deployer-owned window is bootstrap-only (tracked under the
 *      governance-key custody item).
 *   4. PM-1 — after governance pauses, call `syncPauseFromGovernance()` (or
 *      `setPauseMirror(true)` from governance) so the validation-time mirror
 *      halts sponsorship. Validation never reads governance storage directly
 *      (ERC-7562), so the mirror must be pushed/synced.
 *
 * @dev Inherits `addStake`, `unlockStake`, `withdrawStake`, `deposit`,
 *      and `withdrawTo` from `BasePaymaster`. Ownable owner is set in
 *      the constructor (Ownable2Step pattern).
 */
contract SmartAgentPaymaster is BasePaymaster {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @notice Whether the paymaster is in dev (accept-all) mode.
    bool private _dev;

    /// @notice Per-sender allow-list for production allowlist mode.
    mapping(address => bool) private _acceptList;

    /// @notice EOA that signs paymaster-validation envelopes off-chain.
    ///         `address(0)` disables verifying mode (allowlist becomes
    ///         the production check). Set via governance.
    address public verifyingSigner;

    /// @notice The Governance contract whose pause flag halts paymaster
    ///         validation. Stored immutable.
    address public immutable governance;

    /// @notice PM-1 — local mirror of the governance pause flag. This is the
    ///         ONLY pause signal read during ERC-4337 validation. Reading the
    ///         external governance contract's storage inside
    ///         `_validatePaymasterUserOp` violates the ERC-7562 validation-scope
    ///         rules (a paymaster may touch only its own / associated storage),
    ///         so reputable bundlers (Pimlico/Stackup/Alchemy) drop the sponsored
    ///         op during simulation. We read this own-storage mirror instead;
    ///         `syncPauseFromGovernance()` — a normal call OUTSIDE validation —
    ///         refreshes it from the canonical governance flag. The mirror is a
    ///         validation-time cache of governance's pause bit, never a second
    ///         independent source (ADR-0013: cache-of-canonical, no fallback).
    bool private _pausedMirror;

    /// @notice PM-2 — a scheduled, governance-authorized EntryPoint-deposit
    ///         withdrawal. The inherited owner `withdrawTo` is an INSTANT drain
    ///         gated only by the Ownable owner; this path couples a withdrawal to
    ///         governance (`onlyGovernance`) AND a fixed timelock, so the
    ///         sponsorship treasury cannot be emptied in a single transaction.
    struct PendingWithdrawal {
        address payable to;
        uint64 eta;
        uint256 amount;
    }
    PendingWithdrawal private _pendingWithdrawal;

    /// @notice PM-2 — delay between scheduling and executing a governance
    ///         deposit withdrawal. Gives the guardian a window to pause if a
    ///         withdrawal is unexpected (incident response).
    uint64 public constant DEPOSIT_WITHDRAWAL_TIMELOCK = 48 hours;

    error SenderNotAccepted(address sender);
    error SystemPaused();
    error ZeroGovernance();
    error NotGovernance();
    error PaymasterDataMalformed();
    error PaymasterSignatureInvalid();
    /// @dev PM-2 withdrawal-lifecycle errors.
    error NoPendingWithdrawal();
    error WithdrawalNotReady(uint64 eta);
    error WithdrawalAmountZero();
    error WithdrawalToZero();

    event DevModeSet(bool dev);
    event SenderAcceptedSet(address indexed sender, bool accepted);
    event VerifyingSignerSet(address indexed oldSigner, address indexed newSigner);
    /// @notice PM-1 — emitted whenever the local pause mirror is updated.
    event PauseMirrorSynced(bool paused, address indexed by);
    /// @notice PM-2 — deposit-withdrawal lifecycle.
    event DepositWithdrawalScheduled(address indexed to, uint256 amount, uint64 eta);
    event DepositWithdrawalExecuted(address indexed to, uint256 amount);
    event DepositWithdrawalCancelled(address indexed to, uint256 amount);

    /// @dev Storage gap reserves slots for future state. Phase A.5 §3.1.
    ///      PM-1/PM-2 consumed 3 slots (`_pausedMirror` packs into 1;
    ///      `PendingWithdrawal` is 2) — gap reduced 49 → 46 to preserve layout.
    uint256[46] private __gap;

    /// @dev Length of the paymaster-data tail when in verifying mode:
    ///      6 (validUntil) + 6 (validAfter) + 65 (sig) = 77 bytes.
    uint256 private constant VERIFYING_PAYMASTER_DATA_LEN = 77;
    /// @dev Offset in `paymasterAndData` where the post-prefix payload
    ///      begins: 20 (paymaster addr) + 16 (verifGas) + 16 (postOpGas).
    uint256 private constant PM_DATA_OFFSET = 52;

    /// @param devMode_           true → accept-all (dev/anvil); false → require
    ///                           verifying-signer or allowlist. R5.7 removed
    ///                           the implicit fail-open default.
    /// @param verifyingSigner_   EOA that signs paymaster envelopes when
    ///                           `devMode_=false`. Pass `address(0)` to start
    ///                           in allowlist mode (fail-closed until
    ///                           `setAccepted` runs).
    constructor(
        IEntryPoint entryPointAddr,
        address initialOwner,
        address governance_,
        bool devMode_,
        address verifyingSigner_
    ) BasePaymaster(entryPointAddr, initialOwner) {
        if (governance_ == address(0)) revert ZeroGovernance();
        governance = governance_;
        _dev = devMode_;
        emit DevModeSet(devMode_);
        if (verifyingSigner_ != address(0)) {
            verifyingSigner = verifyingSigner_;
            emit VerifyingSignerSet(address(0), verifyingSigner_);
        }
    }

    // ─── Admin (governance-only) ────────────────────────────────────────

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    function setDevMode(bool dev) external onlyGovernance {
        _dev = dev;
        emit DevModeSet(dev);
    }

    function setAccepted(address sender, bool accepted) external onlyGovernance {
        _acceptList[sender] = accepted;
        emit SenderAcceptedSet(sender, accepted);
    }

    function setAcceptedBatch(address[] calldata senders, bool accepted) external onlyGovernance {
        for (uint256 i = 0; i < senders.length; i++) {
            _acceptList[senders[i]] = accepted;
            emit SenderAcceptedSet(senders[i], accepted);
        }
    }

    /// @notice Set the EOA that signs paymaster-validation envelopes.
    ///         Pass `address(0)` to disable verifying mode + fall back
    ///         to allowlist (when `_dev=false`).
    function setVerifyingSigner(address newSigner) external onlyGovernance {
        address old = verifyingSigner;
        verifyingSigner = newSigner;
        emit VerifyingSignerSet(old, newSigner);
    }

    // ─── PM-1: pause mirror (own-storage, ERC-7562-compliant) ──────────

    /// @notice PM-1 — refresh the local pause mirror from the canonical
    ///         governance flag. Permissionless ON PURPOSE: validation may not
    ///         read governance storage, so the mirror must be refreshable by
    ///         anyone (a keeper, a bundler, the guardian's incident response)
    ///         the moment governance pauses. This call is a NORMAL transaction
    ///         (not paymaster validation), so the ERC-7562 scope rules don't
    ///         apply to its cross-contract read. The mirror only ever holds the
    ///         canonical governance value — no independent pause source.
    function syncPauseFromGovernance() external {
        bool p = _governanceIsPaused();
        _pausedMirror = p;
        emit PauseMirrorSynced(p, msg.sender);
    }

    /// @notice PM-1 — direct governance push of the pause mirror, for when
    ///         governance wants to halt sponsorship without depending on a
    ///         third party to sync. `onlyGovernance` ⇒ inherits the 24h
    ///         timelock (or guardian-driven governance flow).
    function setPauseMirror(bool paused_) external onlyGovernance {
        _pausedMirror = paused_;
        emit PauseMirrorSynced(paused_, msg.sender);
    }

    /// @notice The pause bit read during validation (the local mirror).
    function paused() external view returns (bool) {
        return _pausedMirror;
    }

    /// @dev Read the canonical governance pause flag. Used ONLY by the
    ///      out-of-band sync path, never during validation. Mirrors the prior
    ///      defensive decode: a non-conforming governance (EOA / missing fn)
    ///      reads as "not paused" so legacy / test deploys keep working.
    function _governanceIsPaused() internal view returns (bool) {
        if (governance.code.length == 0) return false;
        (bool ok, bytes memory data) = governance.staticcall(
            abi.encodeWithSelector(IGovernanceView.isPaused.selector)
        );
        return ok && data.length >= 32 && abi.decode(data, (bool));
    }

    // ─── PM-2: governance-timelocked deposit withdrawal ────────────────

    /// @notice PM-2 — schedule a governance-authorized withdrawal of the
    ///         EntryPoint deposit. Coupled to governance AND delayed by
    ///         `DEPOSIT_WITHDRAWAL_TIMELOCK`, unlike the inherited owner
    ///         `withdrawTo` (instant, owner-only). Overwrites any prior pending
    ///         withdrawal (governance is the single scheduler).
    function scheduleDepositWithdrawal(address payable to, uint256 amount) external onlyGovernance {
        if (to == address(0)) revert WithdrawalToZero();
        if (amount == 0) revert WithdrawalAmountZero();
        uint64 eta = uint64(block.timestamp) + DEPOSIT_WITHDRAWAL_TIMELOCK;
        _pendingWithdrawal = PendingWithdrawal({to: to, eta: eta, amount: amount});
        emit DepositWithdrawalScheduled(to, amount, eta);
    }

    /// @notice PM-2 — execute a previously-scheduled withdrawal once its
    ///         timelock has elapsed. `onlyGovernance` so the same authority
    ///         that scheduled it confirms; the delay gives the guardian time to
    ///         pause if the withdrawal is unexpected.
    function executeDepositWithdrawal() external onlyGovernance {
        PendingWithdrawal memory w = _pendingWithdrawal;
        if (w.eta == 0) revert NoPendingWithdrawal();
        if (block.timestamp < w.eta) revert WithdrawalNotReady(w.eta);
        delete _pendingWithdrawal;
        entryPoint().withdrawTo(w.to, w.amount);
        emit DepositWithdrawalExecuted(w.to, w.amount);
    }

    /// @notice PM-2 — cancel a pending withdrawal (governance de-escalation).
    function cancelDepositWithdrawal() external onlyGovernance {
        PendingWithdrawal memory w = _pendingWithdrawal;
        if (w.eta == 0) revert NoPendingWithdrawal();
        delete _pendingWithdrawal;
        emit DepositWithdrawalCancelled(w.to, w.amount);
    }

    /// @notice PM-2 — view the pending withdrawal (zero `eta` ⇒ none).
    function pendingWithdrawal() external view returns (address to, uint256 amount, uint64 eta) {
        PendingWithdrawal memory w = _pendingWithdrawal;
        return (w.to, w.amount, w.eta);
    }

    // ─── Views ──────────────────────────────────────────────────────────

    function devMode() external view returns (bool) {
        return _dev;
    }

    function isAccepted(address sender) external view returns (bool) {
        return _acceptList[sender];
    }

    /// @notice The canonical hash a verifying signer must sign.
    ///         Off-chain callers compute the same hash + sign via
    ///         EIP-191 ("\x19Ethereum Signed Message:\n32" prefix);
    ///         on-chain validation recovers via that wrapper.
    /// @dev Deliberately omits paymasterAndData (the signature lives
    ///      there) and the userOp.signature (the account signs
    ///      independently). Includes chainId + paymaster address for
    ///      replay protection across chains + deployments.
    function getHash(
        PackedUserOperation calldata userOp,
        uint48 validUntil,
        uint48 validAfter
    ) public view returns (bytes32) {
        // H7-C.7 / CON-PAYMASTER-004: bind `address(entryPoint)` into the
        // signed material so a signed envelope cannot survive an EntryPoint
        // redeploy. Pre-fix, the hash omitted the EntryPoint — a long-lived
        // signed envelope (validUntil in the future) issued against the
        // current EntryPoint would have been verifiable against a NEW
        // EntryPoint deployed at a different address, allowing cross-deployment
        // replay until validUntil elapses.
        return keccak256(
            abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                block.chainid,
                address(this),
                address(entryPoint()), // H7-C.7 binding
                validUntil,
                validAfter
            )
        );
    }

    // ─── Paymaster hook ────────────────────────────────────────────────

    /// @inheritdoc BasePaymaster
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 /*userOpHash*/,
        uint256 /*maxCost*/
    ) internal view override returns (bytes memory context, uint256 validationData) {
        // PM-1 / H7-C.10 / EXT3-010: gated behind the system-wide governance
        // pause — but read from the LOCAL mirror (`_pausedMirror`), never the
        // external governance contract's storage. A cross-contract staticcall
        // here violates the ERC-7562 validation-scope rules and gets the op
        // dropped by bundlers. The mirror is refreshed out-of-band via
        // `syncPauseFromGovernance()` (a normal call) or `setPauseMirror()`.
        if (_pausedMirror) revert SystemPaused();

        if (_dev) {
            // Dev mode: accept all. validationData = 0 → "valid sig,
            // valid indefinitely".
            return ("", 0);
        }

        // Production. Prefer verifying-paymaster when a signer is
        // configured; fall back to the legacy allowlist otherwise.
        if (verifyingSigner != address(0)) {
            // Parse paymasterData tail.
            if (userOp.paymasterAndData.length < PM_DATA_OFFSET + VERIFYING_PAYMASTER_DATA_LEN) {
                revert PaymasterDataMalformed();
            }
            bytes calldata payData = userOp.paymasterAndData[PM_DATA_OFFSET:];
            uint48 validUntil = uint48(bytes6(payData[0:6]));
            uint48 validAfter = uint48(bytes6(payData[6:12]));
            bytes calldata signature = payData[12:VERIFYING_PAYMASTER_DATA_LEN];

            bytes32 hash = getHash(userOp, validUntil, validAfter);
            // EIP-191 wrap matches what KMS-backed `signMessage({raw})`
            // produces via the v0.7 reference paymaster convention.
            bytes32 ethHash = hash.toEthSignedMessageHash();
            // R6.3: third return (sigVersion) intentionally discarded; the explicit `err` + `recovered != verifyingSigner` revert IS the auth.
            // slither-disable-next-line unused-return
            (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(ethHash, signature);
            if (err != ECDSA.RecoverError.NoError || recovered != verifyingSigner) {
                // Returning sigFailed=true (per EntryPoint convention)
                // is the canonical way to signal sig invalid; we revert
                // explicitly for a clearer error in tests + tools.
                revert PaymasterSignatureInvalid();
            }
            // Encode (sigFailed=false, validUntil, validAfter) into validationData.
            return ("", _packValidationData(false, validUntil, validAfter));
        }

        // Fallback: allowlist mode.
        if (!_acceptList[userOp.sender]) revert SenderNotAccepted(userOp.sender);
        return ("", 0);
    }

    /// @dev v0.7 EntryPoint convention. Bits 0: sigFailed,
    ///      [1..49]: validUntil, [50..98]: validAfter (or similar).
    ///      We use the simple packing: aggregator addr (160 bits, 0),
    ///      validUntil (48 bits), validAfter (48 bits).
    function _packValidationData(
        bool sigFailed,
        uint48 validUntil,
        uint48 validAfter
    ) internal pure returns (uint256) {
        return
            (sigFailed ? 1 : 0) |
            (uint256(validUntil) << 160) |
            (uint256(validAfter) << (160 + 48));
    }

    /// @inheritdoc BasePaymaster
    /// @dev No per-call accounting. No-op so EntryPoint can safely
    ///      call us if it ever does (it won't — we return empty context).
    function _postOp(
        PostOpMode /*mode*/,
        bytes calldata /*context*/,
        uint256 /*actualGasCost*/,
        uint256 /*actualUserOpFeePerGas*/
    ) internal pure override {
        // intentionally empty
    }
}
