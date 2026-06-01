// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../agency/ICaveatEnforcer.sol";

/**
 * @title AllowedMethodsEnforcer
 * @notice Restricts delegated calls to specific function selectors.
 * @dev terms = abi.encode(bytes4[] allowedSelectors)
 *      Follows ERC-7710 / MetaMask DeleGator beforeHook/afterHook pattern.
 *
 *      R6.7 — Stateless validator; no `whenNotPaused` modifier needed
 *      (hooks are `pure`, contract has zero storage). The DM-side pause
 *      check in `DelegationManager.redeemDelegation` gates all
 *      reachable enforcer dispatch. See `docs/audits/r6-contracts-recon-2026-05-31.md`
 *      § 4.4 + `test/EnforcerPauseInvariantR67.t.sol`.
 */
contract AllowedMethodsEnforcer is ICaveatEnforcer {
    error MethodNotAllowed();
    error CalldataTooShort();

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256,
        bytes calldata callData
    ) external pure override {
        if (callData.length < 4) revert CalldataTooShort();

        bytes4 selector = bytes4(callData[:4]);
        bytes4[] memory allowed = abi.decode(terms, (bytes4[]));
        for (uint256 i = 0; i < allowed.length; i++) {
            if (allowed[i] == selector) return;
        }
        revert MethodNotAllowed();
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
