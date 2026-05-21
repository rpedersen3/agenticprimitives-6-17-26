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

    // ─── Threshold-policy deployment (relocated) ──────────────────────
    //
    // `createAccountWithMode`, `getAddressForMode`, and `_validateInitParams`
    // were relocated in phase 6c.5-d.1. The new path:
    //   1. caller invokes `createAccount(owner, salt)` (single-owner happy path)
    //   2. caller invokes `account.installModule(MODULE_TYPE_EXECUTOR,
    //      thresholdValidatorAddr, abi.encode(mode, ...))` with the
    //      mode + guardians + thresholds + timelocks payload.
    //
    // Phase 6c.5-d.1 (next commit) wires this into a factory helper
    // that takes the validator address + does both steps atomically.
    // For d.1.b the factory exposes only the base `createAccount` path;
    // mode setup is caller-driven.


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
