// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/DelegationManager.sol";
import "../src/enforcers/TimestampEnforcer.sol";

contract DelegationManagerTest is Test {
    DelegationManager dm;
    TimestampEnforcer timestampEnf;

    // Test EOAs (deterministic).
    uint256 internal constant DELEGATOR_PK = 0xA11CE;
    uint256 internal constant DELEGATE_PK = 0xB0B;
    address internal delegator;
    address internal delegate;

    function setUp() public {
        dm = new DelegationManager();
        timestampEnf = new TimestampEnforcer();
        delegator = vm.addr(DELEGATOR_PK);
        delegate = vm.addr(DELEGATE_PK);
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    function _emptyCaveats() internal pure returns (IDelegationManager.Caveat[] memory) {
        return new IDelegationManager.Caveat[](0);
    }

    function _buildDelegation(uint256 salt) internal view returns (IDelegationManager.Delegation memory d) {
        d.delegator = delegator;
        d.delegate = delegate;
        d.authority = dm.ROOT_AUTHORITY();
        d.caveats = _emptyCaveats();
        d.salt = salt;
        d.signature = "";
    }

    function _signDelegation(IDelegationManager.Delegation memory d, uint256 pk) internal view returns (bytes memory) {
        IDelegationManager.Delegation memory tmp = d;
        IDelegationManager.Delegation[] memory arr = new IDelegationManager.Delegation[](1);
        arr[0] = tmp;
        bytes32 dHash = _hashSingleDelegation(d);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _hashSingleDelegation(IDelegationManager.Delegation memory d) internal view returns (bytes32) {
        // Mirror DelegationManager.hashDelegation via calldata roundtrip.
        IDelegationManager.Delegation[] memory arr = new IDelegationManager.Delegation[](1);
        arr[0] = d;
        return _externalHash(arr);
    }

    function _externalHash(IDelegationManager.Delegation[] memory arr) internal view returns (bytes32) {
        // Call hashDelegation on the contract — needs calldata; route via this.helper.
        return this.callHashDelegation(arr[0]);
    }

    function callHashDelegation(IDelegationManager.Delegation calldata d) external view returns (bytes32) {
        return dm.hashDelegation(d);
    }

    // ─── Tests ───────────────────────────────────────────────────────────

    function test_domain_separator_is_chain_specific() public view {
        // Re-compute the expected domain separator and confirm it matches.
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("AgentDelegationManager"),
                keccak256("1"),
                block.chainid,
                address(dm)
            )
        );
        assertEq(dm.DOMAIN_SEPARATOR(), expected);
    }

    function test_isRevoked_returns_false_initially() public view {
        assertFalse(dm.isRevoked(bytes32(uint256(0xdeadbeef))));
    }

    function test_revokeDelegation_marks_hash_revoked() public {
        bytes32 hash = bytes32(uint256(0x1234));
        dm.revokeDelegation(hash);
        assertTrue(dm.isRevoked(hash));
    }

    function test_revokeDelegation_emits_events() public {
        bytes32 hash = bytes32(uint256(0xbabe));
        vm.expectEmit(true, false, false, false);
        emit IDelegationManager.DelegationRevoked(hash);
        dm.revokeDelegation(hash);
    }

    function test_revokeDelegationByOwner_allows_delegator() public {
        IDelegationManager.Delegation memory d = _buildDelegation(1);
        d.signature = _signDelegation(d, DELEGATOR_PK);
        bytes32 dHash = _hashSingleDelegation(d);

        vm.prank(delegator);
        dm.revokeDelegationByOwner(d);
        assertTrue(dm.isRevoked(dHash));
    }

    function test_revokeDelegationByOwner_allows_delegate() public {
        IDelegationManager.Delegation memory d = _buildDelegation(2);
        d.signature = _signDelegation(d, DELEGATOR_PK);
        bytes32 dHash = _hashSingleDelegation(d);

        vm.prank(delegate);
        dm.revokeDelegationByOwner(d);
        assertTrue(dm.isRevoked(dHash));
    }

    function test_revokeDelegationByOwner_rejects_stranger() public {
        IDelegationManager.Delegation memory d = _buildDelegation(3);
        d.signature = _signDelegation(d, DELEGATOR_PK);
        address stranger = address(0xDEAD);

        vm.prank(stranger);
        vm.expectRevert(DelegationManager.NotDelegatorOrDelegate.selector);
        dm.revokeDelegationByOwner(d);
    }

    function test_revokeDelegationByOwner_rejects_unsigned() public {
        IDelegationManager.Delegation memory d = _buildDelegation(4);
        d.signature = hex"deadbeef"; // garbage

        vm.prank(delegator);
        vm.expectRevert(); // ECDSA recovers a different address → InvalidSignature
        dm.revokeDelegationByOwner(d);
    }

    function test_revokeDelegationByOwner_rejects_delegate_with_forged_struct() public {
        // Delegate constructs a struct claiming a delegation that never
        // existed — signature won't recover to the claimed delegator.
        IDelegationManager.Delegation memory forged = _buildDelegation(99);
        // Sign with delegate's key but claim delegator is the victim.
        forged.signature = _signDelegation(forged, DELEGATE_PK);

        vm.prank(delegate);
        vm.expectRevert(DelegationManager.InvalidSignature.selector);
        dm.revokeDelegationByOwner(forged);
    }

    function test_hashDelegation_is_deterministic() public view {
        IDelegationManager.Delegation memory d1 = _buildDelegation(7);
        IDelegationManager.Delegation memory d2 = _buildDelegation(7);
        assertEq(_hashSingleDelegation(d1), _hashSingleDelegation(d2));
    }

    function test_hashDelegation_changes_with_salt() public view {
        bytes32 h1 = _hashSingleDelegation(_buildDelegation(1));
        bytes32 h2 = _hashSingleDelegation(_buildDelegation(2));
        assertTrue(h1 != h2);
    }

    function test_hashDelegation_includes_caveats() public view {
        IDelegationManager.Delegation memory d = _buildDelegation(10);
        bytes32 h1 = _hashSingleDelegation(d);

        IDelegationManager.Caveat[] memory cv = new IDelegationManager.Caveat[](1);
        cv[0] = IDelegationManager.Caveat({
            enforcer: address(timestampEnf),
            terms: abi.encode(uint256(0), uint256(99999999)),
            args: ""
        });
        d.caveats = cv;
        bytes32 h2 = _hashSingleDelegation(d);
        assertTrue(h1 != h2);
    }

    function test_hashDelegation_ignores_args_field() public view {
        // The CAVEAT_TYPEHASH excludes args, so changing args should not
        // change the delegation hash. Critical for off-chain signing:
        // delegators sign without knowing redemption-time args.
        IDelegationManager.Delegation memory d = _buildDelegation(11);
        IDelegationManager.Caveat[] memory cv = new IDelegationManager.Caveat[](1);
        cv[0] = IDelegationManager.Caveat({
            enforcer: address(timestampEnf),
            terms: abi.encode(uint256(0), uint256(99999999)),
            args: hex"01"
        });
        d.caveats = cv;
        bytes32 h1 = _hashSingleDelegation(d);

        cv[0].args = hex"02";
        d.caveats = cv;
        bytes32 h2 = _hashSingleDelegation(d);

        assertEq(h1, h2);
    }
}
