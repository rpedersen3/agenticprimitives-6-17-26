// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./AgentAccount.sol";
import {AgentAccountInitParams} from "./IAgentAccount.sol";
import {CustodyPolicy} from "./modules/CustodyPolicy.sol";
import "./governance/GovernanceManaged.sol";

/**
 * @title AgentAccountFactory
 * @notice Factory for deploying AgentAccount proxies with deterministic CREATE2 addresses.
 *
 * Phase A (spec 007 — architecture hardening) — capability role split:
 *   - `bundlerSigner` and `sessionIssuer` are factory-level capability
 *     roles. They are NEVER added to any account's `_custodians` set. Each
 *     deployed account reads them from this factory via the
 *     `bundlerSigner()` / `sessionIssuer()` views.
 *
 * Phase A.5 (K1-Q1 resolution): both role addresses are now MUTABLE
 *     storage gated by the `Governance` multisig. Rotation flows through
 *     a governance proposal + 48h timelock and propagates AUTOMATICALLY
 *     to every existing AgentAccount (each account resolves the role
 *     through the factory at call time). The factory address stays
 *     stable; only the role addresses move.
 *
 *   - The previous third-arg "system co-owner" field (which made the
 *     master signer a co-owner of every deployed AgentAccount) is
 *     removed. Master can never sign userOps for a user account
 *     post-Phase-A.
 *
 * The factory itself remains the canonical address-resolution surface
 * for downstream services that need to know "who is the bundler" or
 * "who is the session-issuer" without per-account chain calls.
 */
contract AgentAccountFactory is GovernanceManaged {
    /// @notice The AgentAccount implementation (singleton).
    AgentAccount public immutable accountImplementation;

    /// @notice The DelegationManager address set on every new account.
    address public immutable delegationManager;

    /// @notice EOA authorized to submit ERC-4337 EntryPoint envelopes
    ///         (the bundler). Phase A.5 — MUTABLE under governance.
    address public bundlerSigner;

    /// @notice EOA authorized to co-sign session delegations the user
    ///         has pre-authorized. Phase A.5 — MUTABLE under governance.
    address public sessionIssuer;

    /// @notice Emitted when a new agent account is deployed.
    /// @dev System-key addresses intentionally omitted from the event —
    ///      they are factory-scoped, not per-account.
    event AgentAccountCreated(address indexed account, address indexed owner, uint256 salt);

    /// @notice Emitted when a passkey-owned agent account is deployed.
    ///         `account` is the proxy address; `credentialIdDigest` is
    ///         keccak256(credentialId) of the sole WebAuthn signer.
    /// @dev Spec 130 — passkey-only account creation path.
    event AgentAccountCreatedWithPasskey(
        address indexed account,
        bytes32 indexed credentialIdDigest,
        uint256 salt
    );

    /// @notice Emitted when governance rotates the bundler signer EOA.
    event BundlerSignerChanged(address indexed oldVal, address indexed newVal);

    /// @notice Emitted when governance rotates the session-issuer EOA.
    event SessionIssuerChanged(address indexed oldVal, address indexed newVal);

    /// @dev Storage gap reserves slots for future upgrades. Phase A.5
    ///      (SC7 § 3.1) — every contract with state ends with a gap so
    ///      additive upgrades don't shift downstream slots. The factory
    ///      itself is not upgradeable today, but the gap keeps options
    ///      open and standardises our storage discipline.
    uint256[50] private __gap;

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

    // ─── Governance-only setters ─────────────────────────────────────

    /// @notice Rotate the bundler signer EOA. Phase A.5 K1-Q1.
    /// @dev Callable only by the Governance contract executing a
    ///      passed proposal. Existing AgentAccount instances pick up
    ///      the new address automatically via `factory().bundlerSigner()`.
    function setBundlerSigner(address newBundler) external onlyGovernance {
        address old = bundlerSigner;
        bundlerSigner = newBundler;
        emit BundlerSignerChanged(old, newBundler);
    }

    /// @notice Rotate the session-issuer EOA. Phase A.5 K1-Q1.
    function setSessionIssuer(address newIssuer) external onlyGovernance {
        address old = sessionIssuer;
        sessionIssuer = newIssuer;
        emit SessionIssuerChanged(old, newIssuer);
    }

    /**
     * @notice Deploy a new AgentAccount proxy, or return the existing one if already deployed.
     * @param owner The initial owner of the agent account.
     * @param salt A unique salt for deterministic deployment.
     * @return account The deployed (or existing) agent account.
     */
    function createAccount(
        address owner,
        uint256 salt
    ) external returns (AgentAccount account) {
        address addr = getAddress(owner, salt);

        // If already deployed, return existing
        if (addr.code.length > 0) {
            return AgentAccount(payable(addr));
        }

        // Deploy ERC1967Proxy pointing to the implementation. The
        // account reads bundlerSigner / sessionIssuer from THIS factory
        // (address(this)) at runtime — no per-account storage needed.
        bytes memory initData = abi.encodeCall(
            AgentAccount.initialize,
            (owner, delegationManager, address(this))
        );

        ERC1967Proxy proxy = new ERC1967Proxy{salt: bytes32(salt)}(
            address(accountImplementation),
            initData
        );

        account = AgentAccount(payable(address(proxy)));
        emit AgentAccountCreated(address(account), owner, salt);
    }

    /**
     * @notice Compute the counterfactual address of an agent account.
     * @param owner The initial owner.
     * @param salt The deployment salt.
     * @return The deterministic address.
     */
    function getAddress(
        address owner,
        uint256 salt
    ) public view returns (address) {
        bytes memory initData = abi.encodeCall(
            AgentAccount.initialize,
            (owner, delegationManager, address(this))
        );

        bytes memory proxyBytecode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(address(accountImplementation), initData)
        );

        bytes32 bytecodeHash = keccak256(proxyBytecode);

        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            address(this),
                            bytes32(salt),
                            bytecodeHash
                        )
                    )
                )
            )
        );
    }

    // ─── Passkey-owned accounts (spec 130) ───────────────────────────

    /**
     * @notice Deploy a passkey-owned AgentAccount, or return the existing one.
     *
     *         The account has NO EOA owner — the WebAuthn credential at
     *         `(credentialIdDigest, x, y)` is the sole signer.
     *
     *         Counterfactual address binds (credentialIdDigest, x, y,
     *         salt): the same passkey at the same salt always lands at
     *         the same address; a different passkey lands at a different
     *         address because the init calldata (and therefore the
     *         proxy creation bytecode) differs.
     *
     * @param credentialIdDigest keccak256 of the WebAuthn credentialId.
     * @param x P-256 public key X.
     * @param y P-256 public key Y.
     * @param salt User-chosen salt (default 0 for one-account-per-passkey).
     */
    function createAccountWithPasskey(
        bytes32 credentialIdDigest,
        uint256 x,
        uint256 y,
        uint256 salt
    ) external returns (AgentAccount account) {
        address addr = getAddressForPasskey(credentialIdDigest, x, y, salt);

        if (addr.code.length > 0) {
            return AgentAccount(payable(addr));
        }

        bytes memory initData = abi.encodeCall(
            AgentAccount.initializeWithPasskey,
            (credentialIdDigest, x, y, delegationManager, address(this))
        );

        ERC1967Proxy proxy = new ERC1967Proxy{salt: bytes32(salt)}(
            address(accountImplementation),
            initData
        );

        account = AgentAccount(payable(address(proxy)));
        emit AgentAccountCreatedWithPasskey(address(account), credentialIdDigest, salt);
    }

    // ─── Threshold-policy deployment (spec 207 + 209) ─────────────────

    error InvalidMode(uint8 mode);
    error NoPrimarySigner();
    error InsufficientGuardiansForMode(uint8 mode, uint256 actual, uint256 required);

    /// @notice Emitted when an AgentAccount is deployed via the
    ///         threshold-policy factory entry. Carries the mode + N
    ///         owners + N guardians for off-chain indexers.
    event AgentAccountCreatedWithMode(
        address indexed account,
        address indexed validator,
        uint8 indexed mode,
        uint256 nOwners,
        uint256 nGuardians,
        uint256 salt
    );

    /**
     * @notice Deploy an `AgentAccount` configured per spec 207's
     *         threshold-policy surface + install the `CustodyPolicy`
     *         module atomically. Replaces the per-mode entry points
     *         (`createAccount` / `createAccountWithPasskey`) with a
     *         single API that handles all four modes from spec 207 § 4 —
     *         `single` / `hybrid` / `threshold` / `org`.
     *
     *         Per spec § 8, the factory refuses to deploy accounts in
     *         the higher-coordination modes without enough guardians:
     *           - `single` (0): no guardian requirement.
     *           - `hybrid` (1): no factory-level requirement.
     *           - `threshold` (2): ≥ 2 guardians required.
     *           - `org` (3): ≥ 3 guardians required.
     *
     *         At least one owner MUST be supplied (passkey-only init is
     *         a phase 7 follow-on through this path; for v0 use
     *         `createAccountWithPasskey` for passkey-only accounts).
     *         For multi-owner accounts (params.owners.length > 1) only
     *         the first owner is set at deploy; additional owners are
     *         added post-deploy via the validator's AddOwner action
     *         (T4, immediate since the default T4 timelock is 0). For
     *         passkey enrollment use AddPasskey via the validator.
     *
     * @param params  See `AgentAccountInitParams` in `IAgentAccount.sol`.
     * @param validator CustodyPolicy module address (callable; the
     *                  factory queries `defaultThreshold(N, t)` to
     *                  compute the spec § 5.1 matrix).
     * @param salt    CREATE2 deployment salt.
     */
    function createAccountWithMode(
        AgentAccountInitParams calldata params,
        address validator,
        uint256 salt
    ) external returns (AgentAccount account) {
        return createAccountWithModeCustomT4(params, validator, 0, salt);
    }

    /// @notice Same as `createAccountWithMode` but lets the caller pick the
    ///         T4 timelock (in seconds). Pass `0` for the spec default (1h).
    ///         Useful for demo / test accounts where the 1h wait between
    ///         propose and execute is friction. T5 (24h) and T6 (48h)
    ///         stay at spec defaults because spec 207 § 5 invariant
    ///         requires them to be > 0.
    function createAccountWithModeCustomT4(
        AgentAccountInitParams calldata params,
        address validator,
        uint32 t4TimelockSeconds,
        uint256 salt
    ) public returns (AgentAccount account) {
        _validateInitParams(params);
        if (validator == address(0)) revert ZeroAddress();

        address initialOwner = params.owners[0];

        address addr = getAddress(initialOwner, salt);
        if (addr.code.length > 0) {
            return AgentAccount(payable(addr));
        }

        bytes memory accountInit = abi.encodeCall(
            AgentAccount.initialize,
            (initialOwner, delegationManager, address(this))
        );
        ERC1967Proxy proxy = new ERC1967Proxy{salt: bytes32(salt)}(
            address(accountImplementation),
            accountInit
        );
        account = AgentAccount(payable(address(proxy)));

        bytes memory validatorInit = _buildValidatorInitData(params, validator, t4TimelockSeconds);
        account.installModule(2 /* MODULE_TYPE_EXECUTOR */, validator, validatorInit);

        emit AgentAccountCreatedWithMode(
            address(account),
            validator,
            params.mode,
            params.owners.length,
            params.guardians.length,
            salt
        );
    }

    /// @notice Counterfactual address for a threshold-policy account.
    /// @dev    Same derivation as `getAddress(owners[0], salt)` since the
    ///         proxy is initialized with the first owner. The validator
    ///         install happens post-deploy + doesn't change the address.
    function getAddressForMode(
        AgentAccountInitParams calldata params,
        uint256 salt
    ) external view returns (address) {
        _validateInitParams(params);
        return getAddress(params.owners[0], salt);
    }

    /// @dev Shared validation for deploy + counterfactual paths so
    ///      preflight reverts identically to the real deploy.
    function _validateInitParams(AgentAccountInitParams calldata params) internal pure {
        if (params.mode > 3) revert InvalidMode(params.mode);
        if (params.owners.length == 0) revert NoPrimarySigner();

        uint256 nGuardians = params.guardians.length;
        if (params.mode == 2 /* threshold */ && nGuardians < 2) {
            revert InsufficientGuardiansForMode(params.mode, nGuardians, 2);
        }
        if (params.mode == 3 /* org */ && nGuardians < 3) {
            revert InsufficientGuardiansForMode(params.mode, nGuardians, 3);
        }
    }

    /// @dev Composes the ABI-encoded init blob the validator's
    ///      `onInstall` expects. Pulls per-tier thresholds from the
    ///      validator's spec § 5.1 matrix (so we don't duplicate the
    ///      calibration here) + sets default timelocks T4=1h / T5=24h /
    ///      T6=48h + default T3 ceiling of 0.01 ETH + recovery
    ///      threshold = floor(N/2)+1 when guardians > 0.
    function _buildValidatorInitData(
        AgentAccountInitParams calldata params,
        address validator,
        uint32 t4TimelockSeconds
    ) internal view returns (bytes memory) {
        uint8 n = uint8(params.owners.length);
        uint8[7] memory thresholds;
        for (uint8 t = 1; t <= 5; t++) {
            thresholds[t] = CustodyPolicy(validator).defaultThreshold(n, t);
        }
        // T6 governed by recoveryThreshold below, not the matrix.

        uint32[7] memory timelocks;
        timelocks[4] = t4TimelockSeconds == 0 ? uint32(1 hours) : t4TimelockSeconds;
        timelocks[5] = 24 hours;
        timelocks[6] = 48 hours;

        uint8 recThr = params.guardians.length > 0
            ? uint8(params.guardians.length / 2 + 1)
            : 0;

        return abi.encode(
            params.mode,
            recThr,
            params.guardians,
            thresholds,
            timelocks,
            uint256(0.01 ether),       // t3 ceiling default
            address(0)                  // approvedHashRegistry default
        );
    }

    error ZeroAddress();


    // ─── Counterfactual derivation for legacy entry points ────────────

    /**
     * @notice Counterfactual address for a passkey-owned account.
     * @dev Pure CREATE2 derivation — does NOT touch chain state.
     */
    function getAddressForPasskey(
        bytes32 credentialIdDigest,
        uint256 x,
        uint256 y,
        uint256 salt
    ) public view returns (address) {
        bytes memory initData = abi.encodeCall(
            AgentAccount.initializeWithPasskey,
            (credentialIdDigest, x, y, delegationManager, address(this))
        );

        bytes memory proxyBytecode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(address(accountImplementation), initData)
        );

        bytes32 bytecodeHash = keccak256(proxyBytecode);

        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            address(this),
                            bytes32(salt),
                            bytecodeHash
                        )
                    )
                )
            )
        );
    }
}
