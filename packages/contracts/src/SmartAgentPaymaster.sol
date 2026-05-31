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
 * Production checklist:
 *   1. Call `setDevMode(false)` (governance only) to leave dev mode.
 *   2. Call `setVerifyingSigner(<KMS-backed signer addr>)` to enable
 *      verifying-paymaster mode (preferred). OR populate `_acceptList`
 *      via `setAccepted` if you want allowlist mode.
 *   3. Monitor `getDeposit()` and alert below a runway threshold.
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

    error SenderNotAccepted(address sender);
    error SystemPaused();
    error ZeroGovernance();
    error NotGovernance();
    error PaymasterDataMalformed();
    error PaymasterSignatureInvalid();

    event DevModeSet(bool dev);
    event SenderAcceptedSet(address indexed sender, bool accepted);
    event VerifyingSignerSet(address indexed oldSigner, address indexed newSigner);

    /// @dev Storage gap reserves slots for future state. Phase A.5 §3.1.
    uint256[49] private __gap;

    /// @dev Length of the paymaster-data tail when in verifying mode:
    ///      6 (validUntil) + 6 (validAfter) + 65 (sig) = 77 bytes.
    uint256 private constant VERIFYING_PAYMASTER_DATA_LEN = 77;
    /// @dev Offset in `paymasterAndData` where the post-prefix payload
    ///      begins: 20 (paymaster addr) + 16 (verifGas) + 16 (postOpGas).
    uint256 private constant PM_DATA_OFFSET = 52;

    constructor(
        IEntryPoint entryPointAddr,
        address initialOwner,
        address governance_
    ) BasePaymaster(entryPointAddr, initialOwner) {
        if (governance_ == address(0)) revert ZeroGovernance();
        governance = governance_;
        _dev = true;
        emit DevModeSet(true);
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
        // H7-C.10 / EXT3-010: gated behind system-wide governance pause.
        // Skipped when `governance` is an EOA or non-conforming contract
        // (legacy / test deploys); production deploys MUST pass an
        // AgenticGovernance address, which the production-deploy preflight
        // (`check:production-deploy`) enforces.
        if (governance.code.length > 0) {
            (bool ok, bytes memory data) = governance.staticcall(
                abi.encodeWithSelector(IGovernanceView.isPaused.selector)
            );
            if (ok && data.length >= 32 && abi.decode(data, (bool))) revert SystemPaused();
        }

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
