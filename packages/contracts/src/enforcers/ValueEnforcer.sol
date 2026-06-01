// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../agency/ICaveatEnforcer.sol";

/**
 * @title ValueEnforcer
 * @notice Enforces a maximum ETH value per call.
 * @dev terms = abi.encode(uint256 maxValue)
 *      Follows ERC-7710 / MetaMask DeleGator beforeHook/afterHook pattern.
 *
 *      R6.7 — Stateless validator; no `whenNotPaused` modifier needed
 *      (hooks are `pure`, contract has zero storage). The DM-side pause
 *      check in `DelegationManager.redeemDelegation` gates all
 *      reachable enforcer dispatch. See `docs/audits/r6-contracts-recon-2026-05-31.md`
 *      § 4.4 + `test/EnforcerPauseInvariantR67.t.sol`.
 */
contract ValueEnforcer is ICaveatEnforcer {
    error ValueExceedsLimit();

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256 value,
        bytes calldata
    ) external pure override {
        uint256 maxValue = abi.decode(terms, (uint256));
        if (value > maxValue) revert ValueExceedsLimit();
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
