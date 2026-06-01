// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../agency/ICaveatEnforcer.sol";

/**
 * @title AllowedTargetsEnforcer
 * @notice Restricts delegated calls to a specific set of target contracts.
 * @dev terms = abi.encode(address[] allowedTargets)
 *      Follows ERC-7710 / MetaMask DeleGator beforeHook/afterHook pattern.
 *
 *      R6.7 — Stateless validator; no `whenNotPaused` modifier needed
 *      (hooks are `pure`, contract has zero storage). The DM-side pause
 *      check in `DelegationManager.redeemDelegation` gates all
 *      reachable enforcer dispatch. See `docs/audits/r6-contracts-recon-2026-05-31.md`
 *      § 4.4 + `test/EnforcerPauseInvariantR67.t.sol`.
 */
contract AllowedTargetsEnforcer is ICaveatEnforcer {
    error TargetNotAllowed();

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        address,
        address,
        address target,
        uint256,
        bytes calldata
    ) external pure override {
        address[] memory allowed = abi.decode(terms, (address[]));
        for (uint256 i = 0; i < allowed.length; i++) {
            if (allowed[i] == target) return;
        }
        revert TargetNotAllowed();
    }

    function afterHook(
        bytes calldata,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override {
        // No post-execution check needed
    }
}
