// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "account-abstraction/core/BaseAccount.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/interfaces/PackedUserOperation.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "./IAgentAccount.sol";
import "./libraries/SignatureSlotRecovery.sol";
import "./libraries/WebAuthnLib.sol";

/// @dev Minimal subset of AgentAccountFactory's surface used by the
///      account to look up factory-scoped capability roles. We avoid a
///      hard import of AgentAccountFactory to prevent a circular type
///      dependency at compile time.
interface IAgentAccountFactoryView {
    function bundlerSigner() external view returns (address);
    function sessionIssuer() external view returns (address);
}

/**
 * @title AgentAccount
 * @notice ERC-4337 + UUPS-upgradeable smart account — agent identity anchor.
 *
 * The agent address IS the identity (did:ethr:<chainId>:<address>).
 * UUPS upgradeability means the implementation can evolve without
 * changing the proxy address or losing state.
 *
 * Upgrade authorization: only the account itself (via UserOp or self-call).
 * This follows the MetaMask DeleGator pattern for upgradeable smart accounts.
 *
 * Supports:
 * - Multi-owner with ERC-1271 signature validation
 * - ERC-4337 UserOp validation
 * - ERC-7710 delegated execution via DelegationManager
 * - UUPS upgrades (ERC-1822)
 */
contract AgentAccount is
    BaseAccount,
    Initializable,
    UUPSUpgradeable,
    ReentrancyGuard,
    IAgentAccount,
    IERC1271,
    IERC165,
    IAgenticPrimitivesAgentAccount
{
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @dev ERC-1271 magic value for valid signature
    bytes4 internal constant ERC1271_MAGIC_VALUE = 0x1626ba7e;

    /// @dev The ERC-4337 EntryPoint contract
    IEntryPoint private immutable _entryPoint;

    /// @dev Authorized DelegationManager (ERC-7710 executor)
    address private _delegationManager;

    /// @dev External custodian set — addresses outside our own
    ///      AgentAccount system that can sign for this account. Holds
    ///      EOAs (SIWE) and third-party smart wallets (Safe, Argent,
    ///      Privy, …). Per spec 211 § 3 / spec 212 § 2.2, an
    ///      agenticprimitives AgentAccount must NEVER appear here —
    ///      enforced at runtime by `addCustodian` via the ERC-165
    ///      `IAgenticPrimitivesAgentAccount` marker. Passkey custodians
    ///      live in the namespaced `_passkeyStorage().piaToCredentialId`
    ///      mapping; the unified view is exposed via `isCustodian` and
    ///      `custodianCount`.
    /// @dev internal (not private) so test harnesses can subclass + seed
    ///      this state for policy tests. Storage layout is unaffected
    ///      by visibility.
    mapping(address => bool) internal _externalCustodians;
    uint256 internal _externalCustodianCount;

    /// @dev Spec 007 Phase A — the factory that deployed this account.
    ///      `bundlerSigner()` and `sessionIssuer()` are read off this
    ///      address on each capability check, so a future factory
    ///      upgrade can rotate either role without per-account
    ///      migration. Set once during `initialize`. Zero is tolerated
    ///      for legacy / direct-deploy paths (no bundler envelope path
    ///      enabled).
    address private _factory;

    /// @dev Spec 007 Phase A (Variant B) — set of session-delegation
    ///      hashes the owner has pre-authorized on chain. The
    ///      DelegationManager consults this set at redeem time when a
    ///      high-risk session is in play; this is the on-chain
    ///      counterpart to the off-chain caveated delegation used in
    ///      Variant A.
    mapping(bytes32 => bool) private _acceptedSessionDelegations;

    /// @dev Spec 007 Phase A.5 — optional per-account upgrade delay
    ///      (seconds). 0 (default) keeps backward-compat: upgrades fire
    ///      immediately on owner sig. Owners can opt in to a delay via
    ///      `setUpgradeTimelock`.
    uint256 private _upgradeTimelock;

    struct PendingUpgrade {
        address newImplementation;
        uint64 readyAt;        // UNIX seconds; 0 = no pending upgrade
    }

    /// @dev Spec 007 Phase A.5 — current pending upgrade (set by
    ///      `upgradeToWithAuthorization` when `_upgradeTimelock > 0`).
    PendingUpgrade private _pendingUpgrade;

    /// @dev Spec 007 Phase A.5 — maximum permitted upgrade timelock to
    ///      protect against an owner accidentally setting an absurdly
    ///      large delay that bricks future migrations.
    uint256 internal constant MAX_UPGRADE_TIMELOCK = 30 days;

    /// @dev Spec 007 Phase A.5 (SC7 § 3.1) — storage gap reserves 50
    ///      slots after the last linear-layout state variable. Future
    ///      additive upgrades shrink the gap by however many slots they
    ///      add. ERC-7201 namespaced state (passkeys, modules) lives at
    ///      keccak-computed slots and is NOT in this linear layout.
    uint256[50] private __gap;

    // ─── Errors ─────────────────────────────────────────────────────

    error NotFromSelf();
    error NotCustodianOrSelf();
    error CustodianAlreadyExists(address owner);
    error CustodianDoesNotExist(address owner);
    error CannotRemoveLastCustodian();
    error ZeroAddress();
    error PasskeyAlreadyRegistered(bytes32 credentialIdDigest);
    error PasskeyNotRegistered(bytes32 credentialIdDigest);
    /// @dev Contract audit C-6: `bytes32(0)` is the absence sentinel in
    ///      `piaToCredentialId`. Registering a passkey with a zero
    ///      digest poisons the mapping — count++ but isCustodian(pia)
    ///      returns false because `piaToCredentialId[pia] == 0`. Reject
    ///      at every entry point that writes the digest.
    error InvalidCredentialIdDigest();
    error InvalidPasskeyPublicKey();
    /// @notice H7-C.1 / CON-WEBAUTHN-001 — addPasskey was called with rpIdHash == bytes32(0).
    error InvalidRpIdHash();
    error CannotRemoveLastSigner();
    error UnknownSignatureType(uint8 sigType);
    error AgenticPrimitivesAgentNotAllowedAsCustodian(address candidate);

    // Phase A errors (spec 007).
    error NotEntryPoint();
    error NotBundler();
    error NotOwnerSig();
    error InvalidInnerSignature();
    error FactoryNotSet();
    error SessionDelegationAlreadyAccepted(bytes32 hash);

    // Phase A.5 errors (spec 007).
    error UpgradeTimelockTooLong(uint256 secs, uint256 max);
    error NoPendingUpgrade();
    error UpgradeNotReady(uint64 readyAt, uint256 nowTs);
    error PendingUpgradeMismatch(address pending, address attempted);
    error UpgradePending();

    // Wave 2A — on-chain authority closure (contract audit C-1..C-3).
    error ValidatorRequired();
    error LegacyUpgradePathDisabled();
    error ModuleOperationNotAllowed();

    /// @notice Emitted when `setDelegationManager` rotates the DM via a
    ///         self-call (the only authorized path post-Wave-2A).
    event DelegationManagerRotated(address indexed newDelegationManager);

    // ─── Phase A events ─────────────────────────────────────────────

    /// @notice Emitted by `acceptSessionDelegation` — the owner has
    ///         registered the given session-delegation hash on chain.
    event SessionDelegationAccepted(bytes32 indexed sessionDelegationHash);

    /// @notice Emitted by `upgradeToWithAuthorization` after the owner
    ///         signature is verified, before the underlying UUPS
    ///         upgrade fires. Provides an auditable on-chain witness
    ///         that THIS specific owner authorized the upgrade.
    event UpgradeAuthorized(address indexed newImplementation);

    /// @notice Emitted when an owner queues an upgrade that has to wait
    ///         out the per-account timelock (Phase A.5).
    event UpgradeProposed(address indexed newImplementation, uint64 readyAt);

    /// @notice Emitted when the queued upgrade is cancelled by the owner
    ///         during the wait window.
    event UpgradeCancelled(address indexed newImplementation);

    /// @notice Emitted when the per-account upgrade timelock is changed.
    event UpgradeTimelockChanged(uint256 oldValue, uint256 newValue);

    // ─── Modifiers ──────────────────────────────────────────────────

    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotFromSelf();
        _;
    }

    // ─── Constructor / Initializer ──────────────────────────────────

    constructor(IEntryPoint entryPoint_) {
        _entryPoint = entryPoint_;
        _disableInitializers();
    }

    /**
     * @notice Unified initializer (phase 6f.4 pivot).
     *
     *         Bootstraps an AgentAccount with any combination of
     *         external custodians (EOAs / SIWE / third-party smart
     *         wallets) and an initial passkey credential. At least one
     *         must be supplied — an account with no signer would be
     *         bricked.
     *
     *         Each external custodian is checked against the ERC-165
     *         `IAgenticPrimitivesAgentAccount` marker: any address that
     *         responds positively is rejected. This enforces spec 211
     *         § 3 / spec 212 § 2.2 — an agenticprimitives AgentAccount
     *         can never be a custodian of another. Smart-agent ↔
     *         smart-agent relationships move into stewardship /
     *         delegation territory.
     *
     *         When `passkeyX != 0 && passkeyY != 0`, the passkey is
     *         registered and its PIA (derived from the pubkey) becomes
     *         a first-class custodian via the namespaced passkey
     *         storage. The PIA's "membership" is unified with
     *         `_externalCustodians` via `isCustodian` / `custodianCount`.
     *
     * @param externalCustodians Initial set of external custodian
     *        addresses (zero or more EOAs / third-party smart wallets).
     * @param passkeyCredentialIdDigest keccak256(credentialId) of the
     *        initial passkey (or `bytes32(0)` to skip).
     * @param passkeyX P-256 X coordinate (or 0 to skip the passkey).
     * @param passkeyY P-256 Y coordinate (or 0 to skip).
     * @param passkeyRpIdHash `sha256(rpId)` for the initial passkey (or
     *        `bytes32(0)` to skip — required to be non-zero when the
     *        passkey is present; H7-C.1 / CON-WEBAUTHN-001).
     * @param dm DelegationManager address (or `address(0)`).
     * @param factory_ The factory that deployed this account.
     */
    function initialize(
        address[] calldata externalCustodians,
        bytes32 passkeyCredentialIdDigest,
        uint256 passkeyX,
        uint256 passkeyY,
        bytes32 passkeyRpIdHash,
        address dm,
        address factory_
    ) external initializer {
        // H7-C.5: passkey setup factored into `_setupInitialPasskey` to keep
        // `initialize`'s local-variable count below the `via_ir`-off stack
        // limit. `forge coverage` builds without `via_ir`; this lets the
        // coverage build compile (closes XCON-002).
        bool withPasskey = passkeyX != 0 && passkeyY != 0;
        if (externalCustodians.length == 0 && !withPasskey) {
            revert ZeroAddress();
        }

        for (uint256 i; i < externalCustodians.length; i++) {
            address c = externalCustodians[i];
            if (c == address(0)) revert ZeroAddress();
            if (_externalCustodians[c]) revert CustodianAlreadyExists(c);
            if (_isAgenticPrimitivesAgent(c)) {
                revert AgenticPrimitivesAgentNotAllowedAsCustodian(c);
            }
            _externalCustodians[c] = true;
            emit CustodianAdded(c);
        }
        _externalCustodianCount = externalCustodians.length;

        if (withPasskey) {
            _setupInitialPasskey(passkeyCredentialIdDigest, passkeyX, passkeyY, passkeyRpIdHash);
        }

        _delegationManager = dm;
        _factory = factory_;
    }

    /// @dev H7-C.5 — passkey-init body extracted so `initialize` stays below
    ///      the via-IR-off stack limit (lets `forge coverage` compile).
    ///      Behavior unchanged from the prior inline block.
    function _setupInitialPasskey(
        bytes32 credIdDigest,
        uint256 x,
        uint256 y,
        bytes32 rpIdHash
    ) internal {
        // Audit C-6: reject zero digest at every passkey-write site.
        if (credIdDigest == bytes32(0)) revert InvalidCredentialIdDigest();
        // H7-C.1 / CON-WEBAUTHN-001: zero rpIdHash would let the verifier
        // accept any RP (kills the pin).
        if (rpIdHash == bytes32(0)) revert InvalidRpIdHash();
        PasskeyStorage storage $ = _passkeyStorage();
        address pia = _passkeyIdentity(x, y);
        // Architectural invariant: a PIA never appears in both the
        // external-custodian set AND the passkey set.
        if (_externalCustodians[pia]) {
            revert CustodianAlreadyExists(pia);
        }
        $.keys[credIdDigest] = PasskeyEntry(x, y);
        $.registered[credIdDigest] = true;
        $.piaToCredentialId[pia] = credIdDigest;
        $.rpIdHashOf[credIdDigest] = rpIdHash;
        $.count = 1;
        emit PasskeyAdded(credIdDigest, x, y, rpIdHash);
        emit CustodianAdded(pia);
    }

    // ─── Custody-policy initializer (relocated) ──────────────────────
    //
    // `initializeWithThresholdPolicy` + the default-approvals matrix
    // were relocated in phase 6c.5-d.1 and renamed in phase 6g.1. The
    // CustodyPolicy module's `onInstall` is now the per-account init
    // path: factory deploys account → installs the policy with
    // ABI-encoded init data (mode, trustees, approvalsRequiredByTier,
    // safetyDelayByTier, T3 ceiling, ApprovedHashRegistry address). The
    // default-approvals matrix from spec § 5.1 is exposed by
    // `CustodyPolicy.defaultApprovals`.
    // ─── UUPS Upgrade ──────────────────────────────────────────────

    /**
     * @dev Spec 007 Phase A — `_authorizeUpgrade` requires `msg.sender
     *      == address(this)`. The ONLY path that satisfies this is a
     *      re-entrant call from `upgradeToWithAuthorization` (below),
     *      which verifies an explicit owner signature first. Direct
     *      callers of `upgradeToAndCall` cannot satisfy `onlySelf` and
     *      will revert here. Master / bundler / session-issuer
     *      therefore cannot upgrade even by submitting the tx.
     */
    function _authorizeUpgrade(address) internal view override onlySelf {}

    /**
     * @notice DEPRECATED — single-signature upgrade path (contract audit C-3).
     *
     * @dev The legacy behavior verified ONE ECDSA signature against any
     *      external custodian. For multi-custodian / treasury / org
     *      accounts that meant a single compromised key could swap the
     *      implementation out from under the entire custody quorum —
     *      catastrophic. Removed entirely.
     *
     *      Per-account upgrade paths post-Wave-2A:
     *        - Person accounts (single custodian, no CustodyPolicy):
     *          submit an owner-signed UserOp that calls
     *          `upgradeToAndCall(newImpl, "")` from `address(this)`.
     *        - Multi-custodian accounts with CustodyPolicy installed:
     *          route through `CustodyPolicy.ApplySystemUpdate` which
     *          requires the full T4/T5 quorum + timelock + audit and
     *          dispatches a self-call into `upgradeToAndCall`.
     *
     *      The function is retained for ABI compat (tooling that probes
     *      the selector won't break) but always reverts.
     */
    function upgradeToWithAuthorization(address /* newImpl */, bytes calldata /* ownerSig */) external pure {
        revert LegacyUpgradePathDisabled();
    }

    /// @notice Execute a previously-queued upgrade. Permissionless once
    ///         the timelock has expired — anyone can pay the gas, but
    ///         the implementation address was bound at queue time.
    function executePendingUpgrade() external {
        PendingUpgrade memory p = _pendingUpgrade;
        if (p.readyAt == 0) revert NoPendingUpgrade();
        if (block.timestamp < p.readyAt) revert UpgradeNotReady(p.readyAt, block.timestamp);
        // Clear pending BEFORE the upgrade fires so a misbehaving new
        // impl can't replay this state.
        delete _pendingUpgrade;
        emit UpgradeAuthorized(p.newImplementation);
        this.upgradeToAndCall(p.newImplementation, "");
    }

    /// @notice Cancel a queued upgrade during the timelock window. Owner
    ///         signs a digest that binds to the pending implementation
    ///         AND `address(this)` + chain id, preventing cross-account
    ///         replay of a cancel-grant.
    /// @param ownerSig Owner ECDSA signature over `keccak256(abi.encode(
    ///                 "UPGRADE_CANCEL", _pendingUpgrade.newImplementation,
    ///                 address(this), block.chainid))`.
    function cancelPendingUpgrade(bytes calldata ownerSig) external {
        PendingUpgrade memory p = _pendingUpgrade;
        if (p.readyAt == 0) revert NoPendingUpgrade();
        bytes32 digest = keccak256(
            abi.encode(
                bytes32("UPGRADE_CANCEL"),
                p.newImplementation,
                address(this),
                block.chainid
            )
        );
        if (!_verifyEcdsa(digest, ownerSig)) revert NotOwnerSig();
        delete _pendingUpgrade;
        emit UpgradeCancelled(p.newImplementation);
    }

    /// @notice Configure the per-account upgrade timelock (seconds).
    ///         Settable only via a userOp the owner signed
    ///         (`onlySelf`). 0 == immediate upgrades (default,
    ///         backward-compat).
    function setUpgradeTimelock(uint256 secs) external onlySelf {
        if (secs > MAX_UPGRADE_TIMELOCK) {
            revert UpgradeTimelockTooLong(secs, MAX_UPGRADE_TIMELOCK);
        }
        uint256 old = _upgradeTimelock;
        _upgradeTimelock = secs;
        emit UpgradeTimelockChanged(old, secs);
    }

    /// @notice Current per-account upgrade timelock (seconds).
    function upgradeTimelock() external view returns (uint256) {
        return _upgradeTimelock;
    }

    /// @notice Current pending-upgrade state.
    function pendingUpgrade() external view returns (address newImpl, uint64 readyAt) {
        PendingUpgrade memory p = _pendingUpgrade;
        return (p.newImplementation, p.readyAt);
    }

    /// @notice Returns the current implementation version.
    function version() external pure returns (string memory) {
        return "2.2.0";
    }

    // ─── Delegation Manager (ERC-7710) ─────────────────────────────

    /**
     * @notice Set the DelegationManager authorized to execute on behalf of this account.
     *         Per contract audit C-1: this MUST be `onlySelf`. Previously any
     *         external custodian could call this directly, then point at an
     *         attacker-controlled manager that calls back through
     *         `account.execute(...)` — bypassing CustodyPolicy quorum + timelock
     *         entirely. A single custodian on a multi-sig account was a
     *         catastrophic escape hatch.
     *
     *         For initial wiring the factory routes through the unified
     *         initializer (which sets `_delegationManager` directly). For
     *         post-deploy rotation, route through
     *         `CustodyPolicy.RotateDelegationManager`, which requires the
     *         account's full T4 quorum + timelock + audit, then dispatches
     *         a self-call into this function.
     */
    function setDelegationManager(address dm) external onlySelf {
        if (dm.code.length == 0) revert ValidatorRequired();
        _delegationManager = dm;
        emit DelegationManagerRotated(dm);
    }

    /// @notice Get the currently authorized DelegationManager.
    function delegationManager() external view returns (address) {
        return _delegationManager;
    }

    // ─── Phase A — capability roles (factory-scoped) ───────────────

    /// @notice Address of the factory that deployed this account.
    function factory() external view returns (address) {
        return _factory;
    }

    /// @notice Bundler signer address. Resolved through the factory so
    ///         a factory upgrade can rotate this without per-account
    ///         migration. Returns address(0) if no factory is set
    ///         (legacy / direct-deploy path).
    function bundlerSigner() public view returns (address) {
        if (_factory == address(0)) return address(0);
        return IAgentAccountFactoryView(_factory).bundlerSigner();
    }

    /// @notice Session-issuer address. Same factory-indirect pattern.
    function sessionIssuer() public view returns (address) {
        if (_factory == address(0)) return address(0);
        return IAgentAccountFactoryView(_factory).sessionIssuer();
    }

    /// @notice True iff the owner has pre-authorized the given
    ///         session-delegation hash on chain (Variant B).
    function hasAcceptedSessionDelegation(bytes32 sessionDelegationHash) external view returns (bool) {
        return _acceptedSessionDelegations[sessionDelegationHash];
    }

    /**
     * @notice Pre-authorize an on-chain session delegation (Variant B).
     *
     *         For high-risk sessions (per spec 007 § D2), the user
     *         signs an EIP-712 message authorising a specific session
     *         delegation hash and submits a userOp that calls this
     *         function. Subsequent session userOps recover their
     *         authority by consulting this set.
     *
     *         The hash itself is opaque to AgentAccount; it MUST
     *         encode the session key, scope, expiry and any other
     *         binding fields. Off-chain layer (DelegationManager)
     *         validates the shape.
     *
     *         Authorization gate: `msg.sender == address(this)`. The
     *         only way to reach this is a userOp signed by an owner
     *         and routed through `execute` → self-call. Master /
     *         bundler / session-issuer cannot register a session by
     *         themselves; they can only submit a userOp the user
     *         already signed.
     *
     * @param sessionDelegationHash The keccak256 hash of the session
     *                              delegation the owner has authorized.
     */
    function acceptSessionDelegation(bytes32 sessionDelegationHash) external onlySelf {
        if (_acceptedSessionDelegations[sessionDelegationHash]) {
            revert SessionDelegationAlreadyAccepted(sessionDelegationHash);
        }
        _acceptedSessionDelegations[sessionDelegationHash] = true;
        emit SessionDelegationAccepted(sessionDelegationHash);
    }

    /**
     * @notice Defense-in-depth wrapper: verify a bundler-envelope
     *         signature AT THE CONTRACT LAYER, then re-enter the
     *         standard ERC-4337 validation path.
     *
     *         Spec 007 Phase A D3 — `executeFromBundler` is an
     *         ADDITIONAL layer ALONGSIDE the standard EntryPoint flow,
     *         not a replacement. It re-checks at the contract layer
     *         what `apps/a2a-agent/src/routes/onchain-redeem.ts`
     *         already checked off-chain.
     *
     *         Authorization gates:
     *           - `bundlerSig` recovers to `bundlerSigner()` over a
     *             digest binding `userOpHash`, `address(this)`, and
     *             `block.chainid`. Master / random callers cannot
     *             impersonate the bundler.
     *           - The inner `op.signature` is validated against
     *             `_externalCustodians` (or the WebAuthn passkey set) via the
     *             standard `_validateSig` path. The bundler envelope
     *             alone is insufficient.
     *
     *         This function is purely a verification hook: it does
     *         NOT execute the userOp. EntryPoint.handleOps drives
     *         execution as usual. Off-chain bundler-relay code calls
     *         this view first as a sanity gate before submitting to
     *         EntryPoint, and on-chain tooling can call it to assert
     *         the bundler envelope at the contract layer.
     *
     * @param op The packed userOp envelope being submitted.
     * @param userOpHash The hash EntryPoint will compute for `op`.
     *                   Passed by the caller so the contract doesn't
     *                   need to know EntryPoint version semantics; the
     *                   off-chain relay computes it identically.
     * @param bundlerSig The bundler's signature over
     *                   `keccak256(abi.encode("BUNDLER_ENVELOPE",
     *                   userOpHash, address(this), block.chainid))`.
     * @return true if both layers (bundler envelope + inner signature)
     *         validate. Reverts otherwise.
     */
    function executeFromBundler(
        PackedUserOperation calldata op,
        bytes32 userOpHash,
        bytes calldata bundlerSig
    ) external view returns (bool) {
        address bundler = bundlerSigner();
        if (bundler == address(0)) revert FactoryNotSet();

        bytes32 envelopeDigest = keccak256(
            abi.encode(
                bytes32("BUNDLER_ENVELOPE"),
                userOpHash,
                address(this),
                block.chainid
            )
        );
        if (!_verifySignerEcdsa(envelopeDigest, bundlerSig, bundler)) {
            revert NotBundler();
        }
        // Re-verify the inner userOp signature against the owner set.
        // This is what `_validateSignature` does at EntryPoint time;
        // we re-run it here so a misbehaving off-chain relay can't
        // forge a payload past the bundler check.
        if (!_validateSig(userOpHash, op.signature)) {
            revert InvalidInnerSignature();
        }
        return true;
    }

    // ─── ERC-7579 module config (install/uninstall + introspection) ───
    //
    // Phase 3 of the delegation refactor adds first-party module support
    // for stateful policy (spend caps, rate limits, target allowlists,
    // session validators). Modules are isolated in ERC-7201 namespaced
    // storage so future upgrades can extend the layout without clobbering
    // existing state (owners, passkeys, delegationManager).
    //
    // First-party only at v1 — no third-party module registry. Install
    // and uninstall are owner-gated (or self-gated via UserOp). The
    // DelegationManager cannot install modules; module changes are too
    // sensitive to delegate.

    /// @dev ERC-7579 module type IDs (canonical).
    uint256 internal constant MODULE_TYPE_VALIDATOR = 1;
    uint256 internal constant MODULE_TYPE_EXECUTOR  = 2;
    uint256 internal constant MODULE_TYPE_FALLBACK  = 3;
    uint256 internal constant MODULE_TYPE_HOOK      = 4;

    /// @dev Gas-protection cap: a single account can carry at most this many
    ///      hook modules before installModule reverts. Hooks loop per call so
    ///      an unbounded list would let a malicious owner brick their account.
    uint256 internal constant MAX_HOOKS = 8;

    /// @dev ERC-7201 namespaced storage slot for module state.
    ///      slot = keccak256(abi.encode(uint256(keccak256("smart-agent.account.modules.v1")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant MODULES_STORAGE_SLOT =
        0x1f14a6accceab237b8ab0463623403008b2dec742c79d1d0e63a7729f8c11c00;

    struct ModulesStorage {
        // moduleTypeId => module address => installed flag
        mapping(uint256 => mapping(address => bool)) installed;
        // moduleTypeId => ordered list of installed module addresses (for enumeration + hook iteration)
        mapping(uint256 => address[]) installedList;
    }

    function _modulesStorage() private pure returns (ModulesStorage storage $) {
        bytes32 slot = MODULES_STORAGE_SLOT;
        assembly { $.slot := slot }
    }

    // ─── Events ───────────────────────────────────────────────────────

    /// @notice ERC-7579 ModuleInstalled.
    event ModuleInstalled(uint256 moduleTypeId, address module);
    /// @notice ERC-7579 ModuleUninstalled.
    event ModuleUninstalled(uint256 moduleTypeId, address module);

    // ─── Errors ───────────────────────────────────────────────────────

    error UnsupportedModuleType(uint256 moduleTypeId);
    error ModuleAlreadyInstalled(uint256 moduleTypeId, address module);
    error ModuleNotInstalled(uint256 moduleTypeId, address module);
    error TooManyHooks();
    error ModuleOnInstallFailed(bytes reason);
    error ModuleOnUninstallFailed(bytes reason);

    // ─── Auth modifier (post Wave 2A) ─────────────────────────────────
    //
    // Per contract audit C-2: module install/uninstall MUST NOT be
    // callable by an external custodian. Previously any single
    // custodian on a multi-sig account could:
    //   1. Call `installModule(EXECUTOR, attackerContract, data)`.
    //   2. Have the attacker module call `executeFromModule(account, ...)`
    //      against any privileged self-only function (addCustodian,
    //      addPasskey, upgradeToAndCall, …).
    //   3. Drain the account or replace the custodian set.
    //
    // The new gate: only `address(this)` (self-calls routed through the
    // custody quorum + CustodyPolicy.execute) OR the factory ONCE during
    // initial deployment. After the first factory-driven install, the
    // factory exception is consumed and post-deploy module changes can
    // only land via a full self-call.

    /**
     * @notice True once the factory has consumed its one-time module-install
     *         exception. After this flips, the factory is treated like any
     *         non-self caller — `onlySelf` is the only path in.
     */
    bool private _factoryInitConsumed;

    /// @dev Factory's narrow init window: a single install call per
    ///      account, used during the unified deploy tx. After this slot
    ///      flips true, future factory calls are rejected.
    modifier onlySelfOrFactoryInit() {
        if (msg.sender == address(this)) {
            _;
            return;
        }
        if (msg.sender == _factory && !_factoryInitConsumed) {
            _factoryInitConsumed = true;
            _;
            return;
        }
        revert ModuleOperationNotAllowed();
    }

    /**
     * @notice Install an ERC-7579 module of the given type.
     * @dev Owner-gated (or self via UserOp). Calls `onInstall(initData)` on
     *      the module after marking it installed; if the module reverts in
     *      `onInstall`, the install is aborted — but failure is wrapped in
     *      a typed error so the caller can distinguish from auth failures.
     */
    function installModule(
        uint256 moduleTypeId,
        address module,
        bytes calldata initData
    ) external onlySelfOrFactoryInit {
        if (module == address(0)) revert ZeroAddress();
        if (!_isSupportedModuleType(moduleTypeId)) revert UnsupportedModuleType(moduleTypeId);

        ModulesStorage storage $ = _modulesStorage();
        if ($.installed[moduleTypeId][module]) {
            revert ModuleAlreadyInstalled(moduleTypeId, module);
        }
        if (moduleTypeId == MODULE_TYPE_HOOK && $.installedList[moduleTypeId].length >= MAX_HOOKS) {
            revert TooManyHooks();
        }

        $.installed[moduleTypeId][module] = true;
        $.installedList[moduleTypeId].push(module);

        // Notify the module — best-effort wrapped so a misbehaving module
        // produces a typed error instead of bubbling raw bytes. We still
        // revert the install on failure (leaving the storage flag set would
        // create an inconsistent module/`onInstall` state).
        try IERC7579ModuleLike(module).onInstall(initData) {
            // ok
        } catch (bytes memory reason) {
            // Roll back the storage write before reverting.
            $.installed[moduleTypeId][module] = false;
            address[] storage list = $.installedList[moduleTypeId];
            list.pop();
            revert ModuleOnInstallFailed(reason);
        }

        emit ModuleInstalled(moduleTypeId, module);
    }

    /**
     * @notice Uninstall a previously installed ERC-7579 module.
     * @dev Owner-gated. `onUninstall` failure is loud — it reverts. Loud
     *      failure is better than orphan state for security-sensitive
     *      modules (e.g., a spend-cap hook with budget state shouldn't
     *      be removed silently if it can't clean up).
     */
    function uninstallModule(
        uint256 moduleTypeId,
        address module,
        bytes calldata deInitData
    ) external {
        // Post-Wave-2A: uninstall is ALWAYS `onlySelf`. The factory's
        // narrow init exception is install-only — uninstall would be
        // an exit ramp out of the policy stack the factory wired in
        // at deploy time, and there's never a legitimate reason for
        // the factory to do that.
        if (msg.sender != address(this)) revert ModuleOperationNotAllowed();
        if (!_isSupportedModuleType(moduleTypeId)) revert UnsupportedModuleType(moduleTypeId);

        ModulesStorage storage $ = _modulesStorage();
        if (!$.installed[moduleTypeId][module]) {
            revert ModuleNotInstalled(moduleTypeId, module);
        }

        // Loud uninstall — if the module reverts in onUninstall, we revert
        // too so the caller sees the failure. (Owner can force-uninstall
        // by passing deInitData the module can handle, or by re-deploying
        // the account proxy — UUPS is available.)
        try IERC7579ModuleLike(module).onUninstall(deInitData) {
            // ok
        } catch (bytes memory reason) {
            revert ModuleOnUninstallFailed(reason);
        }

        $.installed[moduleTypeId][module] = false;
        _removeFromList($.installedList[moduleTypeId], module);

        emit ModuleUninstalled(moduleTypeId, module);
    }

    /// @notice Returns true iff the given module is installed for the given type.
    /// @dev `additionalContext` accepted for ERC-7579 conformance; unused here.
    function isModuleInstalled(
        uint256 moduleTypeId,
        address module,
        bytes calldata /* additionalContext */
    ) external view returns (bool) {
        return _modulesStorage().installed[moduleTypeId][module];
    }

    /// @notice ERC-7579 supportsModule (introspection).
    function supportsModule(uint256 moduleTypeId) external pure returns (bool) {
        return _isSupportedModuleType(moduleTypeId);
    }

    /// @notice ERC-7579 supportsExecutionMode (introspection).
    /// @dev We support the canonical single-call mode (CALLTYPE_SINGLE, EXECTYPE_DEFAULT).
    ///      We don't expose `execute(bytes32 mode, bytes execData)` (the new ERC-7579
    ///      execution surface) — BaseAccount.execute is the canonical entry. We return
    ///      true here for the encoded form of CALLTYPE_SINGLE so 7579-aware tooling
    ///      can introspect the account before routing through our existing path.
    function supportsExecutionMode(bytes32 /* mode */) external pure returns (bool) {
        // Phase 3 surface — we don't support the multiplexed ERC-7579 execute()
        // entry yet; routing remains via BaseAccount.execute. Return false for
        // any encoded mode to avoid misadvertising capability.
        return false;
    }

    /// @notice Enumerate the installed modules for a given type.
    function getInstalledModules(uint256 moduleTypeId) external view returns (address[] memory) {
        return _modulesStorage().installedList[moduleTypeId];
    }

    /**
     * @notice Stable account-implementation identifier.
     * @dev Bumped to `.3` to signal ERC-7579 `executeFromModule` callback
     *      support shipped in phase 6c.5-d.0 (spec 209).
     */
    function accountId() external pure returns (string memory) {
        return "smart-agent.agent-account.3";
    }

    // ─── ERC-7579 executor callback (spec 209 phase 6c.5-d.0) ─────────

    /// @notice Emitted when an installed executor module successfully
    ///         calls `executeFromModule`.
    event ModuleExecuted(address indexed module, address indexed target, uint256 value);

    error NotInstalledExecutor(address caller);

    /**
     * @notice ERC-7579 executor callback. An installed
     *         `MODULE_TYPE_EXECUTOR` calls this to act on the account's
     *         behalf. When `target == address(this)` the EVM-level call
     *         becomes a self-call (`msg.sender == account` at the
     *         callee), so inner `onlySelf` gates pass without special
     *         dispatch. For external targets the call goes through
     *         directly.
     *
     * @dev Only an installed executor module may call. The
     *      install-permission model IS the gate: install is
     *      `onlyOwnerOrSelf` today and migrates to T5 (quorum + timelock)
     *      in phase 6c.5-d.1 once `CustodyPolicy` lands.
     *
     *      `nonReentrant` guards against an executor calling this
     *      function twice in a single call frame. It shares the
     *      ReentrancyGuard slot with `execute` / `executeBatch`, so a
     *      module cannot route through the account's `execute` — the
     *      module IS the executor; it must call its target directly.
     *
     *      Bubble-revert preserves the inner error selector.
     */
    function executeFromModule(address target, uint256 value, bytes calldata data)
        external
        nonReentrant
        returns (bytes memory)
    {
        ModulesStorage storage $ = _modulesStorage();
        if (!$.installed[MODULE_TYPE_EXECUTOR][msg.sender]) {
            revert NotInstalledExecutor(msg.sender);
        }
        emit ModuleExecuted(msg.sender, target, value);
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
        return ret;
    }

    function _isSupportedModuleType(uint256 moduleTypeId) internal pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR
            || moduleTypeId == MODULE_TYPE_EXECUTOR
            || moduleTypeId == MODULE_TYPE_HOOK;
        // Fallback (type 3) intentionally unsupported in v1 — would require
        // a fallback dispatcher we don't ship yet.
    }

    function _removeFromList(address[] storage list, address module) private {
        uint256 len = list.length;
        for (uint256 i = 0; i < len; i++) {
            if (list[i] == module) {
                if (i != len - 1) list[i] = list[len - 1];
                list.pop();
                return;
            }
        }
        // unreachable — installed flag guarantees presence
    }

    // ─── Hook execution wrapper ───────────────────────────────────────
    //
    // Override BaseAccount.execute to run pre/postCheck on installed hook
    // modules. Authorization (entryPoint / self / delegationManager) is
    // enforced by `_requireForExecute` from BaseAccount unchanged.
    //
    // Hook semantics:
    //   - preCheck runs in install order; each receives (msg.sender, value, msgData).
    //   - The hookData returned by preCheck is fed into postCheck after the call.
    //   - If preCheck reverts the whole execute reverts.
    //   - postCheck only runs on success (the call already reverts on failure).

    /// @inheritdoc BaseAccount
    /// @dev Spec 007 Phase A.5 (SC5 § 6.1) — `nonReentrant` blocks the
    ///      "execute -> target -> execute on the same account" class of
    ///      bugs that downstream stateful enforcers / hooks could enable.
    ///      `_requireForExecute` already restricts callers to
    ///      EntryPoint / self / DelegationManager; the guard hardens
    ///      against a malicious target re-entering through one of those
    ///      callers.
    function execute(address target, uint256 value, bytes calldata data) external override nonReentrant {
        _requireForExecute();

        ModulesStorage storage $ = _modulesStorage();
        address[] memory hooks = $.installedList[MODULE_TYPE_HOOK];
        bytes[] memory hookData = new bytes[](hooks.length);

        // Compose msgData = abi.encodeWithSignature("execute(address,uint256,bytes)", ...)
        // so hook policy can decode the inner call. Easier and cheaper than
        // forwarding msg.data which includes the selector + ABI tail; we
        // rebuild the encoded inner call directly here.
        bytes memory hookMsgData = abi.encode(target, value, data);

        for (uint256 i = 0; i < hooks.length; i++) {
            hookData[i] = IERC7579HookLike(hooks[i]).preCheck(msg.sender, value, hookMsgData);
        }

        // Perform the actual call (mirrors BaseAccount.execute body).
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            // bubble the revert reason
            assembly {
                let len := mload(ret)
                revert(add(ret, 0x20), len)
            }
        }

        for (uint256 i = 0; i < hooks.length; i++) {
            IERC7579HookLike(hooks[i]).postCheck(hookData[i]);
        }
    }

    /// @notice Atomically execute multiple calls from this account.
    /// @dev Overrides BaseAccount.executeBatch to layer the module-hook
    ///      pre/post-check semantics already used by `execute`. Spec 005 —
    ///      pledge honor needs `USDC.transfer(pool, amount)` +
    ///      `PledgeRegistry.recordHonor(...)` in one atomic operation,
    ///      pinned by a `CallDataHashEnforcer` on the redeem path so the
    ///      donor's sub-delegation authorises exactly this calldata.
    ///
    ///      Auth: identical to `execute` — EntryPoint / self / DelegationManager.
    ///      Inner calls run with `msg.sender == address(this)`.
    ///      All-or-nothing: any inner revert bubbles and reverts the batch.
    ///      Pre-hooks run once on the whole batch; post-hooks run on success.
    ///
    ///      Spec 007 Phase A.5 — intentionally NOT `nonReentrant`. The
    ///      DM redeem flow legitimately calls `account.execute(target=self,
    ///      data=executeBatch_calldata)`, which then self-calls into
    ///      `executeBatch`. If both functions held the guard, that
    ///      pattern would revert with `ReentrancyGuardReentrantCall`. The
    ///      OUTER `execute` already holds the guard, so external re-entry
    ///      is blocked; `_requireForExecute` restricts entry to
    ///      EntryPoint / self / DM (DM has its own `nonReentrant`).
    function executeBatch(Call[] calldata calls) external override {
        _requireForExecute();

        ModulesStorage storage $ = _modulesStorage();
        address[] memory hooks = $.installedList[MODULE_TYPE_HOOK];
        bytes[] memory hookData = new bytes[](hooks.length);

        // hookMsgData encodes the full batch so hook policy can inspect
        // every inner call.
        bytes memory hookMsgData = abi.encode(calls);

        for (uint256 i = 0; i < hooks.length; i++) {
            hookData[i] = IERC7579HookLike(hooks[i]).preCheck(msg.sender, 0, hookMsgData);
        }

        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory ret) = calls[i].target.call{ value: calls[i].value }(calls[i].data);
            if (!ok) {
                assembly {
                    let len := mload(ret)
                    revert(add(ret, 0x20), len)
                }
            }
        }

        for (uint256 i = 0; i < hooks.length; i++) {
            IERC7579HookLike(hooks[i]).postCheck(hookData[i]);
        }
    }

    // ─── ERC-4337 ───────────────────────────────────────────────────

    /// @inheritdoc BaseAccount
    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    /// @inheritdoc BaseAccount
    /// @dev Routes on the leading signature-type byte:
    ///        0x00 or bare 65-byte sig → ECDSA (backward-compatible default)
    ///        0x01                      → WebAuthn (abi.encoded Assertion follows)
    ///      Unknown types return SIG_VALIDATION_FAILED rather than reverting
    ///      so the ERC-4337 validation phase stays bundler-friendly.
    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal view override returns (uint256 validationData) {
        return _validateSig(userOpHash, userOp.signature) ? 0 : 1;
    }

    /// @dev Allow execution from EntryPoint, account itself (via UserOp), or DelegationManager (ERC-7710)
    function _requireForExecute() internal view override {
        if (
            msg.sender != address(entryPoint()) &&
            msg.sender != address(this) &&
            msg.sender != _delegationManager
        ) {
            revert NotFromEntryPoint(msg.sender, address(this), address(entryPoint()));
        }
    }

    // ─── ERC-1271 ───────────────────────────────────────────────────

    /// @dev 32-byte ERC-6492 magic suffix — `0x6492…6492` repeated.
    bytes32 private constant ERC6492_MAGIC =
        0x6492649264926492649264926492649264926492649264926492649264926492;

    /// @inheritdoc IERC1271
    /// @dev Tolerates ERC-6492 envelope (stripped first), then routes on the
    ///      leading signature-type byte like _validateSignature does.
    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view override(IAgentAccount, IERC1271) returns (bytes4) {
        bytes memory inner = signature;
        if (signature.length >= 32 && bytes32(signature[signature.length - 32:]) == ERC6492_MAGIC) {
            (, , bytes memory unwrapped) = abi.decode(
                signature[:signature.length - 32],
                (address, bytes, bytes)
            );
            inner = unwrapped;
        }
        return _validateSig(hash, inner) ? ERC1271_MAGIC_VALUE : bytes4(0xffffffff);
    }

    // ─── Signature routing ─────────────────────────────────────────

    uint8 internal constant SIG_TYPE_ECDSA    = 0x00;
    uint8 internal constant SIG_TYPE_WEBAUTHN = 0x01;

    /// @dev Internal dispatcher. Accepts plain 65-byte ECDSA sigs as legacy
    ///      form AND type-prefixed sigs (first byte = SIG_TYPE_*).
    function _validateSig(bytes32 hash, bytes memory sig) internal view returns (bool) {
        // Legacy fast path: bare 65-byte ECDSA sig (no type byte).
        if (sig.length == 65) {
            return _verifyEcdsa(hash, sig);
        }
        if (sig.length < 1) return false;
        uint8 sigType = uint8(sig[0]);
        if (sigType == SIG_TYPE_ECDSA) {
            // 0x00 || <65-byte sig>
            if (sig.length != 66) return false;
            bytes memory inner = new bytes(65);
            for (uint256 i; i < 65; i++) inner[i] = sig[i + 1];
            return _verifyEcdsa(hash, inner);
        }
        if (sigType == SIG_TYPE_WEBAUTHN) {
            // 0x01 || abi.encode(WebAuthnLib.Assertion)
            bytes memory payload = new bytes(sig.length - 1);
            for (uint256 i; i < payload.length; i++) payload[i] = sig[i + 1];
            return _verifyWebAuthn(hash, payload);
        }
        return false;
    }

    function _verifyEcdsa(bytes32 hash, bytes memory sig) internal view returns (bool) {
        // Try raw hash first — matches EntryPoint v0.8 (EIP-712 userOpHash signed directly).
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, sig);
        if (err == ECDSA.RecoverError.NoError && _externalCustodians[recovered]) return true;
        // Fall back to eth-signed-message wrap — matches v0.7 and legacy ERC-1271
        // callers that pre-prefix the digest.
        bytes32 ethSigned = hash.toEthSignedMessageHash();
        (recovered, err,) = ECDSA.tryRecover(ethSigned, sig);
        return err == ECDSA.RecoverError.NoError && _externalCustodians[recovered];
    }

    /// @dev Verify a signature recovers to a SPECIFIC expected signer
    ///      (used by `executeFromBundler` and any future capability
    ///      check that targets a system key, NOT the owner set). Try
    ///      raw hash first then eth-signed wrap, like `_verifyEcdsa`.
    function _verifySignerEcdsa(
        bytes32 hash,
        bytes memory sig,
        address expected
    ) internal pure returns (bool) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, sig);
        if (err == ECDSA.RecoverError.NoError && recovered == expected) return true;
        bytes32 ethSigned = MessageHashUtils.toEthSignedMessageHash(hash);
        (recovered, err,) = ECDSA.tryRecover(ethSigned, sig);
        return err == ECDSA.RecoverError.NoError && recovered == expected;
    }

    /**
     * @dev Audit C-7: malformed `0x01||abi.encode(Assertion)` payloads
     *      previously reverted inside this function during `abi.decode`,
     *      which propagated out of `validateUserOp` instead of returning
     *      `SIG_VALIDATION_FAILED` (= 1) per ERC-4337. Bundlers treat a
     *      revert during validation as a banned account — much worse
     *      than a clean "this sig is invalid" return.
     *
     *      Solidity can't try/catch an internal `abi.decode`, so we
     *      route the decode through an external self-call (which CAN
     *      be try/catch'd). Gas overhead is ~700 in the success path;
     *      the security win is bounded reverts.
     */
    function _verifyWebAuthn(bytes32 hash, bytes memory payload) internal view returns (bool) {
        try this.decodeWebAuthnAssertion(payload) returns (WebAuthnLib.Assertion memory a) {
            PasskeyStorage storage $ = _passkeyStorage();
            PasskeyEntry storage key = $.keys[a.credentialIdDigest];
            if (key.x == 0 && key.y == 0) return false;
            // H7-C.1 / CON-WEBAUTHN-001: pin per-credential rpIdHash + require UP.
            // UV is not required at the library layer; account policy can layer
            // UV requirement in via a future policy module if needed.
            bytes32 rpIdHash = $.rpIdHashOf[a.credentialIdDigest];
            if (rpIdHash == bytes32(0)) return false;
            return WebAuthnLib.verify(a, hash, key.x, key.y, rpIdHash, false);
        } catch {
            return false;
        }
    }

    /**
     * @notice External decoder wrapper used by `_verifyWebAuthn` to
     *         bound `abi.decode` reverts. MUST stay `external` so the
     *         caller can wrap it in `try { … } catch { … }`. Marked
     *         pure — no state access, just decode.
     */
    function decodeWebAuthnAssertion(bytes calldata payload)
        external
        pure
        returns (WebAuthnLib.Assertion memory)
    {
        return abi.decode(payload, (WebAuthnLib.Assertion));
    }

    // ─── Owner Management ───────────────────────────────────────────

    /// @inheritdoc IAgentAccount
    /// @dev An account is implicitly an owner of itself: when a delegation
    ///      chain bottoms out at this AgentAccount as the rootDelegator,
    ///      DelegationManager calls `this.execute(...)` and the resulting
    ///      external call has `msg.sender == address(this)`. Downstream
    ///      `isCustodian(msg.sender)` checks (e.g. FundRegistry.onlyFundOwner)
    ///      should pass — the account IS the actor making the call.
    ///
    ///      Also resolves passkey-identity addresses (PIAs): the
    ///      deterministic address derived from a registered passkey's
    ///      (x, y) is a custodian first-class, so multi-passkey accounts
    ///      can put each user's PIA into quorum slots without nesting
    ///      through a separate Person Smart Agent.
    function isCustodian(address account) external view override returns (bool) {
        if (account == address(this)) return true;
        if (_externalCustodians[account]) return true;
        return _passkeyStorage().piaToCredentialId[account] != bytes32(0);
    }

    /// @inheritdoc IAgentAccount
    /// @dev Counts EOA/contract custodians PLUS registered passkeys —
    ///      each passkey contributes one PIA-custodian. Matches the
    ///      isCustodian semantics above so `defaultApprovals(N, t)` at
    ///      install time and ChangeApprovalsRequired bounds at apply
    ///      time both see the same N.
    function custodianCount() external view override returns (uint256) {
        return _externalCustodianCount + _passkeyStorage().count;
    }

    /// @notice Deterministically derive the Passkey-Identity-Address for
    ///         a P-256 public key. Exposed as `pure` so off-chain code +
    ///         other contracts (CustodyPolicy, factory) can recompute it
    ///         without reading account state.
    function passkeyIdentity(uint256 x, uint256 y) public pure returns (address) {
        return _passkeyIdentity(x, y);
    }

    function _passkeyIdentity(uint256 x, uint256 y) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode(x, y)))));
    }

    /// @inheritdoc IAgentAccount
    /// @dev `owner` here is an EXTERNAL custodian (EOA / SIWE wallet /
    ///      third-party smart wallet like Safe/Argent). Adding an
    ///      agenticprimitives AgentAccount is forbidden — enforced via
    ///      the ERC-165 marker. Passkey custodians are not added here;
    ///      use `addPasskey` instead.
    function addCustodian(address owner) external override onlySelf {
        if (owner == address(0)) revert ZeroAddress();
        if (_externalCustodians[owner]) revert CustodianAlreadyExists(owner);
        if (_isAgenticPrimitivesAgent(owner)) {
            revert AgenticPrimitivesAgentNotAllowedAsCustodian(owner);
        }
        _externalCustodians[owner] = true;
        _externalCustodianCount++;
        emit CustodianAdded(owner);
    }

    /// @dev ERC-165 query — true iff `addr` is a deployed contract that
    ///      advertises `IAgenticPrimitivesAgentAccount`. Safe-style
    ///      try/catch so non-contracts and non-ERC-165 contracts return
    ///      false without reverting.
    function _isAgenticPrimitivesAgent(address addr) internal view returns (bool) {
        if (addr.code.length == 0) return false;
        try IERC165(addr).supportsInterface(
            type(IAgenticPrimitivesAgentAccount).interfaceId
        ) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    /// @inheritdoc IAgenticPrimitivesAgentAccount
    function isAgenticPrimitivesAgentAccount() external pure override returns (bool) {
        return true;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC165).interfaceId
            || interfaceId == type(IERC1271).interfaceId
            || interfaceId == type(IAgentAccount).interfaceId
            || interfaceId == type(IAgenticPrimitivesAgentAccount).interfaceId;
    }

    /// @inheritdoc IAgentAccount
    /// @dev Enforces a multi-signer-safe invariant: can't remove the last
    ///      owner if there are also no registered passkeys. A passkey-only
    ///      account is allowed, but a zero-signer account is not.
    function removeCustodian(address owner) external override onlySelf {
        if (!_externalCustodians[owner]) revert CustodianDoesNotExist(owner);
        if (_externalCustodianCount == 1 && _passkeyStorage().count == 0) revert CannotRemoveLastCustodian();
        _externalCustodians[owner] = false;
        _externalCustodianCount--;
        emit CustodianRemoved(owner);
    }

    // ─── Passkey (WebAuthn P-256) management ──────────────────────

    /// @dev ERC-7201 namespaced storage slot — isolates passkey state so
    ///      future upgrades can add more signer types without clobbering.
    ///      slot = keccak256(abi.encode(uint256(keccak256("smart-agent.agent-account.passkey.v1")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PASSKEY_STORAGE_SLOT =
        0x3b3ffcf51a0a9bcb2764532549426e303b6d219fffb988d3d097bfc22ad32d00;

    struct PasskeyEntry {
        uint256 x;
        uint256 y;
    }

    struct PasskeyStorage {
        mapping(bytes32 => PasskeyEntry) keys;
        mapping(bytes32 => bool) registered;
        uint256 count;
        // Passkey-Identity-Address → credentialIdDigest. PIA is the
        // deterministic address derived from a passkey's (x, y) pubkey
        // via `_passkeyIdentity(x, y)`. Lets `isCustodian(pia)` resolve
        // a passkey without iterating the credentialId set, and lets
        // CustodyPolicy `_verifyQuorum` count passkey signers as
        // first-class quorum members (v=2 slots in
        // SignatureSlotRecovery).
        mapping(address => bytes32) piaToCredentialId;
        // H7-C.1 / CON-WEBAUTHN-001: per-credential RP ID hash, captured
        // at registration and pinned at every verify. Stored separately
        // from PasskeyEntry to preserve the existing PasskeyEntry storage
        // layout for upgrade safety. Required (non-zero) on add.
        mapping(bytes32 => bytes32) rpIdHashOf;
    }

    function _passkeyStorage() private pure returns (PasskeyStorage storage $) {
        bytes32 slot = PASSKEY_STORAGE_SLOT;
        assembly { $.slot := slot }
    }

    event PasskeyAdded(bytes32 indexed credentialIdDigest, uint256 x, uint256 y, bytes32 rpIdHash);
    event PasskeyRemoved(bytes32 indexed credentialIdDigest);

    /// @notice Register a new WebAuthn credential bound to a specific RP.
    ///         `onlySelf` — callable via a UserOp signed by any existing signer
    ///         (owner or another passkey). Also registers the credential's
    ///         Passkey-Identity-Address (PIA) so `isCustodian(pia)` returns
    ///         true and v=2 quorum slots can count this passkey as a distinct
    ///         signer.
    /// @param rpIdHash `sha256(rpId)` — the RP this credential was registered
    ///                 against. PINNED on every verify (H7-C.1 / CON-WEBAUTHN-001
    ///                 closure). Must be non-zero. Each credential carries its
    ///                 own rpIdHash so an account that adopts credentials across
    ///                 multiple RPs gets correct per-credential origin scoping.
    function addPasskey(
        bytes32 credentialIdDigest,
        uint256 x,
        uint256 y,
        bytes32 rpIdHash
    ) external onlySelf {
        if (x == 0 || y == 0) revert InvalidPasskeyPublicKey();
        // Audit C-6: zero digest poisons piaToCredentialId mapping.
        if (credentialIdDigest == bytes32(0)) revert InvalidCredentialIdDigest();
        // H7-C.1: zero rpIdHash would let the verifier accept any RP (kills the pin).
        if (rpIdHash == bytes32(0)) revert InvalidRpIdHash();
        PasskeyStorage storage $ = _passkeyStorage();
        if ($.registered[credentialIdDigest]) revert PasskeyAlreadyRegistered(credentialIdDigest);
        address pia = _passkeyIdentity(x, y);
        if ($.piaToCredentialId[pia] != bytes32(0)) revert PasskeyAlreadyRegistered(credentialIdDigest);
        if (_externalCustodians[pia]) revert CustodianAlreadyExists(pia);
        $.keys[credentialIdDigest] = PasskeyEntry(x, y);
        $.registered[credentialIdDigest] = true;
        $.piaToCredentialId[pia] = credentialIdDigest;
        $.rpIdHashOf[credentialIdDigest] = rpIdHash;
        $.count += 1;
        emit PasskeyAdded(credentialIdDigest, x, y, rpIdHash);
        emit CustodianAdded(pia);
    }

    /// @notice Remove a registered WebAuthn credential. onlySelf, with a
    ///         "must leave at least one signer" invariant that counts owners
    ///         AND passkeys together. Also clears the credential's PIA
    ///         entry so `isCustodian(pia)` flips back to false.
    function removePasskey(bytes32 credentialIdDigest) external onlySelf {
        PasskeyStorage storage $ = _passkeyStorage();
        if (!$.registered[credentialIdDigest]) revert PasskeyNotRegistered(credentialIdDigest);
        if (_externalCustodianCount + $.count == 1) revert CannotRemoveLastSigner();
        PasskeyEntry storage key = $.keys[credentialIdDigest];
        address pia = _passkeyIdentity(key.x, key.y);
        delete $.keys[credentialIdDigest];
        $.registered[credentialIdDigest] = false;
        delete $.piaToCredentialId[pia];
        delete $.rpIdHashOf[credentialIdDigest];
        $.count -= 1;
        emit PasskeyRemoved(credentialIdDigest);
        emit CustodianRemoved(pia);
    }

    /// @notice Whether a passkey is registered on this account.
    function hasPasskey(bytes32 credentialIdDigest) external view returns (bool) {
        return _passkeyStorage().registered[credentialIdDigest];
    }

    /// @notice Read the registered passkey public key.
    function getPasskey(bytes32 credentialIdDigest) external view returns (uint256 x, uint256 y) {
        PasskeyEntry storage k = _passkeyStorage().keys[credentialIdDigest];
        return (k.x, k.y);
    }

    /// @notice Total count of registered passkeys.
    function passkeyCount() external view returns (uint256) {
        return _passkeyStorage().count;
    }

    // ─── Custody policy + scheduled changes ───────────────────────────
    //
    // The schedule / apply / cancel custody-change surface, CustodyAction
    // enum, per-account Config struct, _verifyQuorum, and action handlers
    // live in `src/custody/CustodyPolicy.sol` — an ERC-7579 module
    // installed as MODULE_TYPE_EXECUTOR. Per spec 209 (ERC-7579 module
    // taxonomy) AgentAccount is the thin core; per spec 213 the module
    // owns the custody-layer surface. The policy calls back via
    // `executeFromModule` to apply changes.
    //
    // Views (custodyMode / approvalsRequired / recoveryApprovals /
    // trusteeCount / scheduledChangeCount / etc.) live on the policy
    // module and are queried through it: `CustodyPolicy(modAddr)
    // .custodyMode(account)` etc.
    // ─── Receive ETH ────────────────────────────────────────────────

    receive() external payable {}
}

/// @dev Minimal subset of the ERC-7579 module interface we call into.
///      We import the OpenZeppelin draft-IERC7579 only when needed; an inline
///      type-erased shape here avoids pulling the full file at this layer.
interface IERC7579ModuleLike {
    function onInstall(bytes calldata data) external;
    function onUninstall(bytes calldata data) external;
}

interface IERC7579HookLike {
    function preCheck(address msgSender, uint256 value, bytes calldata msgData)
        external returns (bytes memory);
    function postCheck(bytes calldata hookData) external;
}
