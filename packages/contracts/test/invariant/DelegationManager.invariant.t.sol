// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * R9.2 -- DelegationManager stateful-invariant suite.
 *
 * Pairs with `CustodyPolicy.invariant.t.sol` (R9.1). Foundry calls each
 * `invariant_*` after every random sequence of `targetContract` calls.
 * 256 runs * 100 calls = 25,600 calls per invariant.
 *
 *   INV-1  Revocation is IRREVERSIBLE. Once `isRevoked(h) == true`, it
 *          can NEVER become false. The redeem path rests on this: a
 *          revoked delegation must stay rejected for all time.
 *
 *   INV-2  `hashDelegation(d)` is DETERMINISTIC -- same input always
 *          produces the same output. Locks any future code path that
 *          might silently introduce a non-deterministic component.
 *
 *   INV-3  `DOMAIN_SEPARATOR` is IMMUTABLE post-deploy. Anything that
 *          could swap it would silently invalidate every previously-
 *          signed delegation.
 *
 *   INV-4  `ROOT_AUTHORITY` and `OPEN_DELEGATION` constants are exactly
 *          their declared values. Wrong values would either reject
 *          every root delegation (DoS) or accept every authority chain
 *          (catastrophic).
 *
 *   INV-5  Revoked-set is monotonic non-shrinking. INV-1 is the
 *          per-hash version; INV-5 captures it at the SET LEVEL so a
 *          batch-clear regression surfaces even if INV-1's per-hash
 *          check sampled the wrong slot.
 *
 * Spec: ../../specs/204-delegation.md
 */

import "forge-std/Test.sol";
import {DelegationManager} from "../../src/agency/DelegationManager.sol";
import {IDelegationManager} from "../../src/agency/IDelegationManager.sol";

/// @dev Thin wrapper that converts memory -> calldata at the ABI boundary.
///      Lets the handler hold the delegation in memory, vm.sign it, then
///      hand it off to the DM through an external call (where the
///      `calldata` reference naturally materializes).
contract DMCallWrapper {
    DelegationManager public immutable dm;
    constructor(DelegationManager _dm) { dm = _dm; }

    function revoke(IDelegationManager.Delegation calldata d) external {
        dm.revokeDelegationByOwner(d);
    }

    function hash(IDelegationManager.Delegation calldata d)
        external view returns (bytes32)
    {
        return dm.hashDelegation(d);
    }
}

contract DelegationManagerHandler is Test {
    DelegationManager public immutable dm;
    DMCallWrapper public immutable wrapper;

    uint256 public constant DELEGATOR_PK = 0xD46A707;
    address public immutable delegator;

    bytes32[] public revokedHashesSeen;
    mapping(bytes32 => bool) public knownRevoked;

    constructor(DelegationManager _dm, DMCallWrapper _w) {
        dm = _dm;
        wrapper = _w;
        delegator = vm.addr(DELEGATOR_PK);
    }

    /// Build, sign, and revoke a delegation. `delegate` + `salt` are the
    /// fuzzer's variation surface.
    function buildAndRevoke(address delegate, uint256 salt) external {
        if (delegate == address(0)) delegate = address(0xBEEF);

        IDelegationManager.Caveat[] memory caveats =
            new IDelegationManager.Caveat[](0);
        IDelegationManager.Delegation memory d = IDelegationManager.Delegation({
            delegator: delegator,
            delegate: delegate,
            authority: dm.ROOT_AUTHORITY(),
            caveats: caveats,
            salt: salt,
            signature: bytes("")
        });

        bytes32 dHash = wrapper.hash(d);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(DELEGATOR_PK, dHash);
        d.signature = abi.encodePacked(r, s, v);

        vm.prank(delegator);
        try wrapper.revoke(d) {
            if (!knownRevoked[dHash]) {
                knownRevoked[dHash] = true;
                revokedHashesSeen.push(dHash);
            }
        } catch {
            /* dup / bad-sig branches discarded */
        }
    }

    function revokedCount() external view returns (uint256) {
        return revokedHashesSeen.length;
    }
}

contract DelegationManagerInvariantsR92Test is Test {
    DelegationManager internal dm;
    DMCallWrapper internal wrapper;
    DelegationManagerHandler internal handler;

    /// @dev Cached at setUp; INV-3 checks the live value still matches.
    bytes32 internal initialDomainSeparator;

    function setUp() public {
        dm = new DelegationManager(address(0));
        wrapper = new DMCallWrapper(dm);
        initialDomainSeparator = dm.DOMAIN_SEPARATOR();
        handler = new DelegationManagerHandler(dm, wrapper);
        targetContract(address(handler));
    }

    // ─── INV-1: revocation is irreversible ─────────────────────────

    function invariant_revocation_is_irreversible() public view {
        uint256 n = handler.revokedCount();
        for (uint256 i = 0; i < n; i++) {
            bytes32 h = handler.revokedHashesSeen(i);
            assertTrue(
                dm.isRevoked(h),
                "INV-1: previously-revoked hash no longer reads as revoked"
            );
        }
    }

    // ─── INV-2: hashDelegation is deterministic ────────────────────

    function invariant_hashDelegation_is_deterministic() public view {
        IDelegationManager.Caveat[] memory caveats =
            new IDelegationManager.Caveat[](0);
        IDelegationManager.Delegation memory d = IDelegationManager.Delegation({
            delegator: address(0xA11CE),
            delegate: address(0xBEEF),
            authority: dm.ROOT_AUTHORITY(),
            caveats: caveats,
            salt: 0,
            signature: bytes("")
        });
        bytes32 h1 = wrapper.hash(d);
        bytes32 h2 = wrapper.hash(d);
        assertEq(h1, h2, "INV-2: hashDelegation not deterministic");
    }

    // ─── INV-3: DOMAIN_SEPARATOR is immutable ──────────────────────

    function invariant_domainSeparator_is_immutable() public view {
        assertEq(
            dm.DOMAIN_SEPARATOR(),
            initialDomainSeparator,
            "INV-3: DOMAIN_SEPARATOR changed -- every prior signature is now invalid"
        );
    }

    // ─── INV-4: ROOT_AUTHORITY + OPEN_DELEGATION constants ─────────

    function invariant_constants_unchanged() public view {
        assertEq(
            dm.ROOT_AUTHORITY(),
            bytes32(uint256(type(uint256).max)),
            "INV-4: ROOT_AUTHORITY drifted from 0xff...ff"
        );
        assertEq(
            dm.OPEN_DELEGATION(),
            address(0xa11),
            "INV-4: OPEN_DELEGATION drifted from 0xa11"
        );
    }

    // ─── INV-5: revoked set is monotonic non-shrinking ─────────────

    function invariant_revoked_set_is_monotonic() public view {
        uint256 n = handler.revokedCount();
        uint256 stillRevoked = 0;
        for (uint256 i = 0; i < n; i++) {
            if (dm.isRevoked(handler.revokedHashesSeen(i))) stillRevoked++;
        }
        assertEq(stillRevoked, n, "INV-5: revoked set shrank");
    }
}
