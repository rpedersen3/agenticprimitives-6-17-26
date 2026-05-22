// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./AgentAccount.sol";
import {AgentAccountInitParams} from "./IAgentAccount.sol";
import {CustodyPolicy} from "./custody/CustodyPolicy.sol";
import "./governance/GovernanceManaged.sol";

/**
 * @title AgentAccountFactory
 * @notice Factory for deploying AgentAccount proxies with deterministic
 *         CREATE2 addresses. Phase 6f.4 pivot — collapsed to two
 *         entries reflecting the unified custody architecture:
 *
 *           - `createPersonAgent(...)`       — one human's smart agent
 *                                              (passkey + / or external).
 *                                              NO custody policy installed
 *                                              (single signer; admin
 *                                              changes go through the
 *                                              account's own onlySelf
 *                                              surface).
 *           - `createMultiSigSmartAgent(...)` — Org / Treasury / any
 *                                              account with >1 human
 *                                              signer OR with a custody
 *                                              policy (CustodyPolicy
 *                                              module installed
 *                                              atomically).
 *
 *         Both entries accept any combination of external custodians
 *         (EOAs / SIWE / third-party smart wallets) and an initial
 *         passkey. At least one signer must be supplied. The
 *         AgentAccount initializer enforces the spec 211 § 3 / spec
 *         212 § 2.2 invariant: no agenticprimitives AgentAccount can
 *         appear in the custodian set (ERC-165 marker check).
 *
 * Phase A (spec 007) capability roles:
 *   `bundlerSigner` and `sessionIssuer` are factory-level capability
 *   addresses. They are NEVER custodians of any deployed account; each
 *   account reads them off this factory on demand. Phase A.5 made both
 *   mutable under governance — rotation flows through a governance
 *   proposal + 48h timelock and propagates automatically to every
 *   existing AgentAccount.
 */
contract AgentAccountFactory is GovernanceManaged {
    AgentAccount public immutable accountImplementation;
    address public immutable delegationManager;

    address public bundlerSigner;
    address public sessionIssuer;

    event AgentAccountCreated(
        address indexed account,
        bool withValidator,
        uint256 nExternalCustodians,
        bool withPasskey,
        uint256 salt
    );

    event BundlerSignerChanged(address indexed oldVal, address indexed newVal);
    event SessionIssuerChanged(address indexed oldVal, address indexed newVal);

    uint256[50] private __gap;

    // ─── Errors ─────────────────────────────────────────────────────────

    error InvalidMode(uint8 mode);
    error NoInitialSigner();
    error InsufficientTrusteesForMode(uint8 mode, uint256 actual, uint256 required);
    error ValidatorRequired();
    error ZeroAddress();

    constructor(
        IEntryPoint entryPoint_,
        address delegationManager_,
        address bundlerSigner_,
        address sessionIssuer_,
        address governance_
    ) GovernanceManaged(governance_) {
        accountImplementation = new AgentAccount(entryPoint_);
        delegationManager = delegationManager_;
        bundlerSigner = bundlerSigner_;
        sessionIssuer = sessionIssuer_;
        emit BundlerSignerChanged(address(0), bundlerSigner_);
        emit SessionIssuerChanged(address(0), sessionIssuer_);
    }

    // ─── Governance-only setters ─────────────────────────────────────────

    function setBundlerSigner(address newBundler) external onlyGovernance {
        address old = bundlerSigner;
        bundlerSigner = newBundler;
        emit BundlerSignerChanged(old, newBundler);
    }

    function setSessionIssuer(address newIssuer) external onlyGovernance {
        address old = sessionIssuer;
        sessionIssuer = newIssuer;
        emit SessionIssuerChanged(old, newIssuer);
    }

    // ─── Factory entries ────────────────────────────────────────────────

    /**
     * @notice Deploy a Person Smart Agent — one human's on-chain
     *         identity. No CustodyPolicy module is installed; admin
     *         changes go through the account's onlySelf surface
     *         (addCustodian / addPasskey via UserOp).
     *
     *         Accepts a passkey (most common — phase 6f.4 default), one
     *         or more external custodians (EOA / SIWE / smart wallet),
     *         or both for users who connect a wallet AND enroll a
     *         passkey on the same Person.PSA.
     *
     * @param externalCustodians External signer addresses for this PSA.
     *        EOAs / SIWE / third-party smart wallets. Any
     *        agenticprimitives AgentAccount in this list reverts (ERC-165
     *        marker check inside the initializer).
     * @param passkeyCredentialIdDigest keccak256(credentialId) — or
     *        bytes32(0) if no passkey.
     * @param passkeyX / passkeyY P-256 pubkey, or 0/0 for no passkey.
     * @param salt CREATE2 deployment salt.
     */
    function createPersonAgent(
        address[] calldata externalCustodians,
        bytes32 passkeyCredentialIdDigest,
        uint256 passkeyX,
        uint256 passkeyY,
        uint256 salt
    ) external returns (AgentAccount account) {
        bool hasPasskey = passkeyX != 0 && passkeyY != 0;
        if (externalCustodians.length == 0 && !hasPasskey) revert NoInitialSigner();

        address addr = _getAddressForPersonAgent(
            externalCustodians, passkeyCredentialIdDigest, passkeyX, passkeyY, salt
        );
        if (addr.code.length > 0) return AgentAccount(payable(addr));

        ERC1967Proxy proxy = new ERC1967Proxy{salt: bytes32(salt)}(
            address(accountImplementation),
            _initData(externalCustodians, passkeyCredentialIdDigest, passkeyX, passkeyY)
        );
        account = AgentAccount(payable(address(proxy)));

        emit AgentAccountCreated(
            address(account),
            /*withValidator=*/ false,
            externalCustodians.length,
            hasPasskey,
            salt
        );
    }

    /// @notice Counterfactual address for `createPersonAgent`.
    function getAddressForPersonAgent(
        address[] calldata externalCustodians,
        bytes32 passkeyCredentialIdDigest,
        uint256 passkeyX,
        uint256 passkeyY,
        uint256 salt
    ) external view returns (address) {
        return _getAddressForPersonAgent(
            externalCustodians, passkeyCredentialIdDigest, passkeyX, passkeyY, salt
        );
    }

    /**
     * @notice Deploy a multi-sig Smart Agent — Org / Treasury / any
     *         account that needs a CustodyPolicy module (m-of-n approvals
     *         on admin actions, scheduled changes, recovery).
     *
     *         CustodyPolicy is installed atomically at deploy. The
     *         per-tier threshold matrix from `defaultApprovals(N, t)`
     *         (spec § 5.1) is calibrated against
     *         `externalCustodians.length + (passkey ? 1 : 0)`.
     *
     *         Per spec § 8, the factory refuses to deploy higher
     *         coordination modes without enough trustees (`threshold` ≥ 2,
     *         `org` ≥ 3).
     *
     * @param params Init params bundle.
     * @param validator CustodyPolicy module address (queried for the
     *        default-approvals matrix).
     * @param safetyDelaySeconds T4 timelock (0 → spec default 1h).
     * @param salt CREATE2 deployment salt.
     */
    function createMultiSigSmartAgent(
        AgentAccountInitParams calldata params,
        address validator,
        uint32 safetyDelaySeconds,
        uint256 salt
    ) external returns (AgentAccount account) {
        _validateMultiSigInitParams(params);
        if (validator == address(0)) revert ValidatorRequired();

        address addr = _getAddressForMultiSigSmartAgent(params, salt);
        if (addr.code.length > 0) return AgentAccount(payable(addr));

        ERC1967Proxy proxy = new ERC1967Proxy{salt: bytes32(salt)}(
            address(accountImplementation),
            _initData(
                params.custodians,
                params.initialPasskeyCredentialIdDigest,
                params.initialPasskeyX,
                params.initialPasskeyY
            )
        );
        account = AgentAccount(payable(address(proxy)));

        bytes memory validatorInit = _buildValidatorInitData(params, validator, safetyDelaySeconds);
        account.installModule(2 /* MODULE_TYPE_EXECUTOR */, validator, validatorInit);

        bool hasPasskey = params.initialPasskeyX != 0 && params.initialPasskeyY != 0;
        emit AgentAccountCreated(
            address(account),
            /*withValidator=*/ true,
            params.custodians.length,
            hasPasskey,
            salt
        );
    }

    /// @notice Counterfactual address for `createMultiSigSmartAgent`.
    function getAddressForMultiSigSmartAgent(
        AgentAccountInitParams calldata params,
        uint256 salt
    ) external view returns (address) {
        _validateMultiSigInitParams(params);
        return _getAddressForMultiSigSmartAgent(params, salt);
    }

    // ─── Internals ──────────────────────────────────────────────────────

    /// @dev Build the unified-initializer calldata. Used by both factory
    ///      entries + counterfactual derivation so the CREATE2 address
    ///      computation matches the actual deploy bytecode exactly.
    function _initData(
        address[] memory externalCustodians,
        bytes32 passkeyCredentialIdDigest,
        uint256 passkeyX,
        uint256 passkeyY
    ) internal view returns (bytes memory) {
        return abi.encodeCall(
            AgentAccount.initialize,
            (
                externalCustodians,
                passkeyCredentialIdDigest,
                passkeyX,
                passkeyY,
                delegationManager,
                address(this)
            )
        );
    }

    function _getAddressForPersonAgent(
        address[] calldata externalCustodians,
        bytes32 passkeyCredentialIdDigest,
        uint256 passkeyX,
        uint256 passkeyY,
        uint256 salt
    ) internal view returns (address) {
        bytes memory initData = _initData(
            externalCustodians, passkeyCredentialIdDigest, passkeyX, passkeyY
        );
        return _create2Address(initData, salt);
    }

    function _getAddressForMultiSigSmartAgent(
        AgentAccountInitParams calldata params,
        uint256 salt
    ) internal view returns (address) {
        bytes memory initData = _initData(
            params.custodians,
            params.initialPasskeyCredentialIdDigest,
            params.initialPasskeyX,
            params.initialPasskeyY
        );
        return _create2Address(initData, salt);
    }

    function _create2Address(bytes memory initData, uint256 salt) internal view returns (address) {
        bytes memory proxyBytecode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(address(accountImplementation), initData)
        );
        bytes32 bytecodeHash = keccak256(proxyBytecode);
        return address(uint160(uint256(keccak256(
            abi.encodePacked(bytes1(0xff), address(this), bytes32(salt), bytecodeHash)
        ))));
    }

    /// @dev Shared validation for `createMultiSigSmartAgent` deploy +
    ///      counterfactual paths. The AgentAccount initializer enforces
    ///      "at least one signer"; here we add the policy-specific
    ///      checks (mode bounds + trustee minima per spec § 8).
    function _validateMultiSigInitParams(AgentAccountInitParams calldata params) internal pure {
        if (params.mode > 3) revert InvalidMode(params.mode);

        uint256 nTrustees = params.trustees.length;
        if (params.mode == 2 /* threshold */ && nTrustees < 2) {
            revert InsufficientTrusteesForMode(params.mode, nTrustees, 2);
        }
        if (params.mode == 3 /* org */ && nTrustees < 3) {
            revert InsufficientTrusteesForMode(params.mode, nTrustees, 3);
        }
    }

    /// @dev Composes the ABI-encoded init blob the validator's `onInstall`
    ///      expects. Pulls per-tier thresholds from the spec § 5.1
    ///      matrix; sets T4=1h (or override) / T5=24h / T6=48h default
    ///      timelocks; default T3 ceiling 0.01 ETH; recovery threshold
    ///      floor(N/2)+1 when guardians > 0.
    ///
    ///      `N` for the threshold-matrix is the total signer count =
    ///      external custodians + (1 if initial passkey, else 0).
    function _buildValidatorInitData(
        AgentAccountInitParams calldata params,
        address validator,
        uint32 safetyDelaySeconds
    ) internal view returns (bytes memory) {
        uint256 nSigners = params.custodians.length;
        if (params.initialPasskeyX != 0 && params.initialPasskeyY != 0) nSigners++;

        uint8[7] memory thresholds;
        for (uint8 t = 1; t <= 5; t++) {
            thresholds[t] = CustodyPolicy(validator).defaultApprovals(uint8(nSigners), t);
        }

        uint32[7] memory timelocks;
        timelocks[4] = safetyDelaySeconds == 0 ? uint32(1 hours) : safetyDelaySeconds;
        timelocks[5] = 24 hours;
        timelocks[6] = 48 hours;

        uint8 recThr = params.trustees.length > 0
            ? uint8(params.trustees.length / 2 + 1)
            : 0;

        return abi.encode(
            params.mode,
            recThr,
            params.trustees,
            thresholds,
            timelocks,
            uint256(0.01 ether),
            address(0)
        );
    }
}
