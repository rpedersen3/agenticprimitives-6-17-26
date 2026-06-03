// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/enforcers/CallDataHashEnforcer.sol";
import "../src/agency/DelegationManager.sol";

/// @notice Spec 249 RW1-4b — CallDataHashEnforcer (exact-calldata pinning) + its integration
///         with `verifyAuthorizationForCall` (RW1-4): together they bind a delegation to ONE call.
contract CallDataHashEnforcerTest is Test {
    CallDataHashEnforcer enf;
    DelegationManager dm;

    uint256 internal constant DELEGATOR_PK = 0xA11CE;
    uint256 internal constant DELEGATE_PK = 0xB0B;
    address internal delegator;
    address internal delegate;
    address internal constant TARGET = address(0xA001);
    bytes internal constant DATA_A = hex"deadbeef";
    bytes internal constant DATA_B = hex"cafe";

    function setUp() public {
        enf = new CallDataHashEnforcer();
        dm = new DelegationManager(address(0));
        delegator = vm.addr(DELEGATOR_PK);
        delegate = vm.addr(DELEGATE_PK);
    }

    // ─── unit: the enforcer ─────────────────────────────────────────────

    function test_passes_whenCallDataMatches() public view {
        bytes memory terms = abi.encode(keccak256(DATA_A));
        enf.beforeHook(terms, "", bytes32(0), delegator, delegate, TARGET, 0, DATA_A); // must not revert
    }

    function test_reverts_whenCallDataDiffers() public {
        bytes memory terms = abi.encode(keccak256(DATA_A));
        vm.expectRevert(
            abi.encodeWithSelector(CallDataHashEnforcer.CallDataMismatch.selector, keccak256(DATA_A), keccak256(DATA_B))
        );
        enf.beforeHook(terms, "", bytes32(0), delegator, delegate, TARGET, 0, DATA_B);
    }

    function test_reverts_whenTermsWrongLength() public {
        bytes memory terms = hex"1234"; // not 32 bytes
        vm.expectRevert(CallDataHashEnforcer.BadTermsLength.selector);
        enf.beforeHook(terms, "", bytes32(0), delegator, delegate, TARGET, 0, DATA_A);
    }

    function test_afterHook_isNoOp() public view {
        enf.afterHook("", "", bytes32(0), delegator, delegate, TARGET, 0, DATA_A); // must not revert
    }

    // ─── integration: exact-call pinning via verifyAuthorizationForCall ──

    function _sign(IDelegationManager.Delegation memory d, uint256 pk) internal view returns (bytes memory) {
        bytes32 dHash = this.callHashDelegation(d);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function callHashDelegation(IDelegationManager.Delegation calldata d) external view returns (bytes32) {
        return dm.hashDelegation(d);
    }

    /// @dev A delegation whose only caveat pins the calldata to `keccak256(pinnedData)`.
    function _delegationPinned(bytes memory pinnedData) internal view returns (IDelegationManager.Delegation memory d) {
        IDelegationManager.Caveat[] memory cav = new IDelegationManager.Caveat[](1);
        cav[0].enforcer = address(enf);
        cav[0].terms = abi.encode(keccak256(pinnedData));
        cav[0].args = "";
        d.delegator = delegator;
        d.delegate = delegate;
        d.authority = dm.ROOT_AUTHORITY();
        d.caveats = cav;
        d.salt = 1;
        d.signature = _sign(d, DELEGATOR_PK);
    }

    function _arr(IDelegationManager.Delegation memory d)
        internal
        pure
        returns (IDelegationManager.Delegation[] memory arr)
    {
        arr = new IDelegationManager.Delegation[](1);
        arr[0] = d;
    }

    function test_verifyAuthorizationForCall_authorizesExactCalldata() public view {
        IDelegationManager.Delegation memory d = _delegationPinned(DATA_A);
        (bool ok,) = dm.verifyAuthorizationForCall(_arr(d), delegate, TARGET, 0, DATA_A);
        assertTrue(ok, "the exact pinned calldata must be authorized");
    }

    function test_verifyAuthorizationForCall_rejectsDifferentCalldata() public view {
        IDelegationManager.Delegation memory d = _delegationPinned(DATA_A);
        (bool ok, string memory reason) = dm.verifyAuthorizationForCall(_arr(d), delegate, TARGET, 0, DATA_B);
        assertFalse(ok, "any other calldata must be rejected");
        assertEq(reason, "caveat-failed");
    }
}
