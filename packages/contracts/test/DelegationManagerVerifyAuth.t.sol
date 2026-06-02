// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/agency/DelegationManager.sol";

/// @notice Spec 242 PD-9 — `verifyAuthorization` view-only entrypoint tests.
///         The bilateral-consent path in the `attestations` package consumes
///         this to validate packed delegations as signed authorization
///         predicates (not as cross-account execution).
contract DelegationManagerVerifyAuthTest is Test {
    DelegationManager dm;

    uint256 internal constant DELEGATOR_PK = 0xA11CE;
    uint256 internal constant DELEGATE_PK = 0xB0B;
    address internal delegator;
    address internal delegate;
    address internal stranger;

    function setUp() public {
        dm = new DelegationManager(address(0));
        delegator = vm.addr(DELEGATOR_PK);
        delegate = vm.addr(DELEGATE_PK);
        stranger = address(0xCAFE);
    }

    function _emptyCaveats() internal pure returns (IDelegationManager.Caveat[] memory) {
        return new IDelegationManager.Caveat[](0);
    }

    function _build(uint256 salt) internal view returns (IDelegationManager.Delegation memory d) {
        d.delegator = delegator;
        d.delegate = delegate;
        d.authority = dm.ROOT_AUTHORITY();
        d.caveats = _emptyCaveats();
        d.salt = salt;
        d.signature = "";
    }

    function _sign(IDelegationManager.Delegation memory d, uint256 pk) internal view returns (bytes memory) {
        bytes32 dHash = this.callHashDelegation(d);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function callHashDelegation(IDelegationManager.Delegation calldata d) external view returns (bytes32) {
        return dm.hashDelegation(d);
    }

    // ─── Happy paths ────────────────────────────────────────────────────

    function test_verifyAuthorization_singleValidDelegation_returnsOk() public {
        IDelegationManager.Delegation memory d = _build(1);
        d.signature = _sign(d, DELEGATOR_PK);

        IDelegationManager.Delegation[] memory arr = new IDelegationManager.Delegation[](1);
        arr[0] = d;

        (bool ok, string memory reason) = dm.verifyAuthorization(arr, delegate);
        assertTrue(ok, "should verify");
        assertEq(bytes(reason).length, 0, "reason should be empty when ok");
    }

    function test_verifyAuthorization_openDelegation_allowsAnySender() public {
        IDelegationManager.Delegation memory d = _build(2);
        d.delegate = dm.OPEN_DELEGATION();
        d.signature = _sign(d, DELEGATOR_PK);

        IDelegationManager.Delegation[] memory arr = new IDelegationManager.Delegation[](1);
        arr[0] = d;

        (bool ok, ) = dm.verifyAuthorization(arr, stranger);
        assertTrue(ok, "open delegation should verify for any sender");
    }

    // ─── Negative paths ─────────────────────────────────────────────────

    function test_verifyAuthorization_emptyChain_rejects() public view {
        IDelegationManager.Delegation[] memory arr = new IDelegationManager.Delegation[](0);
        (bool ok, string memory reason) = dm.verifyAuthorization(arr, delegate);
        assertFalse(ok);
        assertEq(reason, "empty-chain");
    }

    function test_verifyAuthorization_wrongSender_rejects() public {
        IDelegationManager.Delegation memory d = _build(3);
        d.signature = _sign(d, DELEGATOR_PK);

        IDelegationManager.Delegation[] memory arr = new IDelegationManager.Delegation[](1);
        arr[0] = d;

        (bool ok, string memory reason) = dm.verifyAuthorization(arr, stranger);
        assertFalse(ok);
        assertEq(reason, "invalid-delegate");
    }

    function test_verifyAuthorization_forgedSignature_rejects() public {
        IDelegationManager.Delegation memory d = _build(4);
        // Sign with the DELEGATE's key instead of the delegator's
        d.signature = _sign(d, DELEGATE_PK);

        IDelegationManager.Delegation[] memory arr = new IDelegationManager.Delegation[](1);
        arr[0] = d;

        (bool ok, string memory reason) = dm.verifyAuthorization(arr, delegate);
        assertFalse(ok);
        assertEq(reason, "invalid-signature");
    }

    function test_verifyAuthorization_revoked_rejects() public {
        IDelegationManager.Delegation memory d = _build(5);
        d.signature = _sign(d, DELEGATOR_PK);

        // Revoke first
        vm.prank(delegator);
        dm.revokeDelegationByOwner(d);

        IDelegationManager.Delegation[] memory arr = new IDelegationManager.Delegation[](1);
        arr[0] = d;

        (bool ok, string memory reason) = dm.verifyAuthorization(arr, delegate);
        assertFalse(ok);
        assertEq(reason, "revoked");
    }

    function test_verifyAuthorization_isView_doesNotMutateState() public {
        IDelegationManager.Delegation memory d = _build(6);
        d.signature = _sign(d, DELEGATOR_PK);

        IDelegationManager.Delegation[] memory arr = new IDelegationManager.Delegation[](1);
        arr[0] = d;

        // Call twice — same result; not revoked after first call
        (bool ok1, ) = dm.verifyAuthorization(arr, delegate);
        (bool ok2, ) = dm.verifyAuthorization(arr, delegate);
        assertTrue(ok1);
        assertTrue(ok2);

        bytes32 dHash = this.callHashDelegation(d);
        assertFalse(dm.isRevoked(dHash), "verifyAuthorization MUST be view-only");
    }
}
