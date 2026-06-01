// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AgentNameRegistry.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PermissionlessSubregistry
 * @notice Anyone-can-register subregistry for a single parent name.
 *
 * Design:
 *   - At deploy: bound to a specific `PARENT_NODE` + a default
 *     resolver address. The parent's owner (typically the deployer
 *     during demo bootstrap) MUST call
 *     `AgentNameRegistry.setSubregistry(PARENT_NODE, address(this))`
 *     once after deploy to grant this contract authority to register
 *     children under `PARENT_NODE`.
 *
 *   - Any caller (EOA or Smart Agent) may invoke `register(label,
 *     newOwner)` to claim `<label>.<parent>`. The registered child
 *     is owned by `newOwner` (caller decides — typically themselves
 *     OR a PSA they control).
 *
 * Spam prevention:
 *   - Minimum label length (`MIN_LABEL_LENGTH = 3`).
 *   - One name per caller `msg.sender` (`claimedBy[caller] != 0`
 *     reverts). Designed for demos / sybil-resistant rollups; a
 *     production subregistry would gate on a registration fee or a
 *     governance allowlist instead.
 *
 * Authority model:
 *   - The contract calls `REGISTRY.register(...)`; the registry sees
 *     `msg.sender == address(this)` AND `r.subregistry == this` and
 *     authorizes the registration. The new child's owner is the
 *     caller-supplied `newOwner` argument — NOT this contract.
 *   - Anyone wanting to update records on the new child does so
 *     through whatever authority `newOwner` represents (EOA wallet,
 *     PSA CustodyPolicy quorum, etc.).
 */
/// @dev R6.2 — `ReentrancyGuard` closes the Slither finding
///      `reentrancy-no-eth` on `register()`: the prior-claim check
///      (`claimedBy[msg.sender] != 0`) was followed by an external
///      call to `REGISTRY.register(...)` BEFORE the corresponding
///      state write. A malicious resolver invoked by the registry
///      could re-enter `register()` and pass the check a second time.
///      The guard prevents any nested call into `register()`, closing
///      the window. Recon doc § 4.1 / `docs/audits/r6-contracts-recon-2026-05-31.md`.
contract PermissionlessSubregistry is ReentrancyGuard {
    AgentNameRegistry public immutable REGISTRY;
    bytes32 public immutable PARENT_NODE;
    address public immutable DEFAULT_RESOLVER;

    uint256 public constant MIN_LABEL_LENGTH = 3;

    /// @notice msg.sender → the child node they've already claimed.
    mapping(address => bytes32) public claimedBy;
    /// @notice Total claims served by this subregistry instance.
    uint256 public claimCount;

    event NameClaimed(
        address indexed caller,
        bytes32 indexed childNode,
        string label,
        address newOwner
    );

    error AlreadyClaimed(bytes32 existingNode);
    error LabelTooShort();
    error EmptyLabel();
    error ZeroNewOwner();

    constructor(AgentNameRegistry registry, bytes32 parentNode, address defaultResolver) {
        REGISTRY = registry;
        PARENT_NODE = parentNode;
        DEFAULT_RESOLVER = defaultResolver;
    }

    /**
     * @notice Claim `<label>.<parent>` for `newOwner`. Reverts if the
     *         caller has already claimed a name through this
     *         subregistry, OR if the label fails the minimum-length
     *         guard, OR if the registry rejects the registration
     *         (e.g. label already taken).
     *
     *         The caller pays gas. The contract does NOT collect a
     *         fee — fee gating belongs in a different subregistry
     *         shape if needed.
     */
    function register(string calldata label, address newOwner) external nonReentrant returns (bytes32 childNode) {
        if (bytes(label).length == 0) revert EmptyLabel();
        if (bytes(label).length < MIN_LABEL_LENGTH) revert LabelTooShort();
        if (newOwner == address(0)) revert ZeroNewOwner();
        bytes32 prior = claimedBy[msg.sender];
        if (prior != bytes32(0)) revert AlreadyClaimed(prior);
        // R9 / docs/audits/r9-static-analysis-triage.md § Slither M-1:
        // Slither flags this as cross-function reentrancy because state is
        // written AFTER the external call. The function is `nonReentrant`
        // (line 89) + REGISTRY is an immutable contract we control
        // (`AgentNameRegistry`) that does not call back into this contract.
        // The cross-function reader (`hasClaimed`) is view-only. No invariant
        // is violated by the pre-write-window. Triaged false positive.
        // slither-disable-next-line reentrancy-no-eth
        childNode = REGISTRY.register(PARENT_NODE, label, newOwner, DEFAULT_RESOLVER, 0);
        claimedBy[msg.sender] = childNode;
        unchecked {
            claimCount += 1;
        }
        emit NameClaimed(msg.sender, childNode, label, newOwner);
    }

    /// @notice Has `caller` already claimed a name? Convenience read.
    function hasClaimed(address caller) external view returns (bool) {
        return claimedBy[caller] != bytes32(0);
    }
}
