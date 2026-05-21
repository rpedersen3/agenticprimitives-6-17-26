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
 *         pre-extraction surface. The custody actions enum is in
 *         phase 6g.1 renamed from CustodyAction → CustodyAction (this
 *         phase) but the enum VALUES are kept temporarily for safer
 *         migration; phase 6g.1-b renames the values + state-vars +
 *         function names + EIP-712 typehashes.
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
        RecoverAccount             // 14 — T6
    }

    struct AdminProposal {
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
        uint8 mode;                                       // 0=single, 1=hybrid, 2=threshold, 3=org
        uint8 recoveryThreshold;
        uint256 t3HighValueCeiling;
        mapping(uint8 => uint8) thresholdByTier;
        mapping(uint8 => uint32) timelockByTier;
        mapping(address => bool) guardians;
        uint256 guardianCount;
        uint256 nextProposalId;
        mapping(uint256 => AdminProposal) pending;
        mapping(uint256 => mapping(address => bool)) proposerSigners;
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

    bytes32 internal constant ADMIN_PROPOSE_TYPEHASH = keccak256(
        "AdminProposeRequest(address account,uint8 action,bytes32 argsHash,uint256 proposalId)"
    );
    bytes32 internal constant ADMIN_EXECUTE_TYPEHASH = keccak256(
        "AdminExecuteRequest(address account,uint8 action,bytes32 argsHash,uint256 proposalId,uint64 eta)"
    );
    bytes32 internal constant ADMIN_CANCEL_TYPEHASH = keccak256(
        "AdminCancelRequest(address account,uint8 action,bytes32 argsHash,uint256 proposalId,uint64 eta)"
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
        uint256 proposalId
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(ADMIN_PROPOSE_TYPEHASH, account, uint8(action), keccak256(args), proposalId))
        );
    }

    function _hashExecuteRequest(
        address account,
        CustodyAction action,
        bytes memory args,
        uint256 proposalId,
        uint64 eta
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(ADMIN_EXECUTE_TYPEHASH, account, uint8(action), keccak256(args), proposalId, eta))
        );
    }

    function _hashCancelRequest(
        address account,
        CustodyAction action,
        bytes memory args,
        uint256 proposalId,
        uint64 eta
    ) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(ADMIN_CANCEL_TYPEHASH, account, uint8(action), keccak256(args), proposalId, eta))
        );
    }

    /// @dev Spec 207 § 8 — first 24h of the T6 timelock is the
    ///      primary-owner cancel window.
    uint64 internal constant RECOVERY_PRIMARY_CANCEL_WINDOW = 24 hours;

    // ─── Events ───────────────────────────────────────────────────────

    event CustodyPolicyInstalled(address indexed account, uint8 mode, uint8 recoveryThreshold);
    event CustodyPolicyUninstalled(address indexed account);

    event AdminProposed(address indexed account, uint256 indexed proposalId, CustodyAction indexed action, uint64 eta, address proposer);
    event AdminExecuted(address indexed account, uint256 indexed proposalId);
    event AdminCancelled(address indexed account, uint256 indexed proposalId);
    event GuardianAdded(address indexed account, address indexed guardian);
    event GuardianRemoved(address indexed account, address indexed guardian);
    event ThresholdChanged(address indexed account, uint8 indexed tier, uint8 oldValue, uint8 newValue);
    event ModeChanged(address indexed account, uint8 oldMode, uint8 newMode);
    event T3CeilingChanged(address indexed account, uint256 oldCeiling, uint256 newCeiling);
    event RecoveryThresholdChanged(address indexed account, uint8 oldValue, uint8 newValue);
    event OwnersRotated(address indexed account, uint256 newOwnerCount);
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

    error InvalidAdminAction(uint8 action);
    error InvalidTier(uint8 tier);
    error ProposalNotFound(uint256 proposalId);
    error ProposalAlreadyExecuted(uint256 proposalId);
    error ProposalAlreadyCancelled(uint256 proposalId);
    error ProposalNotReady(uint256 proposalId, uint64 eta);
    error AdminInsufficientQuorum(uint256 supplied, uint8 required);
    error AdminDuplicateOrUnsortedSigner(address signer);
    error AdminUnauthorizedSigner(address signer);
    error GuardianAlreadyExists(address guardian);
    error GuardianDoesNotExist(address guardian);
    error InvalidMode(uint8 mode_);
    error InvalidThresholdValue(uint8 thr);
    error RecoveryRequiresGuardians();
    error EmptyOwnerSet();
    error AdminActionNotYetImplemented(uint8 action);
    error CannotDowngradeWithGuardians();
    error TimelockRequiredForTier(uint8 tier);
    error SeparationOfDutiesViolation(address signer);
    error RecoveryRequiresGuardianQuorum();
    error UnauthorizedGuardian(address signer);
    error ZeroAddress();

    // ─── ERC-7579 lifecycle ───────────────────────────────────────────

    /**
     * Install-time init data shape:
     *   abi.encode(
     *     uint8 mode,
     *     uint8 recoveryThreshold,
     *     address[] guardians,
     *     uint8[7] thresholdByTier,   // index 0 unused; T1..T6 use 1..6
     *     uint32[7] timelockByTier,
     *     uint256 t3HighValueCeiling,
     *     address approvedHashRegistry
     *   )
     */
    function onInstall(bytes calldata data) external {
        address account = msg.sender;
        Config storage c = _configs[account];
        if (c.installed) revert AlreadyInstalledOn(account);

        (
            uint8 modeVal,
            uint8 recThr,
            address[] memory guardians,
            uint8[7] memory thresholds,
            uint32[7] memory timelocks,
            uint256 t3Ceiling,
            address approvedHashReg
        ) = abi.decode(data, (uint8, uint8, address[], uint8[7], uint32[7], uint256, address));

        if (modeVal > 3) revert InvalidMode(modeVal);

        c.installed = true;
        c.mode = modeVal;
        c.recoveryThreshold = recThr;
        c.t3HighValueCeiling = t3Ceiling;
        c.approvedHashRegistry = approvedHashReg;

        for (uint8 t = 1; t <= 6; t++) {
            if (thresholds[t] > 0) c.thresholdByTier[t] = thresholds[t];
            if (timelocks[t] > 0) c.timelockByTier[t] = timelocks[t];
        }

        for (uint256 i; i < guardians.length; i++) {
            address g = guardians[i];
            if (g == address(0)) revert ZeroAddress();
            if (c.guardians[g]) revert GuardianAlreadyExists(g);
            c.guardians[g] = true;
            c.guardianCount += 1;
        }

        emit CustodyPolicyInstalled(account, modeVal, recThr);
    }

    function onUninstall(bytes calldata) external {
        address account = msg.sender;
        Config storage c = _configs[account];
        if (!c.installed) revert NotInstalledOn(account);
        c.installed = false;
        // Per-account state (proposals, guardians, thresholds) intentionally
        // NOT zeroed here — re-install on the same account would clobber.
        // Zeroing is a defensive choice for a future hardening pass.
        emit CustodyPolicyUninstalled(account);
    }

    // ─── Public propose / execute / cancel ──────────────────────────

    function proposeAdmin(
        address account,
        CustodyAction action,
        bytes calldata args,
        bytes calldata quorumSigs
    ) external returns (uint256 proposalId) {
        Config storage c = _configs[account];
        if (!c.installed) revert NotInstalledOn(account);

        uint8 tier = _tierFor(action);
        uint32 timelock = _timelockValue(c, tier);

        if ((tier == 5 || tier == 6) && timelock == 0) {
            revert TimelockRequiredForTier(tier);
        }

        bool isRecovery = (action == CustodyAction.RecoverAccount);
        uint8 reqThreshold;
        if (isRecovery) {
            if (c.guardianCount == 0 || c.recoveryThreshold == 0) {
                revert RecoveryRequiresGuardianQuorum();
            }
            reqThreshold = c.recoveryThreshold;
        } else {
            reqThreshold = _thresholdValue(c, tier);
        }

        uint64 nowTs = uint64(block.timestamp);
        uint64 eta = uint64(nowTs + timelock);
        proposalId = ++c.nextProposalId;
        bytes32 payloadHash = _hashProposeRequest(account, action, args, proposalId);
        address[] memory propSigners = _verifyQuorum(account, c, payloadHash, quorumSigs, reqThreshold, isRecovery);

        c.pending[proposalId] = AdminProposal({
            action: action,
            args: args,
            proposedAt: nowTs,
            eta: eta,
            proposer: msg.sender,
            executed: false,
            cancelled: false
        });

        for (uint256 i; i < propSigners.length; i++) {
            c.proposerSigners[proposalId][propSigners[i]] = true;
        }

        emit AdminProposed(account, proposalId, action, eta, msg.sender);
    }

    function executeAdmin(address account, uint256 proposalId, bytes calldata quorumSigs) external {
        Config storage c = _configs[account];
        if (!c.installed) revert NotInstalledOn(account);

        AdminProposal storage p = c.pending[proposalId];
        if (p.eta == 0) revert ProposalNotFound(proposalId);
        if (p.executed) revert ProposalAlreadyExecuted(proposalId);
        if (p.cancelled) revert ProposalAlreadyCancelled(proposalId);
        if (block.timestamp < p.eta) revert ProposalNotReady(proposalId, p.eta);

        bool isRecovery = (p.action == CustodyAction.RecoverAccount);
        uint8 tier = _tierFor(p.action);
        uint8 reqThreshold = isRecovery ? c.recoveryThreshold : _thresholdValue(c, tier);
        bytes32 payloadHash = _hashExecuteRequest(account, p.action, p.args, proposalId, p.eta);
        address[] memory execSigners = _verifyQuorum(account, c, payloadHash, quorumSigs, reqThreshold, isRecovery);

        if (c.mode == 3 && !isRecovery) {
            for (uint256 i; i < execSigners.length; i++) {
                if (c.proposerSigners[proposalId][execSigners[i]]) {
                    revert SeparationOfDutiesViolation(execSigners[i]);
                }
            }
        }

        p.executed = true;
        emit AdminExecuted(account, proposalId);
        _applyAdminAction(account, c, p.action, p.args);
    }

    function cancelAdmin(address account, uint256 proposalId, bytes calldata quorumSigs) external {
        Config storage c = _configs[account];
        if (!c.installed) revert NotInstalledOn(account);

        AdminProposal storage p = c.pending[proposalId];
        if (p.eta == 0) revert ProposalNotFound(proposalId);
        if (p.executed) revert ProposalAlreadyExecuted(proposalId);
        if (p.cancelled) revert ProposalAlreadyCancelled(proposalId);

        bytes32 payloadHash = _hashCancelRequest(account, p.action, p.args, proposalId, p.eta);

        if (p.action == CustodyAction.RecoverAccount) {
            uint64 cancelWindowEnds = p.proposedAt + RECOVERY_PRIMARY_CANCEL_WINDOW;
            bool inOwnerCancelWindow = block.timestamp < cancelWindowEnds;
            uint8 reqThreshold = inOwnerCancelWindow
                ? _thresholdValue(c, 4)
                : c.recoveryThreshold;
            _verifyQuorum(account, c, payloadHash, quorumSigs, reqThreshold, !inOwnerCancelWindow);
        } else {
            uint8 tier = _tierFor(p.action);
            uint8 reqThreshold = _thresholdValue(c, tier);
            _verifyQuorum(account, c, payloadHash, quorumSigs, reqThreshold, false);
        }

        p.cancelled = true;
        emit AdminCancelled(account, proposalId);
    }

    // ─── Views ──────────────────────────────────────────────────────

    function mode(address account) external view returns (uint8) {
        return _configs[account].mode;
    }

    function threshold(address account, uint8 tier) external view returns (uint8) {
        return _thresholdValue(_configs[account], tier);
    }

    function recoveryThreshold(address account) external view returns (uint8) {
        return _configs[account].recoveryThreshold;
    }

    function isGuardian(address account, address signer) external view returns (bool) {
        return _configs[account].guardians[signer];
    }

    function guardianCount(address account) external view returns (uint256) {
        return _configs[account].guardianCount;
    }

    function proposalCount(address account) external view returns (uint256) {
        return _configs[account].nextProposalId;
    }

    function t3HighValueCeiling(address account) external view returns (uint256) {
        return _configs[account].t3HighValueCeiling;
    }

    function timelockDuration(address account, uint8 tier) external view returns (uint32) {
        return _timelockValue(_configs[account], tier);
    }

    function approvedHashRegistry(address account) external view returns (address) {
        return _configs[account].approvedHashRegistry;
    }

    function isInstalledOn(address account) external view returns (bool) {
        return _configs[account].installed;
    }

    function getPendingAdmin(address account, uint256 proposalId) external view returns (
        CustodyAction action,
        bytes memory args,
        uint64 proposedAt,
        uint64 eta,
        address proposer,
        bool executed,
        bool cancelled
    ) {
        AdminProposal storage p = _configs[account].pending[proposalId];
        return (p.action, p.args, p.proposedAt, p.eta, p.proposer, p.executed, p.cancelled);
    }

    /// @notice Pure helper exposing the default-threshold matrix from
    ///         spec § 5.1 — owners over n=1..N produce per-tier defaults.
    function defaultThreshold(uint8 nOwners, uint8 tier) external pure returns (uint8) {
        return _defaultThreshold(nOwners, tier);
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

    function _thresholdValue(Config storage c, uint8 tier) internal view returns (uint8) {
        if (tier == 0 || tier > 6) revert InvalidTier(tier);
        uint8 v = c.thresholdByTier[tier];
        return v == 0 ? 1 : v;
    }

    function _timelockValue(Config storage c, uint8 tier) internal view returns (uint32) {
        if (tier == 0 || tier > 6) revert InvalidTier(tier);
        return c.timelockByTier[tier];
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
                if (!c.guardians[signer]) revert UnauthorizedGuardian(signer);
            } else {
                if (!IAgentAccount(account).isOwner(signer)) revert AdminUnauthorizedSigner(signer);
            }
            signers[i] = signer;
        }
    }

    // ─── Action dispatcher + handlers ──────────────────────────────

    function _applyAdminAction(
        address account,
        Config storage c,
        CustodyAction action,
        bytes memory args
    ) internal {
        if (action == CustodyAction.AddCustodian) {
            (address newOwner) = abi.decode(args, (address));
            _execute(account, abi.encodeCall(IAgentAccount.addOwner, (newOwner)));
        } else if (action == CustodyAction.RemoveCustodian) {
            (address oldOwner) = abi.decode(args, (address));
            _execute(account, abi.encodeCall(IAgentAccount.removeOwner, (oldOwner)));
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
            (address[] memory newOwners) = abi.decode(args, (address[]));
            _applyRotateAllOwners(account, newOwners);
        } else if (action == CustodyAction.ChangeValueCeiling) {
            (uint256 newCeiling) = abi.decode(args, (uint256));
            _applyChangeT3Ceiling(account, c, newCeiling);
        } else if (action == CustodyAction.SetRecoveryApprovals) {
            (uint8 newThr) = abi.decode(args, (uint8));
            _applySetRecoveryThreshold(account, c, newThr);
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
            revert AdminActionNotYetImplemented(uint8(action));
        } else {
            revert InvalidAdminAction(uint8(action));
        }
    }

    /// @dev Single entry-point for account self-calls. The account's
    ///      `executeFromModule` does the EVM-level call; when target ==
    ///      account, msg.sender at the callee is the account itself,
    ///      satisfying onlySelf gates on `addOwner` / `removeOwner` / etc.
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
        if (c.guardians[g]) revert GuardianAlreadyExists(g);
        c.guardians[g] = true;
        c.guardianCount += 1;
        emit GuardianAdded(account, g);
    }

    function _applyRemoveGuardian(address account, Config storage c, address g) internal {
        if (!c.guardians[g]) revert GuardianDoesNotExist(g);
        if (c.recoveryThreshold > 0 && c.guardianCount - 1 < c.recoveryThreshold) {
            revert RecoveryRequiresGuardians();
        }
        c.guardians[g] = false;
        c.guardianCount -= 1;
        emit GuardianRemoved(account, g);
    }

    function _applyChangeMode(address account, Config storage c, uint8 newMode) internal {
        if (newMode > 3) revert InvalidMode(newMode);
        uint8 oldMode = c.mode;
        if (newMode == 0 && c.guardianCount > 0) revert CannotDowngradeWithGuardians();
        c.mode = newMode;
        emit ModeChanged(account, oldMode, newMode);
    }

    function _applyRotateAllOwners(address account, address[] memory newOwners) internal {
        if (newOwners.length == 0) revert EmptyOwnerSet();
        uint256 added;
        for (uint256 i; i < newOwners.length; i++) {
            address o = newOwners[i];
            if (o == address(0)) revert ZeroAddress();
            if (!IAgentAccount(account).isOwner(o)) {
                _execute(account, abi.encodeCall(IAgentAccount.addOwner, (o)));
                added++;
            }
        }
        emit OwnersRotated(account, added);
    }

    function _applyChangeT3Ceiling(address account, Config storage c, uint256 newCeiling) internal {
        uint256 oldCeiling = c.t3HighValueCeiling;
        c.t3HighValueCeiling = newCeiling;
        emit T3CeilingChanged(account, oldCeiling, newCeiling);
    }

    function _applySetRecoveryThreshold(address account, Config storage c, uint8 newThr) internal {
        if (newThr > 0 && c.guardianCount < newThr) revert RecoveryRequiresGuardians();
        if (newThr > c.guardianCount) revert InvalidThresholdValue(newThr);
        uint8 oldThr = c.recoveryThreshold;
        c.recoveryThreshold = newThr;
        emit RecoveryThresholdChanged(account, oldThr, newThr);
    }

    function _applyRecoverAccount(address account, AgentAccountRecoveryArgs memory r) internal {
        uint256 addedOwners;
        for (uint256 i; i < r.addOwners.length; i++) {
            address o = r.addOwners[i];
            if (o == address(0)) revert ZeroAddress();
            if (!IAgentAccount(account).isOwner(o)) {
                _execute(account, abi.encodeCall(IAgentAccount.addOwner, (o)));
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
            if (IAgentAccount(account).isOwner(o)) {
                _execute(account, abi.encodeCall(IAgentAccount.removeOwner, (o)));
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
    function _defaultThreshold(uint8 nOwners, uint8 tier) internal pure returns (uint8) {
        if (nOwners == 0) return 0;
        if (tier == 4) {
            if (nOwners <= 3) return nOwners;
            if (nOwners <= 6) return nOwners - 1;
            return nOwners - 2;
        }
        if (tier == 5) {
            if (nOwners <= 5) return nOwners;
            return nOwners - 1;
        }
        return 0;
    }
}
