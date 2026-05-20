// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./AgentAccount.sol";
import {AgentAccountInitParams} from "./IAgentAccount.sol";
import "./governance/GovernanceManaged.sol";

/**
 * @title AgentAccountFactory
 * @notice Factory for deploying AgentAccount proxies with deterministic CREATE2 addresses.
 *
 * Phase A (spec 007 — architecture hardening) — capability role split:
 *   - `bundlerSigner` and `sessionIssuer` are factory-level capability
 *     roles. They are NEVER added to any account's `_owners` set. Each
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

    // ─── Threshold-policy deployment (spec 207) ───────────────────────

    error InvalidMode(uint8 mode);
    error NoPrimarySigner();
    error InsufficientGuardiansForMode(uint8 mode, uint256 actual, uint256 required);

    /// @notice Emitted when an AgentAccount is deployed via the
    ///         threshold-policy factory entry. Carries the mode + N
    ///         owners + N guardians for off-chain indexers.
    event AgentAccountCreatedWithMode(
        address indexed account,
        uint8 indexed mode,
        uint256 nOwners,
        uint256 nGuardians,
        uint256 salt
    );

    /**
     * @notice Deploy an `AgentAccount` configured per spec 207's
     *         threshold-policy surface. Replaces the per-mode entry
     *         points (`createAccount` / `createAccountWithPasskey`)
     *         with a single API that handles all four modes — `single`
     *         / `hybrid` / `threshold` / `org`.
     *
     *         Per spec § 8, the factory refuses to deploy accounts in
     *         the higher-coordination modes without enough guardians
     *         to make recovery meaningful:
     *           - `single` (0): no guardian requirement.
     *           - `hybrid` (1): no factory-level requirement. Frontend
     *             SHOULD prompt for ≥ 1 backup passkey or EOA; this
     *             contract doesn't enforce that because the backup
     *             can be any signer kind.
     *           - `threshold` (2): ≥ 2 guardians required.
     *           - `org` (3): ≥ 3 guardians required.
     *
     *         At least one primary signer (owner OR initial passkey)
     *         MUST be supplied. The `initializeWithThresholdPolicy`
     *         initializer on the impl installs the spec § 5.1 default
     *         threshold matrix + default timelocks (T4=1h, T5=24h,
     *         T6=48h) + recovery threshold + T3 ceiling automatically.
     *
     * @param params  See `AgentAccountInitParams` in `IAgentAccount.sol`.
     * @param salt    CREATE2 deployment salt.
     */
    function createAccountWithMode(
        AgentAccountInitParams calldata params,
        uint256 salt
    ) external returns (AgentAccount account) {
        _validateInitParams(params);

        address addr = getAddressForMode(params, salt);
        if (addr.code.length > 0) {
            return AgentAccount(payable(addr));
        }

        bytes memory initData = abi.encodeCall(
            AgentAccount.initializeWithThresholdPolicy,
            (params, delegationManager, address(this))
        );

        ERC1967Proxy proxy = new ERC1967Proxy{salt: bytes32(salt)}(
            address(accountImplementation),
            initData
        );

        account = AgentAccount(payable(address(proxy)));
        emit AgentAccountCreatedWithMode(
            address(account),
            params.mode,
            params.owners.length,
            params.guardians.length,
            salt
        );
    }

    /**
     * @notice Counterfactual address for a threshold-policy account.
     * @dev Pure CREATE2 derivation; runs the same validation as
     *      `createAccountWithMode` so off-chain callers see the same
     *      reverts whether they preflight or deploy.
     */
    function getAddressForMode(
        AgentAccountInitParams calldata params,
        uint256 salt
    ) public view returns (address) {
        _validateInitParams(params);

        bytes memory initData = abi.encodeCall(
            AgentAccount.initializeWithThresholdPolicy,
            (params, delegationManager, address(this))
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

    /// @dev Internal validation shared by deploy + counterfactual paths
    ///      so a preflight reverts identically to the real deploy.
    function _validateInitParams(AgentAccountInitParams calldata params) internal pure {
        if (params.mode > 3) revert InvalidMode(params.mode);

        // At least one primary signer required.
        bool hasOwner = params.owners.length > 0;
        bool hasInitialPasskey = params.initialPasskeyCredentialIdDigest != bytes32(0);
        if (!hasOwner && !hasInitialPasskey) revert NoPrimarySigner();

        // Per-mode guardian-count minima (spec § 8).
        uint256 nGuardians = params.guardians.length;
        if (params.mode == 2 /* threshold */ && nGuardians < 2) {
            revert InsufficientGuardiansForMode(params.mode, nGuardians, 2);
        }
        if (params.mode == 3 /* org */ && nGuardians < 3) {
            revert InsufficientGuardiansForMode(params.mode, nGuardians, 3);
        }
    }

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
