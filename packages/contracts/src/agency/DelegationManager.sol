// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "./IDelegationManager.sol";
import "./ICaveatEnforcer.sol";
import "../governance/IGovernance.sol";

/**
 * @title DelegationManager
 * @notice On-chain delegation management with caveat enforcement.
 *
 * Aligned with ERC-7710 patterns and MetaMask delegation-framework design:
 * 1. Delegator signs a Delegation struct via EIP-712
 * 2. Delegate calls redeemDelegation() with the signed delegation chain
 * 3. DelegationManager validates signatures and enforces all caveats (beforeHook/afterHook)
 * 4. Execution goes through the delegator's smart account via execute()
 *
 * Spec 007 Phase A.5:
 *   - `redeemDelegation` is `nonReentrant` (SC5 § 6.2). Blocks nested
 *     redemption via caveat-enforcer or target-call callbacks.
 *   - `revokeDelegation(bytes32, bytes calldata)` is authenticated:
 *     either the delegator OR the delegate may revoke, with the
 *     verifier reading the delegation struct out of the explicit
 *     signature payload so Variant A (off-chain) delegations can be
 *     revoked too. C2 § 5 revocation-gap closure.
 *
 * Key ERC-7710 / DeleGator alignments:
 * - Caveat args: redeemer-provided runtime arguments (excluded from delegation hash)
 * - beforeHook/afterHook: enforcers revert on failure (no bool return)
 * - Execute through delegator account, not direct target.call
 * - Open delegations: delegate = address(0xa11) allows any redeemer
 */
contract DelegationManager is IDelegationManager, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─── H7-C.10 / EXT3-010 — system-wide pause hook ───────────────────
    //
    // DelegationManager is a singleton — every redeem of every delegation
    // on every chain flows through this contract. An incident-mode pause
    // here is the kill-switch that stops new delegation actions while an
    // exploit is being investigated. The pause flag is sourced from
    // `AgenticGovernance.isPaused()` (a guardian can pause without delay;
    // unpause needs the timelock).
    //
    // `governance` is `address(0)` for legacy deploys; in that case the
    // pause check is skipped (no governance, no pause source). Production
    // deploys pass a real AgenticGovernance address.
    address public immutable governance;

    error SystemPaused();

    /// @dev Root authority constant — delegations with this authority are root-level
    bytes32 public constant ROOT_AUTHORITY = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    /// @dev Open delegation sentinel — any address can redeem
    address public constant OPEN_DELEGATION = address(0xa11);

    /// @dev EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @dev Delegation type hash for EIP-712.
    ///
    ///      **R1 / CROSS-STACK-001 closure (2026-05-31):** converged to
    ///      STANDARD EIP-712. Previously used the non-standard inline form
    ///      `Delegation(...,bytes32 caveatsHash,...)` which produced a
    ///      different typehash from what off-chain `viem.hashTypedData`
    ///      derives from a `Caveat[]` field. The standard form encodes
    ///      `Caveat[] caveats` in the type string + appends the `Caveat(...)`
    ///      type definition.
    ///
    ///      The `_hashCaveats` function below already computes
    ///      `keccak256(concat(hashStruct(c) for c in caveats))` which IS the
    ///      EIP-712 standard `encodeData(Caveat[])`. structHash computation
    ///      stays identical; only the typehash STRING changed.
    bytes32 public constant DELEGATION_TYPEHASH = keccak256(
        "Delegation(address delegator,address delegate,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)"
    );

    /// @dev Caveat type hash for EIP-712 (only enforcer + terms; args excluded).
    bytes32 public constant CAVEAT_TYPEHASH = keccak256(
        "Caveat(address enforcer,bytes terms)"
    );

    /// @dev Gas cap for the read-only caveat evaluation in `verifyAuthorizationForCall`.
    ///      Generous for any pure/view enforcer; bounds the gas a stateful enforcer would
    ///      burn before reverting under staticcall, so on-chain callers get a cheap `false`.
    uint256 private constant CAVEAT_VIEW_GAS = 1_000_000;

    /// @dev Revoked delegation hashes
    mapping(bytes32 => bool) private _revoked;

    /// @notice Emitted when a revocation succeeds with the address that
    ///         submitted it (delegator or delegate).
    event DelegationRevokedBy(bytes32 indexed delegationHash, address indexed by);

    error DelegationRevoked_();
    error DelegationManager_InvalidSignature();
    error InvalidAuthority();
    error OnlyDelegator();
    error ExecutionFailed();
    error InvalidDelegate();
    error EmptyChain();

    // Phase A.5 errors.
    error NotDelegatorOrDelegate();
    error HashMismatch();
    /// @dev Thrown by the deprecated permissionless `revokeDelegation(bytes32)`
    ///      path. Migrate callers to `revokeDelegationByOwner(Delegation)`.
    error LegacyRevocationDisabled();

    /// @dev Storage gap reserves 50 slots for future state. The contract
    ///      is currently NOT upgradeable (SC4 § 4.3.4 — DelegationManager
    ///      is singleton + re-deploy on bug), but the gap standardises
    ///      our storage discipline and keeps the option open.
    uint256[50] private __gap;

    /// @notice Deploys the DelegationManager. Pass `address(0)` for
    ///         `governance_` to opt out of the H7-C.10 pause gate
    ///         (legacy / test deploys). Production deploys pass an
    ///         `AgenticGovernance` address.
    constructor(address governance_) {
        governance = governance_;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AgentDelegationManager"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @inheritdoc IDelegationManager
    /// @dev Phase A.5 (SC5 § 6.2) — `nonReentrant` blocks nested
    ///      redemption (a caveat enforcer or target call cannot
    ///      reenter this function).
    function redeemDelegation(
        Delegation[] calldata delegations,
        address target,
        uint256 value,
        bytes calldata data
    ) external nonReentrant {
        // H7-C.10 / EXT3-010: system-wide pause gate. Skipped when
        // `governance` is `address(0)`, an EOA, or a non-conforming
        // contract (legacy / test deploys). Production deploys pass an
        // `AgenticGovernance` address; a guardian can pause without delay;
        // unpause requires the 24h timelock.
        if (governance != address(0) && governance.code.length > 0) {
            (bool ok, bytes memory data) = governance.staticcall(
                abi.encodeWithSelector(IGovernanceView.isPaused.selector)
            );
            if (ok && data.length >= 32 && abi.decode(data, (bool))) revert SystemPaused();
        }
        if (delegations.length == 0) revert EmptyChain();

        // Phase 1: Validate chain + run beforeHooks (leaf to root)
        for (uint256 i = 0; i < delegations.length; i++) {
            _validateDelegation(delegations, i);
            _runBeforeHooks(delegations[i], target, value, data);
        }

        // Phase 2: Execute through the root delegator's smart account
        address rootDelegator = delegations[delegations.length - 1].delegator;
        _executeFromDelegator(rootDelegator, target, value, data);

        // Phase 3: After-hooks (root to leaf, per DeleGator convention)
        for (uint256 i = delegations.length; i > 0; i--) {
            _runAfterHooks(delegations[i - 1], target, value, data);
        }
    }

    /// @inheritdoc IDelegationManager
    /// @notice DEPRECATED — permissionless revocation by hash.
    /// @dev Production-readiness pass: the permissionless legacy path is a
    ///      DoS surface — a mempool observer or any party who reconstructs
    ///      a Variant A delegation hash can mark it revoked. The original
    ///      rationale (Variant B delegations register on-chain so the
    ///      hash is already public) doesn't hold for Variant A, which is
    ///      now the default.
    ///
    ///      We retain the function selector for ABI compatibility with
    ///      existing tooling, but always revert with `LegacyRevocationDisabled()`.
    ///      Callers MUST migrate to `revokeDelegationByOwner(Delegation)`
    ///      which authenticates `msg.sender` against the delegation struct.
    function revokeDelegation(bytes32 /* delegationHash */) external pure {
        revert LegacyRevocationDisabled();
    }

    /// @notice Phase A.5 — authenticated revocation path that works for
    ///         Variant A (off-chain caveated delegation, never
    ///         registered) by deriving the hash from the delegation
    ///         struct + signature provided by the caller.
    ///
    /// @dev Authorization gate: `msg.sender` MUST be either
    ///      `delegation.delegator` OR `delegation.delegate` (the latter
    ///      blocks a random EOA from revoking a delegation it doesn't
    ///      hold, which would otherwise be a permissionless DoS vector
    ///      against the legacy `revokeDelegation(bytes32)` path).
    ///
    /// @param delegation The delegation to revoke. The signature inside
    ///                   it is verified to confirm the struct is
    ///                   legitimate before we mark the hash revoked —
    ///                   otherwise a malicious delegate could revoke a
    ///                   *forged* delegation hash by submitting a struct
    ///                   they invented.
    function revokeDelegationByOwner(Delegation calldata delegation) external {
        if (msg.sender != delegation.delegator && msg.sender != delegation.delegate) {
            revert NotDelegatorOrDelegate();
        }

        bytes32 dHash = hashDelegation(delegation);

        // Verify the delegation struct is signed by its declared
        // delegator. We don't want a delegate to be able to revoke
        // a hash that was never a real delegation.
        _validateSignature(delegation.delegator, dHash, delegation.signature);

        _revoked[dHash] = true;
        emit DelegationRevoked(dHash);
        emit DelegationRevokedBy(dHash, msg.sender);
    }

    /// @inheritdoc IDelegationManager
    function isRevoked(bytes32 delegationHash) external view returns (bool) {
        return _revoked[delegationHash];
    }

    /// @notice Compute the EIP-712 hash of a delegation.
    function hashDelegation(Delegation calldata d) public view returns (bytes32) {
        bytes32 caveatsHash = _hashCaveats(d.caveats);
        bytes32 structHash = keccak256(
            abi.encode(
                DELEGATION_TYPEHASH,
                d.delegator,
                d.delegate,
                d.authority,
                caveatsHash,
                d.salt
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /// @notice View-only verification of a delegation chain. Returns whether
    ///         the chain is well-formed (signatures, authority chain, not
    ///         revoked) WITHOUT executing it.
    ///
    /// Spec 242 §6 (PD-9): the `attestations` package uses this to verify
    /// bilateral-consent delegations as signed authorization predicates,
    /// rather than redeeming them as cross-account execution. Returning
    /// `(true, "")` means the delegation chain authorizes the named call from
    /// `sender`. Caveat predicates (CalldataHashEnforcer, AllowedTargets,
    /// AllowedMethods, Timestamp) are NOT executed here — callers are expected
    /// to pin those into the delegation's caveats at issuance time, where
    /// they're hash-bound to the delegation signature.
    ///
    /// @param delegations Chain (leaf first; root authority last)
    /// @param sender The address that would be the redeemer
    /// @return ok True if every link verifies
    /// @return reason Empty if ok; otherwise a short rejection reason
    function verifyAuthorization(
        Delegation[] calldata delegations,
        address sender
    ) external view returns (bool ok, string memory reason) {
        if (delegations.length == 0) return (false, "empty-chain");

        for (uint256 i = 0; i < delegations.length; i++) {
            (bool valid, string memory r) = _validateDelegationView(delegations, i, sender);
            if (!valid) return (false, r);
        }
        return (true, "");
    }

    /// @notice View verifier for a SPECIFIC call (ADR-0027 / spec 249, RW1-4). Validates the
    ///         delegation chain AND evaluates every caveat's `beforeHook` against the exact
    ///         `(target, value, data)` — read-only, FAIL-CLOSED.
    /// @dev    `verifyAuthorization` checks chain/signature/authority/revocation but NOT the
    ///         caveats — too weak to authorize a specific call. This evaluates each caveat via
    ///         `staticcall` (the hook is `external`/non-view because stateful enforcers like
    ///         Quorum exist). Returns `true` ONLY if the chain validates and EVERY caveat passes
    ///         read-only. A caveat that reverts (denied) OR cannot be evaluated read-only (a
    ///         stateful enforcer attempting a write under staticcall) yields `false` — so `true`
    ///         is a genuine authorization guarantee for this exact call, and `false` means "use
    ///         live redemption" (which evaluates stateful caveats properly). The caveat
    ///         evaluation mirrors `_runBeforeHooks` exactly (same args, same `sender`-as-redeemer),
    ///         so an unknown/no-code enforcer is a no-op here just as it is in redemption. Pure
    ///         addition — `redeemDelegation` is untouched.
    /// @param delegations Chain (leaf first; root authority last)
    /// @param sender The address that would be the redeemer
    /// @param target The exact target the delegated call would hit
    /// @param value The exact ETH value
    /// @param data The exact calldata
    function verifyAuthorizationForCall(
        Delegation[] calldata delegations,
        address sender,
        address target,
        uint256 value,
        bytes calldata data
    ) external view returns (bool ok, string memory reason) {
        if (delegations.length == 0) return (false, "empty-chain");

        for (uint256 i = 0; i < delegations.length; i++) {
            (bool valid, string memory r) = _validateDelegationView(delegations, i, sender);
            if (!valid) return (false, r);

            Delegation calldata d = delegations[i];
            bytes32 dHash = hashDelegation(d);
            for (uint256 j = 0; j < d.caveats.length; j++) {
                // staticcall the same hook redemption would call; success == satisfied read-only.
                // Gas-bounded: a stateful enforcer (which would revert on its SSTORE under
                // staticcall) is capped so an on-chain caller (e.g. RW1-1) sees a cheap, predictable
                // `false`, not an out-of-gas of the whole call. CAVEAT_VIEW_GAS is generous for any
                // pure/view enforcer (timestamp/value/targets/methods are all far below it).
                (bool passed, ) = d.caveats[j].enforcer.staticcall{gas: CAVEAT_VIEW_GAS}(
                    abi.encodeWithSelector(
                        ICaveatEnforcer.beforeHook.selector,
                        d.caveats[j].terms,
                        d.caveats[j].args,
                        dHash,
                        d.delegator,
                        sender,
                        target,
                        value,
                        data
                    )
                );
                if (!passed) return (false, "caveat-failed");
            }
        }
        return (true, "");
    }

    /// @dev View-only sibling of `_validateDelegation`. Same checks, no state
    ///      writes, no events. Used by `verifyAuthorization`.
    function _validateDelegationView(
        Delegation[] calldata delegations,
        uint256 i,
        address sender
    ) internal view returns (bool ok, string memory reason) {
        Delegation calldata d = delegations[i];
        bytes32 dHash = hashDelegation(d);

        if (_revoked[dHash]) return (false, "revoked");

        // Delegate chain
        if (i == 0) {
            if (d.delegate != OPEN_DELEGATION && d.delegate != sender) {
                return (false, "invalid-delegate");
            }
        } else {
            if (d.delegate != OPEN_DELEGATION && d.delegate != delegations[i - 1].delegator) {
                return (false, "invalid-delegate-chain");
            }
        }

        // Authority chain
        if (d.authority != ROOT_AUTHORITY) {
            if (i + 1 >= delegations.length) return (false, "invalid-authority");
            bytes32 parentHash = hashDelegation(delegations[i + 1]);
            if (d.authority != parentHash) return (false, "invalid-authority-chain");
        }

        // Signature
        if (!_isValidSignatureBool(d.delegator, dHash, d.signature)) {
            return (false, "invalid-signature");
        }

        return (true, "");
    }

    /// @dev Bool-returning sibling of `_validateSignature`. Returns false
    ///      instead of reverting, so view-only callers can produce a typed
    ///      `(ok, reason)` instead of bubbling a revert.
    function _isValidSignatureBool(
        address signer,
        bytes32 digest,
        bytes calldata signature
    ) internal view returns (bool) {
        // ERC-1271 path for smart accounts
        if (signer.code.length > 0) {
            try IERC1271(signer).isValidSignature(digest, signature) returns (bytes4 result) {
                return result == IERC1271.isValidSignature.selector;
            } catch {
                return false;
            }
        }
        // EOA — tryRecover the eth-signed message hash
        bytes32 ethHash = digest.toEthSignedMessageHash();
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(ethHash, signature);
        if (err != ECDSA.RecoverError.NoError) return false;
        return recovered == signer;
    }

    // ─── Internal: Validation ──────────────────────────────────────────

    function _validateDelegation(
        Delegation[] calldata delegations,
        uint256 i
    ) internal {
        Delegation calldata d = delegations[i];
        bytes32 dHash = hashDelegation(d);

        // Check not revoked
        if (_revoked[dHash]) revert DelegationRevoked_();

        // Validate delegate
        if (i == 0) {
            if (d.delegate != OPEN_DELEGATION && d.delegate != msg.sender) revert InvalidDelegate();
        } else {
            if (d.delegate != OPEN_DELEGATION && d.delegate != delegations[i - 1].delegator) revert InvalidDelegate();
        }

        // Validate authority chain
        if (d.authority != ROOT_AUTHORITY) {
            if (i + 1 >= delegations.length) revert InvalidAuthority();
            bytes32 parentHash = hashDelegation(delegations[i + 1]);
            if (d.authority != parentHash) revert InvalidAuthority();
        }

        // Validate signature
        _validateSignature(d.delegator, dHash, d.signature);

        emit DelegationRedeemed(dHash, d.delegator, d.delegate);
    }

    // ─── Internal: Caveat Hooks ────────────────────────────────────────

    function _runBeforeHooks(
        Delegation calldata d,
        address target,
        uint256 value,
        bytes calldata data
    ) internal {
        bytes32 dHash = hashDelegation(d);
        for (uint256 j = 0; j < d.caveats.length; j++) {
            ICaveatEnforcer(d.caveats[j].enforcer).beforeHook(
                d.caveats[j].terms,
                d.caveats[j].args,
                dHash,
                d.delegator,
                msg.sender,
                target,
                value,
                data
            );
        }
    }

    function _runAfterHooks(
        Delegation calldata d,
        address target,
        uint256 value,
        bytes calldata data
    ) internal {
        bytes32 dHash = hashDelegation(d);
        for (uint256 j = 0; j < d.caveats.length; j++) {
            ICaveatEnforcer(d.caveats[j].enforcer).afterHook(
                d.caveats[j].terms,
                d.caveats[j].args,
                dHash,
                d.delegator,
                msg.sender,
                target,
                value,
                data
            );
        }
    }

    // ─── Internal: Execution ───────────────────────────────────────────

    function _executeFromDelegator(
        address delegator,
        address target,
        uint256 value,
        bytes calldata data
    ) internal {
        // Call the delegator account's execute(address,uint256,bytes) function
        // This ensures msg.sender in the target contract is the delegator
        (bool success, bytes memory returnData) = delegator.call(
            abi.encodeWithSignature("execute(address,uint256,bytes)", target, value, data)
        );
        if (!success) {
            if (returnData.length > 0) {
                assembly {
                    revert(add(returnData, 32), mload(returnData))
                }
            }
            revert ExecutionFailed();
        }
    }

    // ─── Internal: Signature ───────────────────────────────────────────

    function _validateSignature(
        address signer,
        bytes32 digest,
        bytes calldata signature
    ) internal view {
        // ERC-1271 for smart accounts
        if (signer.code.length > 0) {
            bytes4 result = IERC1271(signer).isValidSignature(digest, signature);
            if (result != IERC1271.isValidSignature.selector) revert DelegationManager_InvalidSignature();
            return;
        }
        // EOA — recover from eth-signed message hash
        bytes32 ethHash = digest.toEthSignedMessageHash();
        address recovered = ethHash.recover(signature);
        if (recovered != signer) revert DelegationManager_InvalidSignature();
    }

    // ─── Internal: Hashing ─────────────────────────────────────────────

    function _hashCaveats(Caveat[] calldata caveats) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](caveats.length);
        for (uint256 i = 0; i < caveats.length; i++) {
            hashes[i] = keccak256(
                abi.encode(CAVEAT_TYPEHASH, caveats[i].enforcer, keccak256(caveats[i].terms))
            );
        }
        return keccak256(abi.encodePacked(hashes));
    }
}
