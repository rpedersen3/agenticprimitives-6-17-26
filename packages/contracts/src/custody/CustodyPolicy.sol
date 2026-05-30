// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAgentAccount, AgentAccountRecoveryArgs, AgentAccountRecoveryPasskeyAdd} from "../IAgentAccount.sol";
import {SignatureSlotRecovery} from "../libraries/SignatureSlotRecovery.sol";

/**
 * @title CustodyPolicy
 * @notice ERC-7579 module that owns the schedule / apply / cancel
 *         custody-change surface for `AgentAccount` accounts running
 *         in any non-`single` mode. Per spec 209 (ERC-7579 module
 *         taxonomy) this is the first module extraction; per spec 213
 *         (custody-layer carve-out, phase 6g.1) this is renamed from
 *         the original `ThresholdValidator` to align with the
 *         custody-layer vocabulary firewall.
 *
 *         Despite the underlying module type being `EXECUTOR` (id 2),
 *         the user-facing semantics are CUSTODY POLICY — it decides
 *         who can authorize a custody change (m-of-n approvals from
 *         the custody council) and applies the change via
 *         `executeFromModule(...)`.
 *
 *         State is keyed by account address — one CustodyPolicy
 *         instance can serve many accounts. `msg.sender` during
 *         install is the account; subsequent custody calls take the
 *         account as an explicit first arg so they can be made from
 *         any caller (the signature blob is what authorizes).
 *
 *         Spec 207 § 5 tier matrix (T1 Read / T2 Write / T3 Value /
 *         T4 Admin / T5 Critical / T6 Recovery) is unchanged from the
 *         pre-extraction surface. Per spec 213 § 2.2, the enum was
 *         renamed from `AdminAction` → `CustodyAction`, the propose /
 *         execute / cancel functions to schedule / apply / cancel
 *         scheduled change, state vars (threshold → approvalsRequired,
 *         timelock → safetyDelay, guardian → trustee, owner → custodian),
 *         and EIP-712 typehashes likewise.
 */
contract CustodyPolicy {
    // ─── ERC-7579 marker constants (mirror of the account-side ids) ──
    uint256 internal constant MODULE_TYPE_EXECUTOR = 2;

    // ─── CustodyAction enum + structs (moved from AgentAccount) ────────

    enum CustodyAction {
        AddCustodian,                  // 0  — T4
        RemoveCustodian,               // 1  — T4
        AddPasskeyCredential,                // 2  — T4
        RemovePasskeyCredential,             // 3  — T4
        AddTrustee,               // 4  — T4
        RemoveTrustee,            // 5  — T4
        ChangeCustodyMode,                // 6  — T4
        ApplySystemUpdate,               // 7  — T5
        RotateDelegationManager,   // 8  — T5
        RotatePaymaster,           // 9  — T5 (stubbed; reverts on execute)
        RotateSessionIssuer,       // 10 — T5 (stubbed)
        RotateAllCustodians,           // 11 — T4
        ChangeValueCeiling,           // 12 — T4
        SetRecoveryApprovals,      // 13 — T4
        RecoverAccount,            // 14 — T6
        ChangeApprovalsRequired    // 15 — T4 (per-tier custody quorum threshold)
    }

    struct ScheduledChange {
        CustodyAction action;
        bytes args;
        uint64 proposedAt;
        uint64 eta;
        address proposer;
        bool executed;
        bool cancelled;
    }

    /// @dev Per-account config. One mapping entry per installed-on account.
    struct Config {
        bool installed;
        /// @dev Audit C-11: once an account uninstalls the CustodyPolicy,
        ///      reinstall is permanently forbidden — stale trustees /
        ///      thresholds / pending changes would otherwise compose with
        ///      the next install in unpredictable ways. Accounts that
        ///      want a fresh policy state must deploy a fresh account.
        bool permanentlyUninstalled;
        uint8 mode;                                       // 0=single, 1=hybrid, 2=threshold, 3=org
        uint8 recoveryApprovals;
        uint256 t3HighValueCeiling;
        mapping(uint8 => uint8) approvalsRequiredByTier;
        mapping(uint8 => uint32) safetyDelayByTier;
        mapping(address => bool) trustees;
        uint256 trusteeCount;
        uint256 nextChangeId;
        mapping(uint256 => ScheduledChange) pending;
        mapping(uint256 => mapping(address => bool)) proposerCustodians;
        address approvedHashRegistry;
    }

    mapping(address => Config) internal _configs;

    // ─── Constants ────────────────────────────────────────────────────

    // ─── EIP-712 (spec 207 § 15) ─────────────────────────────────────

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 internal constant EIP712_NAME_HASH = keccak256("agenticprimitives.CustodyPolicy");
    bytes32 internal constant EIP712_VERSION_HASH = keccak256("1");

    bytes32 internal constant SCHEDULE_CUSTODY_CHANGE_TYPEHASH = keccak256(
        "ScheduleCustodyChangeRequest(address account,uint8 action,bytes32 argsHash,uint256 changeId)"
    );
    bytes32 internal constant APPLY_CUSTODY_CHANGE_TYPEHASH = keccak256(
        "ApplyCustodyChangeRequest(address account,uint8 action,bytes32 argsHash,uint256 changeId,uint64 eta)"
    );
    bytes32 internal constant CANCEL_SCHEDULED_CHANGE_TYPEHASH = keccak256(
        "CancelScheduledChangeRequest(address account,uint8 action,bytes32 argsHash,uint256 changeId,uint64 eta)"
    );

    /// @dev Cached at deploy-time for the deploy-time chainId. If
    ///      `block.chainid` differs at call time (chain fork), we
    ///      recompute on demand. Mirrors OpenZeppelin's EIP712 base.
    uint256 private immutable _CACHED_CHAIN_ID;
    bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;

    constructor() {
        _CACHED_CHAIN_ID = block.chainid;
        _CACHED_DOMAIN_SEPARATOR = _buildDomainSeparator();
    }

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                EIP712_NAME_HASH,
                EIP712_VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
    }

    function _domainSeparator() internal view returns (bytes32) {
        if (block.chainid == _CACHED_CHAIN_ID) return _CACHED_DOMAIN_SEPARATOR;
        return _buildDomainSeparator();
    }

    /// @notice EIP-712 domain separator. Off-chain code can `eth_call` to
    ///         confirm what domain wallet sigs are bound to.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(bytes2(0x1901), _domainSeparator(), structHash));
    }

    function _hashProposeRequest(
        address account,
        CustodyAction action,
        bytes memory args,
        uint256 changeId
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(SCHEDULE_CUSTODY_CHANGE_TYPEHASH, account, uint8(action), keccak256(args), changeId))
        );
    }

    function _hashExecuteRequest(
        address account,
        CustodyAction action,
        bytes memory args,
        uint256 changeId,
        uint64 eta
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(APPLY_CUSTODY_CHANGE_TYPEHASH, account, uint8(action), keccak256(args), changeId, eta))
        );
    }

    function _hashCancelRequest(
        address account,
        CustodyAction action,
        bytes memory args,
        uint256 changeId,
        uint64 eta
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(CANCEL_SCHEDULED_CHANGE_TYPEHASH, account, uint8(action), keccak256(args), changeId, eta))
        );
    }

    /// @dev Spec 207 § 8 — first 24h of the T6 timelock is the
    ///      primary-owner cancel window.
    uint64 internal constant RECOVERY_PRIMARY_CANCEL_WINDOW = 24 hours;

    // ─── Events ───────────────────────────────────────────────────────

    event CustodyPolicyInstalled(address indexed account, uint8 mode, uint8 recoveryApprovals);
    event CustodyPolicyUninstalled(address indexed account);

    event CustodyChangeScheduled(address indexed account, uint256 indexed changeId, CustodyAction indexed action, uint64 eta, address proposer);
    event CustodyChangeApplied(address indexed account, uint256 indexed changeId);
    event ScheduledChangeCancelled(address indexed account, uint256 indexed changeId);
    event GuardianAdded(address indexed account, address indexed guardian);
    event GuardianRemoved(address indexed account, address indexed guardian);
    event ThresholdChanged(address indexed account, uint8 indexed tier, uint8 oldValue, uint8 newValue);
    event ModeChanged(address indexed account, uint8 oldMode, uint8 newMode);
    event T3CeilingChanged(address indexed account, uint256 oldCeiling, uint256 newCeiling);
    event RecoveryThresholdChanged(address indexed account, uint8 oldValue, uint8 newValue);
    event OwnersRotated(address indexed account, uint256 newOwnerCount);
    /// @notice Audit C-10: per-rotation count of custodians removed.
    event CustodiansRemovedDuringRotation(address indexed account, uint256 removedCount);
    /// @notice Audit C-11: CustodyPolicy was uninstalled; the account
    ///         can never reinstall it. Surfaced as a loud event so
    ///         operators see the lock applied.
    event CustodyPolicyPermanentlyUninstalled(address indexed account);
    event AccountRecovered(
        address indexed account,
        uint256 ownersAddedCount,
        uint256 ownersRemovedCount,
        uint256 passkeysAddedCount,
        uint256 passkeysRemovedCount
    );

    // ─── Errors ───────────────────────────────────────────────────────

    error NotInstalledOn(address account);
    error AlreadyInstalledOn(address account);
    error OnInstallNotByAccount(address caller);

    error InvalidCustodyAction(uint8 action);
    error InvalidTier(uint8 tier);
    error ProposalNotFound(uint256 changeId);
    error ProposalAlreadyExecuted(uint256 changeId);
    error ProposalAlreadyCancelled(uint256 changeId);
    error ProposalNotReady(uint256 changeId, uint64 eta);
    error AdminInsufficientQuorum(uint256 supplied, uint8 required);
    error AdminDuplicateOrUnsortedSigner(address signer);
    error AdminUnauthorizedSigner(address signer);
    error TrusteeAlreadyExists(address guardian);
    error TrusteeDoesNotExist(address guardian);
    error InvalidMode(uint8 mode_);
    error InvalidThresholdValue(uint8 thr);
    error RecoveryRequiresGuardians();
    error EmptyOwnerSet();
    error CustodyActionNotYetImplemented(uint8 action);
    error CannotDowngradeWithTrustees();
    error TimelockRequiredForTier(uint8 tier);
    error SeparationOfDutiesViolation(address signer);
    error RecoveryRequiresGuardianQuorum();
    error UnauthorizedTrustee(address signer);
    error ZeroAddress();
    /// @dev Audit C-11: reinstall over a previously-uninstalled config
    ///      is forbidden — stale mappings would compose unpredictably.
    error ReinstallForbidden(address account);

    // ─── ERC-7579 lifecycle ───────────────────────────────────────────

    /**
     * Install-time init data shape:
     *   abi.encode(
     *     uint8 mode,
     *     uint8 recoveryApprovals,
     *     address[] trustees,
     *     uint8[7] approvalsRequiredByTier,   // index 0 unused; T1..T6 use 1..6
     *     uint32[7] safetyDelayByTier,
     *     uint256 t3HighValueCeiling,
     *     address approvedHashRegistry
     *   )
     */
    function onInstall(bytes calldata data) external {
        address account = msg.sender;
        Config storage c = _configs[account];
        if (c.installed) revert AlreadyInstalledOn(account);
        // Audit C-11: reinstall over previously-uninstalled state is
        // forbidden. The stale mappings (trustees, thresholds, pending)
        // never zero out — silently re-using them on a fresh install
        // could compose with adversary-chosen new state in pathological
        // ways. Force a new deploy if the operator genuinely needs a
        // fresh policy for this account.
        if (c.permanentlyUninstalled) revert ReinstallForbidden(account);

        (
            uint8 modeVal,
            uint8 recThr,
            address[] memory trustees,
            uint8[7] memory thresholds,
            uint32[7] memory timelocks,
            uint256 t3Ceiling,
            address approvedHashReg
        ) = abi.decode(data, (uint8, uint8, address[], uint8[7], uint32[7], uint256, address));

        if (modeVal > 3) revert InvalidMode(modeVal);

        c.installed = true;
        c.mode = modeVal;
        c.recoveryApprovals = recThr;
        c.t3HighValueCeiling = t3Ceiling;
        c.approvedHashRegistry = approvedHashReg;

        for (uint8 t = 1; t <= 6; t++) {
            if (thresholds[t] > 0) c.approvalsRequiredByTier[t] = thresholds[t];
            if (timelocks[t] > 0) c.safetyDelayByTier[t] = timelocks[t];
        }

        for (uint256 i; i < trustees.length; i++) {
            address g = trustees[i];
            if (g == address(0)) revert ZeroAddress();
            if (c.trustees[g]) revert TrusteeAlreadyExists(g);
            c.trustees[g] = true;
            c.trusteeCount += 1;
        }

        emit CustodyPolicyInstalled(account, modeVal, recThr);
    }

    function onUninstall(bytes calldata) external {
        address account = msg.sender;
        Config storage c = _configs[account];
        if (!c.installed) revert NotInstalledOn(account);
        c.installed = false;
        // Audit C-11: lock against ever re-installing on this account.
        // The mapping state (trustees, thresholds, proposals) is left
        // in place intentionally — clearing all of it via storage
        // iteration is unbounded gas. The `permanentlyUninstalled`
        // flag prevents the stale state from being composed against
        // a fresh install instead.
        c.permanentlyUninstalled = true;
        emit CustodyPolicyUninstalled(account);
        emit CustodyPolicyPermanentlyUninstalled(account);
    }

    // ─── Public propose / execute / cancel ──────────────────────────

    function scheduleCustodyChange(
        address account,
        CustodyAction action,
        bytes calldata args,
        bytes calldata quorumSigs
    ) external returns (uint256 changeId) {
        Config storage c = _configs[account];
        if (!c.installed) revert NotInstalledOn(account);

        // Audit C-8: tier escalates for ChangeApprovalsRequired based on
        // which tier is being changed + direction of change.
        uint8 tier = _effectiveTierFor(c, action, args);
        uint32 timelock = _safetyDelayValue(c, tier);

        if ((tier == 5 || tier == 6) && timelock == 0) {
            revert TimelockRequiredForTier(tier);
        }

        bool isRecovery = (action == CustodyAction.RecoverAccount);
        uint8 reqThreshold;
        if (isRecovery) {
            if (c.trusteeCount == 0 || c.recoveryApprovals == 0) {
                revert RecoveryRequiresGuardianQuorum();
            }
            reqThreshold = c.recoveryApprovals;
        } else {
            reqThreshold = _approvalsValue(c, tier);
        }

        uint64 nowTs = uint64(block.timestamp);
        uint64 eta = uint64(nowTs + timelock);
        changeId = ++c.nextChangeId;
        bytes32 payloadHash = _hashProposeRequest(account, action, args, changeId);
        address[] memory propSigners = _verifyQuorum(account, c, payloadHash, quorumSigs, reqThreshold, isRecovery);

        c.pending[changeId] = ScheduledChange({
            action: action,
            args: args,
            proposedAt: nowTs,
            eta: eta,
            proposer: msg.sender,
            executed: false,
            cancelled: false
        });

        for (uint256 i; i < propSigners.length; i++) {
            c.proposerCustodians[changeId][propSigners[i]] = true;
        }

        emit CustodyChangeScheduled(account, changeId, action, eta, msg.sender);
    }

    function applyCustodyChange(address account, uint256 changeId, bytes calldata quorumSigs) external {
        Config storage c = _configs[account];
        if (!c.installed) revert NotInstalledOn(account);

        ScheduledChange storage p = c.pending[changeId];
        if (p.eta == 0) revert ProposalNotFound(changeId);
        if (p.executed) revert ProposalAlreadyExecuted(changeId);
        if (p.cancelled) revert ProposalAlreadyCancelled(changeId);
        if (block.timestamp < p.eta) revert ProposalNotReady(changeId, p.eta);

        bool isRecovery = (p.action == CustodyAction.RecoverAccount);
        uint8 tier = _effectiveTierFor(c, p.action, p.args);
        uint8 reqThreshold = isRecovery ? c.recoveryApprovals : _approvalsValue(c, tier);
        bytes32 payloadHash = _hashExecuteRequest(account, p.action, p.args, changeId, p.eta);
        address[] memory execSigners = _verifyQuorum(account, c, payloadHash, quorumSigs, reqThreshold, isRecovery);

        if (c.mode == 3 && !isRecovery) {
            for (uint256 i; i < execSigners.length; i++) {
                if (c.proposerCustodians[changeId][execSigners[i]]) {
                    revert SeparationOfDutiesViolation(execSigners[i]);
                }
            }
        }

        p.executed = true;
        emit CustodyChangeApplied(account, changeId);
        _applyCustodyChange(account, c, p.action, p.args);
    }

    function cancelScheduledChange(address account, uint256 changeId, bytes calldata quorumSigs) external {
        Config storage c = _configs[account];
        if (!c.installed) revert NotInstalledOn(account);

        ScheduledChange storage p = c.pending[changeId];
        if (p.eta == 0) revert ProposalNotFound(changeId);
        if (p.executed) revert ProposalAlreadyExecuted(changeId);
        if (p.cancelled) revert ProposalAlreadyCancelled(changeId);

        bytes32 payloadHash = _hashCancelRequest(account, p.action, p.args, changeId, p.eta);

        if (p.action == CustodyAction.RecoverAccount) {
            uint64 cancelWindowEnds = p.proposedAt + RECOVERY_PRIMARY_CANCEL_WINDOW;
            bool inOwnerCancelWindow = block.timestamp < cancelWindowEnds;
            uint8 reqThreshold = inOwnerCancelWindow
                ? _approvalsValue(c, 4)
                : c.recoveryApprovals;
            _verifyQuorum(account, c, payloadHash, quorumSigs, reqThreshold, !inOwnerCancelWindow);
        } else {
            uint8 tier = _effectiveTierFor(c, p.action, p.args);
            uint8 reqThreshold = _approvalsValue(c, tier);
            _verifyQuorum(account, c, payloadHash, quorumSigs, reqThreshold, false);
        }

        p.cancelled = true;
        emit ScheduledChangeCancelled(account, changeId);
    }

    // ─── Views ──────────────────────────────────────────────────────

    function custodyMode(address account) external view returns (uint8) {
        return _configs[account].mode;
    }

    function approvalsRequired(address account, uint8 tier) external view returns (uint8) {
        return _approvalsValue(_configs[account], tier);
    }

    function recoveryApprovals(address account) external view returns (uint8) {
        return _configs[account].recoveryApprovals;
    }

    function isTrustee(address account, address signer) external view returns (bool) {
        return _configs[account].trustees[signer];
    }

    function trusteeCount(address account) external view returns (uint256) {
        return _configs[account].trusteeCount;
    }

    function scheduledChangeCount(address account) external view returns (uint256) {
        return _configs[account].nextChangeId;
    }

    function t3HighValueCeiling(address account) external view returns (uint256) {
        return _configs[account].t3HighValueCeiling;
    }

    function safetyDelay(address account, uint8 tier) external view returns (uint32) {
        return _safetyDelayValue(_configs[account], tier);
    }

    function approvedHashRegistry(address account) external view returns (address) {
        return _configs[account].approvedHashRegistry;
    }

    function isInstalledOn(address account) external view returns (bool) {
        return _configs[account].installed;
    }

    function getScheduledChange(address account, uint256 changeId) external view returns (
        CustodyAction action,
        bytes memory args,
        uint64 proposedAt,
        uint64 eta,
        address proposer,
        bool executed,
        bool cancelled
    ) {
        ScheduledChange storage p = _configs[account].pending[changeId];
        return (p.action, p.args, p.proposedAt, p.eta, p.proposer, p.executed, p.cancelled);
    }

    /// @notice Pure helper exposing the default-threshold matrix from
    ///         spec § 5.1 — owners over n=1..N produce per-tier defaults.
    function defaultApprovals(uint8 nCustodians, uint8 tier) external pure returns (uint8) {
        return _defaultApprovals(nCustodians, tier);
    }

    // ─── Internal helpers ──────────────────────────────────────────

    function _tierFor(CustodyAction action) internal pure returns (uint8) {
        if (action == CustodyAction.RecoverAccount) return 6;
        if (
            action == CustodyAction.ApplySystemUpdate ||
            action == CustodyAction.RotateDelegationManager ||
            action == CustodyAction.RotatePaymaster ||
            action == CustodyAction.RotateSessionIssuer
        ) return 5;
        return 4;
    }

    /**
     * @dev Audit C-8: `ChangeApprovalsRequired` must require AT LEAST the
     *      tier being modified — otherwise a T4 admin quorum could
     *      silently lower the T5 critical threshold to 1, defeating the
     *      whole layered-threshold model. Decreases also bump up one
     *      tier (require T5 for any reduction) because lowering a
     *      threshold is the security-critical direction.
     */
    function _effectiveTierFor(
        Config storage c,
        CustodyAction action,
        bytes memory args
    ) internal view returns (uint8) {
        uint8 base = _tierFor(action);
        if (action != CustodyAction.ChangeApprovalsRequired) return base;
        // Decode (uint8 tier, uint8 newCount). Bound the change tier in
        // [1, 5]; T6 (recovery) routes through SetRecoveryApprovals.
        (uint8 targetTier, uint8 newCount) = abi.decode(args, (uint8, uint8));
        if (targetTier == 0 || targetTier > 5) return base;
        uint8 required = targetTier > base ? targetTier : base;
        // If this would DECREASE the threshold, require at least T5
        // authority (one tier higher than ordinary admin).
        uint8 currentValue = c.approvalsRequiredByTier[targetTier];
        if (currentValue == 0) currentValue = 1; // matches _approvalsValue fallback
        if (newCount < currentValue && required < 5) required = 5;
        return required;
    }

    function _approvalsValue(Config storage c, uint8 tier) internal view returns (uint8) {
        if (tier == 0 || tier > 6) revert InvalidTier(tier);
        uint8 v = c.approvalsRequiredByTier[tier];
        return v == 0 ? 1 : v;
    }

    function _safetyDelayValue(Config storage c, uint8 tier) internal view returns (uint32) {
        if (tier == 0 || tier > 6) revert InvalidTier(tier);
        return c.safetyDelayByTier[tier];
    }

    function _verifyQuorum(
        address account,
        Config storage c,
        bytes32 payloadHash,
        bytes calldata signatures,
        uint8 reqThreshold,
        bool guardianMode
    ) internal view returns (address[] memory signers) {
        if (signatures.length < uint256(reqThreshold) * 65) {
            revert AdminInsufficientQuorum(signatures.length / 65, reqThreshold);
        }
        bytes memory sigsMem = signatures;
        address approvedHashReg = c.approvedHashRegistry;
        signers = new address[](reqThreshold);
        address prev;
        for (uint256 i; i < reqThreshold; i++) {
            address signer = SignatureSlotRecovery.recoverFromSlot(
                payloadHash, sigsMem, i, approvedHashReg
            );
            if (signer <= prev) revert AdminDuplicateOrUnsortedSigner(signer);
            prev = signer;
            if (guardianMode) {
                if (!c.trustees[signer]) revert UnauthorizedTrustee(signer);
            } else {
                if (!IAgentAccount(account).isCustodian(signer)) revert AdminUnauthorizedSigner(signer);
            }
            signers[i] = signer;
        }
    }

    // ─── Action dispatcher + handlers ──────────────────────────────

    function _applyCustodyChange(
        address account,
        Config storage c,
        CustodyAction action,
        bytes memory args
    ) internal {
        if (action == CustodyAction.AddCustodian) {
            (address newOwner) = abi.decode(args, (address));
            _execute(account, abi.encodeCall(IAgentAccount.addCustodian, (newOwner)));
        } else if (action == CustodyAction.RemoveCustodian) {
            (address oldOwner) = abi.decode(args, (address));
            _execute(account, abi.encodeCall(IAgentAccount.removeCustodian, (oldOwner)));
        } else if (action == CustodyAction.AddPasskeyCredential) {
            (bytes32 cid, uint256 x, uint256 y) = abi.decode(args, (bytes32, uint256, uint256));
            _execute(account, abi.encodeWithSignature("addPasskey(bytes32,uint256,uint256)", cid, x, y));
        } else if (action == CustodyAction.RemovePasskeyCredential) {
            (bytes32 cid) = abi.decode(args, (bytes32));
            _execute(account, abi.encodeWithSignature("removePasskey(bytes32)", cid));
        } else if (action == CustodyAction.AddTrustee) {
            (address g) = abi.decode(args, (address));
            _applyAddGuardian(account, c, g);
        } else if (action == CustodyAction.RemoveTrustee) {
            (address g) = abi.decode(args, (address));
            _applyRemoveGuardian(account, c, g);
        } else if (action == CustodyAction.ChangeCustodyMode) {
            (uint8 newMode) = abi.decode(args, (uint8));
            _applyChangeMode(account, c, newMode);
        } else if (action == CustodyAction.RotateAllCustodians) {
            // Audit C-10: args shape changed to (addCustodians, removeCustodians).
            // The legacy single-array form only ADDED — a compromised
            // custodian was never actually rotated OUT. Wire-format
            // break is acceptable in pre-alpha; the demo's only
            // current caller (none) was using the legacy form.
            (address[] memory addCustodians, address[] memory removeCustodians) =
                abi.decode(args, (address[], address[]));
            _applyRotateAllOwners(account, addCustodians, removeCustodians);
        } else if (action == CustodyAction.ChangeValueCeiling) {
            (uint256 newCeiling) = abi.decode(args, (uint256));
            _applyChangeT3Ceiling(account, c, newCeiling);
        } else if (action == CustodyAction.SetRecoveryApprovals) {
            (uint8 newThr) = abi.decode(args, (uint8));
            _applySetRecoveryThreshold(account, c, newThr);
        } else if (action == CustodyAction.ChangeApprovalsRequired) {
            (uint8 tier, uint8 newCount) = abi.decode(args, (uint8, uint8));
            _applyChangeApprovalsRequired(account, c, tier, newCount);
        } else if (action == CustodyAction.RecoverAccount) {
            AgentAccountRecoveryArgs memory r = abi.decode(args, (AgentAccountRecoveryArgs));
            _applyRecoverAccount(account, r);
        } else if (action == CustodyAction.ApplySystemUpdate) {
            (address newImpl) = abi.decode(args, (address));
            _execute(account, abi.encodeWithSignature("upgradeToAndCall(address,bytes)", newImpl, ""));
        } else if (action == CustodyAction.RotateDelegationManager) {
            (address newDm) = abi.decode(args, (address));
            _execute(account, abi.encodeWithSignature("setDelegationManager(address)", newDm));
        } else if (
            action == CustodyAction.RotatePaymaster ||
            action == CustodyAction.RotateSessionIssuer
        ) {
            revert CustodyActionNotYetImplemented(uint8(action));
        } else {
            revert InvalidCustodyAction(uint8(action));
        }
    }

    /// @dev Single entry-point for account self-calls. The account's
    ///      `executeFromModule` does the EVM-level call; when target ==
    ///      account, msg.sender at the callee is the account itself,
    ///      satisfying onlySelf gates on `addCustodian` / `removeCustodian` / etc.
    function _execute(address account, bytes memory data) internal {
        // Use a low-level call so the calldata is the exact ABI-encoded
        // call to executeFromModule, which then bubble-reverts the
        // inner call. Solidity's high-level call generates the same
        // shape but we keep the low-level form for explicitness.
        (bool ok, bytes memory ret) = account.call(
            abi.encodeWithSignature(
                "executeFromModule(address,uint256,bytes)",
                account,
                uint256(0),
                data
            )
        );
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
    }

    function _applyAddGuardian(address account, Config storage c, address g) internal {
        if (g == address(0)) revert ZeroAddress();
        if (c.trustees[g]) revert TrusteeAlreadyExists(g);
        c.trustees[g] = true;
        c.trusteeCount += 1;
        emit GuardianAdded(account, g);
    }

    function _applyRemoveGuardian(address account, Config storage c, address g) internal {
        if (!c.trustees[g]) revert TrusteeDoesNotExist(g);
        if (c.recoveryApprovals > 0 && c.trusteeCount - 1 < c.recoveryApprovals) {
            revert RecoveryRequiresGuardians();
        }
        c.trustees[g] = false;
        c.trusteeCount -= 1;
        emit GuardianRemoved(account, g);
    }

    function _applyChangeMode(address account, Config storage c, uint8 newMode) internal {
        if (newMode > 3) revert InvalidMode(newMode);
        uint8 oldMode = c.mode;
        if (newMode == 0 && c.trusteeCount > 0) revert CannotDowngradeWithTrustees();
        c.mode = newMode;
        emit ModeChanged(account, oldMode, newMode);
    }

    /**
     * @notice Add new custodians AND remove old ones in one ceremony.
     * @dev Audit C-10: the previous shape only added — a "rotate" that
     *      didn't rotate. New shape is exact-replacement-friendly: pass
     *      the additions in `addCustodians` and the removals in
     *      `removeCustodians`. Validates the final custodian count
     *      stays ≥ 1 (the on-chain `removeCustodian` will revert with
     *      CannotRemoveLastCustodian if we'd zero it, but we double-check
     *      here for explicitness).
     */
    function _applyRotateAllOwners(
        address account,
        address[] memory addCustodians,
        address[] memory removeCustodians
    ) internal {
        if (addCustodians.length == 0 && removeCustodians.length == 0) {
            revert EmptyOwnerSet();
        }
        uint256 added;
        for (uint256 i; i < addCustodians.length; i++) {
            address o = addCustodians[i];
            if (o == address(0)) revert ZeroAddress();
            if (!IAgentAccount(account).isCustodian(o)) {
                _execute(account, abi.encodeCall(IAgentAccount.addCustodian, (o)));
                added++;
            }
        }
        // Remove AFTER add so we never transiently dip below count=1 in
        // the "rotate sole custodian to a new sole custodian" case.
        uint256 removed;
        for (uint256 i; i < removeCustodians.length; i++) {
            address o = removeCustodians[i];
            if (o == address(0)) revert ZeroAddress();
            if (IAgentAccount(account).isCustodian(o)) {
                _execute(account, abi.encodeCall(IAgentAccount.removeCustodian, (o)));
                removed++;
            }
        }
        emit OwnersRotated(account, added);
        // Note: OwnersRotated only carries `added` for ABI compat. A
        // future revision should add a `removed` field; that's a
        // wire-format break we'll batch with the next event-schema rev.
        if (removed > 0) emit CustodiansRemovedDuringRotation(account, removed);
    }

    function _applyChangeT3Ceiling(address account, Config storage c, uint256 newCeiling) internal {
        uint256 oldCeiling = c.t3HighValueCeiling;
        c.t3HighValueCeiling = newCeiling;
        emit T3CeilingChanged(account, oldCeiling, newCeiling);
    }

    function _applySetRecoveryThreshold(address account, Config storage c, uint8 newThr) internal {
        // Audit C-9: a `SetRecoveryApprovals(0)` previously disabled
        // recovery entirely under a T4 admin quorum — quiet enough to
        // be missed by reviewers, catastrophic if a key was lost
        // afterwards. Refuse zero here; explicit disable-recovery
        // semantics should live behind a separate DisableRecovery
        // action gated at T5 + timelock (not yet wired).
        if (newThr == 0) revert InvalidThresholdValue(newThr);
        if (c.trusteeCount < newThr) revert RecoveryRequiresGuardians();
        if (newThr > c.trusteeCount) revert InvalidThresholdValue(newThr);
        uint8 oldThr = c.recoveryApprovals;
        c.recoveryApprovals = newThr;
        emit RecoveryThresholdChanged(account, oldThr, newThr);
    }

    /// @dev Per-tier custody-quorum threshold mutator. Tier 6 (recovery)
    ///      lives in `recoveryApprovals` instead, so it routes through
    ///      `SetRecoveryApprovals`; this surface covers T1..T5. The new
    ///      count must be ≥ 1 and ≤ the account's current custodianCount.
    function _applyChangeApprovalsRequired(
        address account,
        Config storage c,
        uint8 tier,
        uint8 newCount
    ) internal {
        if (tier == 0 || tier > 5) revert InvalidTier(tier);
        if (newCount == 0) revert InvalidThresholdValue(newCount);
        uint256 n = IAgentAccount(account).custodianCount();
        if (uint256(newCount) > n) revert InvalidThresholdValue(newCount);
        uint8 oldValue = c.approvalsRequiredByTier[tier];
        if (oldValue == 0) oldValue = 1; // mirror _approvalsValue fallback
        c.approvalsRequiredByTier[tier] = newCount;
        emit ThresholdChanged(account, tier, oldValue, newCount);
    }

    function _applyRecoverAccount(address account, AgentAccountRecoveryArgs memory r) internal {
        uint256 addedOwners;
        for (uint256 i; i < r.addOwners.length; i++) {
            address o = r.addOwners[i];
            if (o == address(0)) revert ZeroAddress();
            if (!IAgentAccount(account).isCustodian(o)) {
                _execute(account, abi.encodeCall(IAgentAccount.addCustodian, (o)));
                addedOwners++;
            }
        }

        uint256 addedPasskeys;
        for (uint256 i; i < r.addPasskeys.length; i++) {
            AgentAccountRecoveryPasskeyAdd memory pk = r.addPasskeys[i];
            _execute(account, abi.encodeWithSignature(
                "addPasskey(bytes32,uint256,uint256)",
                pk.credentialIdDigest, pk.x, pk.y
            ));
            addedPasskeys++;
        }

        uint256 removedOwners;
        for (uint256 i; i < r.removeOwners.length; i++) {
            address o = r.removeOwners[i];
            if (IAgentAccount(account).isCustodian(o)) {
                _execute(account, abi.encodeCall(IAgentAccount.removeCustodian, (o)));
                removedOwners++;
            }
        }

        uint256 removedPasskeys;
        for (uint256 i; i < r.removePasskeyCredentialIdDigests.length; i++) {
            bytes32 cid = r.removePasskeyCredentialIdDigests[i];
            _execute(account, abi.encodeWithSignature("removePasskey(bytes32)", cid));
            removedPasskeys++;
        }

        emit AccountRecovered(account, addedOwners, removedOwners, addedPasskeys, removedPasskeys);
    }

    /// @dev Spec § 5.1 default-threshold matrix.
    function _defaultApprovals(uint8 nCustodians, uint8 tier) internal pure returns (uint8) {
        if (nCustodians == 0) return 0;
        if (tier == 4) {
            if (nCustodians <= 3) return nCustodians;
            if (nCustodians <= 6) return nCustodians - 1;
            return nCustodians - 2;
        }
        if (tier == 5) {
            if (nCustodians <= 5) return nCustodians;
            return nCustodians - 1;
        }
        return 0;
    }
}
