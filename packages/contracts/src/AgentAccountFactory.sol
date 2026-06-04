// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./AgentAccount.sol";
import {AgentAccountInitParams} from "./IAgentAccount.sol";
import {CustodyPolicy} from "./custody/CustodyPolicy.sol";
import "./governance/GovernanceManaged.sol";

/**
 * @title AgentAccountFactory
 * @notice Single-entry factory for AgentAccount proxies with
 *         deterministic CREATE2 addresses. Phase 6f.5 -- collapsed
 *         createPersonAgent + createMultiSigSmartAgent into one
 *         entry point so every account on chain has the same shape;
 *         the only axis is `mode` on the init params.
 *
 *           - mode == 0 → no CustodyPolicy installed. Single-signer
 *             "simple" shape (admin changes go through the account's
 *             onlySelf surface only). Trustees ignored.
 *           - mode  > 0 → CustodyPolicy module installed at birth;
 *             trustees are REQUIRED (≥1 for hybrid, ≥2 for threshold,
 *             ≥3 for org per spec § 8). Cannot ship an un-recoverable
 *             multi-sig account through this path.
 *
 *         All accounts accept any combination of external custodians
 *         (EOAs / SIWE / third-party smart wallets) plus an optional
 *         initial passkey. At least one signer must be supplied. The
 *         AgentAccount initializer enforces the spec 211 § 3 /
 *         spec 212 § 2.2 invariant: no agenticprimitives AgentAccount
 *         may appear in another account's custodian set (ERC-165
 *         marker check).
 *
 *         The canonical CustodyPolicy address is wired at construction
 *         (factory-immutable) -- there is no per-call validator
 *         override. Swapping CustodyPolicy versions means redeploying
 *         the factory, which is the same blast radius as a CREATE2
 *         salt bump.
 *
 * Phase A (spec 007) capability roles:
 *   `bundlerSigner` and `sessionIssuer` are factory-level capability
 *   addresses. They are NEVER custodians of any deployed account; each
 *   account reads them off this factory on demand. Phase A.5 made both
 *   mutable under governance -- rotation flows through a governance
 *   proposal + 48h timelock and propagates automatically to every
 *   existing AgentAccount.
 */
contract AgentAccountFactory is GovernanceManaged {
    AgentAccount public immutable accountImplementation;
    address public immutable delegationManager;
    address public immutable custodyPolicy;
    /// @dev Spec 253 — the ApprovedHashRegistry baked (immutable) into the
    ///      AgentAccount impl this factory deploys; surfaced here for
    ///      deploy-time auditing. The account's `isValidSignature` 0x03
    ///      sentinel consults it; it is NOT a mutable factory-view.
    address public immutable approvedHashRegistry;

    address public bundlerSigner;
    address public sessionIssuer;

    event AgentAccountCreated(
        address indexed account,
        uint8 mode,
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
    error TrusteesRequiredForRecoverableMode(uint8 mode);
    error ZeroAddress();
    /// @notice R9.6 / ATL-SEC-05 -- thrown when `params.custodians.length`
    ///         exceeds `MAX_INITIAL_CUSTODIANS`. Without this cap,
    ///         `_buildValidatorInitData` casts `nSigners` to `uint8`
    ///         and silently truncates at 256, computing a wrong default
    ///         threshold for a misconfigured account. A self-hurt
    ///         footgun, not a cross-account vulnerability -- capped so
    ///         the misconfiguration fails closed at construction.
    error TooManyInitialCustodians(uint256 actual, uint256 max);

    /// @notice R9.6 / ATL-SEC-05 -- upper bound on initial custodians
    ///         passed via `AgentAccountInitParams`. 32 is deliberately
    ///         generous (every smart-account substrate we surveyed
    ///         caps well below 16) but well under the `uint8` truncation
    ///         threshold at `_buildValidatorInitData:252`.
    uint256 public constant MAX_INITIAL_CUSTODIANS = 32;

    constructor(
        IEntryPoint entryPoint_,
        address delegationManager_,
        address custodyPolicy_,
        address bundlerSigner_,
        address sessionIssuer_,
        address governance_,
        address approvedHashRegistry_
    ) GovernanceManaged(governance_) {
        if (custodyPolicy_ == address(0)) revert ZeroAddress();
        accountImplementation = new AgentAccount(entryPoint_, approvedHashRegistry_);
        approvedHashRegistry = approvedHashRegistry_;
        delegationManager = delegationManager_;
        custodyPolicy = custodyPolicy_;
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

    // ─── Factory entry ──────────────────────────────────────────────────

    /**
     * @notice Deploy an AgentAccount. Mode picks the shape:
     *           - 0 → simple (no CustodyPolicy)
     *           - 1 → hybrid (CustodyPolicy, ≥1 trustee required)
     *           - 2 → threshold (CustodyPolicy, ≥2 trustees required)
     *           - 3 → org (CustodyPolicy, ≥3 trustees required)
     *
     * @param params Init params bundle.
     * @param timelockOverrides Per-tier timelock override (index 0 unused;
     *        tier t uses index t for t in 1..6). Where the override is 0,
     *        the factory default applies: T4=1h, T5=24h, T6=48h. Demo
     *        deploys can set short overrides; production uses 0s
     *        everywhere to inherit the spec defaults. Ignored for mode 0.
     * @param salt CREATE2 deployment salt.
     */
    function createAgentAccount(
        AgentAccountInitParams calldata params,
        uint32[7] calldata timelockOverrides,
        uint256 salt
    ) external whenNotPaused returns (AgentAccount account) {
        // H7-C.10 / EXT3-010: gated behind the system-wide governance pause.
        // An incident-mode guardian can freeze new account creation while
        // an exploit is being investigated; unpause requires the 24h
        // timelock (see AgenticGovernance).
        _validateInitParams(params);

        address addr = _getAddressForAgentAccount(params, salt);
        if (addr.code.length > 0) return AgentAccount(payable(addr));

        ERC1967Proxy proxy = new ERC1967Proxy{salt: bytes32(salt)}(
            address(accountImplementation),
            _initData(params)
        );
        account = AgentAccount(payable(address(proxy)));

        if (params.mode > 0) {
            bytes memory validatorInit = _buildValidatorInitData(params, timelockOverrides);
            account.installModule(2 /* MODULE_TYPE_EXECUTOR */, custodyPolicy, validatorInit);
        }

        bool hasPasskey = params.initialPasskeyX != 0 && params.initialPasskeyY != 0;
        emit AgentAccountCreated(
            address(account),
            params.mode,
            params.custodians.length,
            hasPasskey,
            salt
        );
    }

    /// @notice Counterfactual address for `createAgentAccount`.
    function getAddressForAgentAccount(
        AgentAccountInitParams calldata params,
        uint256 salt
    ) external view returns (address) {
        _validateInitParams(params);
        return _getAddressForAgentAccount(params, salt);
    }

    // ─── Internals ──────────────────────────────────────────────────────

    /// @dev Build the unified-initializer calldata. Used by both factory
    ///      entries + counterfactual derivation so the CREATE2 address
    ///      computation matches the actual deploy bytecode exactly.
    function _initData(AgentAccountInitParams calldata params) internal view returns (bytes memory) {
        return abi.encodeCall(
            AgentAccount.initialize,
            (
                params.custodians,
                params.initialPasskeyCredentialIdDigest,
                params.initialPasskeyX,
                params.initialPasskeyY,
                params.initialPasskeyRpIdHash,
                delegationManager,
                address(this)
            )
        );
    }

    function _getAddressForAgentAccount(
        AgentAccountInitParams calldata params,
        uint256 salt
    ) internal view returns (address) {
        bytes memory initData = _initData(params);
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

    /// @dev Per-mode validation:
    ///        - mode ≤ 3
    ///        - at least one signer (custodian or passkey)
    ///        - modes 1-3 require trustees ≥ {1, 2, 3}
    ///
    ///      The AgentAccount initializer enforces the actual "≥1 signer"
    ///      check; we duplicate it here so counterfactual `getAddress`
    ///      consistently reverts on the same invariant.
    function _validateInitParams(AgentAccountInitParams calldata params) internal pure {
        if (params.mode > 3) revert InvalidMode(params.mode);

        bool hasPasskey = params.initialPasskeyX != 0 && params.initialPasskeyY != 0;
        if (params.custodians.length == 0 && !hasPasskey) revert NoInitialSigner();
        // R9.6 / ATL-SEC-05: cap the initial custodian set so
        // `_buildValidatorInitData`'s `uint8(nSigners)` cast can't
        // silently truncate. 32 is well above any rational config and
        // well below the uint8 boundary.
        if (params.custodians.length > MAX_INITIAL_CUSTODIANS) {
            revert TooManyInitialCustodians(params.custodians.length, MAX_INITIAL_CUSTODIANS);
        }

        if (params.mode == 0) return;

        uint256 nTrustees = params.trustees.length;
        if (nTrustees == 0) revert TrusteesRequiredForRecoverableMode(params.mode);
        if (params.mode == 2 && nTrustees < 2) {
            revert InsufficientTrusteesForMode(params.mode, nTrustees, 2);
        }
        if (params.mode == 3 && nTrustees < 3) {
            revert InsufficientTrusteesForMode(params.mode, nTrustees, 3);
        }
    }

    /// @dev Composes the ABI-encoded init blob the validator's `onInstall`
    ///      expects. Pulls per-tier thresholds from the spec § 5.1
    ///      matrix; uses caller-supplied timelock overrides where
    ///      non-zero, otherwise falls back to spec defaults
    ///      (T4=1h / T5=24h / T6=48h); default T3 ceiling 0.01 ETH;
    ///      recovery threshold floor(N/2)+1 (trustees are required for
    ///      modes 1-3 so this is always ≥ 1).
    ///
    ///      `N` for the threshold-matrix is the total signer count =
    ///      external custodians + (1 if initial passkey, else 0).
    function _buildValidatorInitData(
        AgentAccountInitParams calldata params,
        uint32[7] calldata timelockOverrides
    ) internal view returns (bytes memory) {
        uint256 nSigners = params.custodians.length;
        if (params.initialPasskeyX != 0 && params.initialPasskeyY != 0) nSigners++;

        uint8[7] memory thresholds;
        for (uint8 t = 1; t <= 5; t++) {
            thresholds[t] = CustodyPolicy(custodyPolicy).defaultApprovals(uint8(nSigners), t);
        }

        uint32[7] memory timelocks;
        timelocks[4] = timelockOverrides[4] == 0 ? uint32(1 hours)  : timelockOverrides[4];
        timelocks[5] = timelockOverrides[5] == 0 ? uint32(24 hours) : timelockOverrides[5];
        timelocks[6] = timelockOverrides[6] == 0 ? uint32(48 hours) : timelockOverrides[6];

        uint8 recThr = uint8(params.trustees.length / 2 + 1);

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
