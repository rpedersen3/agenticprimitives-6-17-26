// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/agency/DelegationManager.sol";
import "../src/enforcers/AllowedTargetsEnforcer.sol";
import "../src/enforcers/ValueEnforcer.sol";
import "../src/enforcers/TimestampEnforcer.sol";

/// @dev A caveat enforcer that WRITES state in `beforeHook`. Used to prove
///      `verifyAuthorizationForCall` is fail-closed for non-view-evaluable
///      (stateful) caveats: the staticcall reverts on the SSTORE → caveat-failed.
contract MockStatefulEnforcer {
    uint256 public counter;

    function beforeHook(bytes calldata, bytes calldata, bytes32, address, address, address, uint256, bytes calldata)
        external
    {
        counter += 1; // state write → reverts under staticcall
    }

    function afterHook(bytes calldata, bytes calldata, bytes32, address, address, address, uint256, bytes calldata)
        external
    {}
}

/// @notice Spec 249 RW1-4 — `verifyAuthorizationForCall` evaluates a delegation chain's caveats
///         against the EXACT (target, value, data), read-only + fail-closed.
contract DelegationManagerVerifyAuthForCallTest is Test {
    DelegationManager dm;
    AllowedTargetsEnforcer targets;
    ValueEnforcer valueEnf;
    TimestampEnforcer ts;
    MockStatefulEnforcer stateful;

    uint256 internal constant DELEGATOR_PK = 0xA11CE;
    uint256 internal constant DELEGATE_PK = 0xB0B;
    address internal delegator;
    address internal delegate;
    address internal stranger;

    address internal constant TARGET_A = address(0xA001);
    address internal constant TARGET_B = address(0xB002);
    bytes internal constant DATA = hex"deadbeef";

    function setUp() public {
        dm = new DelegationManager(address(0));
        targets = new AllowedTargetsEnforcer();
        valueEnf = new ValueEnforcer();
        ts = new TimestampEnforcer();
        stateful = new MockStatefulEnforcer();
        delegator = vm.addr(DELEGATOR_PK);
        delegate = vm.addr(DELEGATE_PK);
        stranger = address(0xCAFE);
        vm.warp(1000); // fixed block.timestamp for the timestamp caveat
    }

    // ─── helpers ────────────────────────────────────────────────────────

    function _caveat(address enforcer, bytes memory terms) internal pure returns (IDelegationManager.Caveat memory c) {
        c.enforcer = enforcer;
        c.terms = terms;
        c.args = "";
    }

    function _build(uint256 salt, IDelegationManager.Caveat[] memory caveats)
        internal
        view
        returns (IDelegationManager.Delegation memory d)
    {
        d.delegator = delegator;
        d.delegate = delegate;
        d.authority = dm.ROOT_AUTHORITY();
        d.caveats = caveats;
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

    function _arr(IDelegationManager.Delegation memory d)
        internal
        pure
        returns (IDelegationManager.Delegation[] memory arr)
    {
        arr = new IDelegationManager.Delegation[](1);
        arr[0] = d;
    }

    function _verify(IDelegationManager.Delegation memory d, address target, uint256 value)
        internal
        view
        returns (bool ok, string memory reason)
    {
        return dm.verifyAuthorizationForCall(_arr(d), delegate, target, value, DATA);
    }

    function _one(IDelegationManager.Caveat memory c) internal pure returns (IDelegationManager.Caveat[] memory cav) {
        cav = new IDelegationManager.Caveat[](1);
        cav[0] = c;
    }

    // ─── happy ──────────────────────────────────────────────────────────

    function test_noCaveats_authorizesAnyCall() public view {
        IDelegationManager.Delegation memory d = _signedView(1, new IDelegationManager.Caveat[](0));
        (bool ok,) = _verify(d, TARGET_A, 0);
        assertTrue(ok, "no caveats => chain-only authorization holds");
    }

    function test_allCaveatsSatisfied_authorizes() public view {
        address[] memory allowed = new address[](1);
        allowed[0] = TARGET_A;
        IDelegationManager.Caveat[] memory cav = new IDelegationManager.Caveat[](3);
        cav[0] = _caveat(address(targets), abi.encode(allowed));
        cav[1] = _caveat(address(valueEnf), abi.encode(uint256(0)));
        cav[2] = _caveat(address(ts), abi.encode(uint256(0), uint256(2000)));
        IDelegationManager.Delegation memory d = _signedView(2, cav);
        (bool ok, string memory reason) = _verify(d, TARGET_A, 0);
        assertTrue(ok, reason);
    }

    /// @dev SC-3 (audit 2026-06-09): a caveat whose enforcer address has NO code constrains nothing —
    ///      a raw staticcall to an empty address "succeeds", which would make the delegation pass as
    ///      constraint-checked (fail-open). The view verifier must reject it.
    function test_noCodeEnforcer_failsClosed_SC3() public view {
        IDelegationManager.Caveat[] memory cav = _one(_caveat(address(0xDEAD), ""));
        IDelegationManager.Delegation memory d = _signedView(99, cav);
        (bool ok, string memory reason) = _verify(d, TARGET_A, 0);
        assertFalse(ok, "no-code enforcer must fail closed");
        assertEq(reason, "no-code-enforcer");
    }

    // ─── negative: a caveat denies the EXACT call ───────────────────────

    function test_wrongTarget_caveatFails() public view {
        address[] memory allowed = new address[](1);
        allowed[0] = TARGET_A;
        IDelegationManager.Delegation memory d = _signedView(3, _one(_caveat(address(targets), abi.encode(allowed))));
        (bool ok, string memory reason) = _verify(d, TARGET_B, 0); // call hits a target NOT allowed
        assertFalse(ok);
        assertEq(reason, "caveat-failed");
    }

    function test_valueExceeded_caveatFails() public view {
        IDelegationManager.Delegation memory d = _signedView(4, _one(_caveat(address(valueEnf), abi.encode(uint256(0)))));
        (bool ok, string memory reason) = _verify(d, TARGET_A, 1 ether);
        assertFalse(ok);
        assertEq(reason, "caveat-failed");
    }

    function test_expiredTimestamp_caveatFails() public view {
        // validUntil 500 < now (1000)
        IDelegationManager.Delegation memory d =
            _signedView(5, _one(_caveat(address(ts), abi.encode(uint256(0), uint256(500)))));
        (bool ok, string memory reason) = _verify(d, TARGET_A, 0);
        assertFalse(ok);
        assertEq(reason, "caveat-failed");
    }

    // ─── fail-closed for stateful (non-view-evaluable) caveats ──────────

    function test_statefulEnforcer_failsClosed_andDoesNotMutate() public view {
        IDelegationManager.Delegation memory d = _signedView(6, _one(_caveat(address(stateful), "")));
        (bool ok, string memory reason) = _verify(d, TARGET_A, 0);
        assertFalse(ok, "stateful caveat cannot be view-evaluated => fail closed");
        assertEq(reason, "caveat-failed");
        assertEq(stateful.counter(), 0, "staticcall must not have mutated enforcer state");
    }

    // ─── chain validation still applies ─────────────────────────────────

    function test_emptyChain_rejects() public view {
        IDelegationManager.Delegation[] memory arr = new IDelegationManager.Delegation[](0);
        (bool ok, string memory reason) = dm.verifyAuthorizationForCall(arr, delegate, TARGET_A, 0, DATA);
        assertFalse(ok);
        assertEq(reason, "empty-chain");
    }

    function test_wrongSender_rejects() public view {
        IDelegationManager.Delegation memory d = _signedView(7, new IDelegationManager.Caveat[](0));
        (bool ok, string memory reason) = dm.verifyAuthorizationForCall(_arr(d), stranger, TARGET_A, 0, DATA);
        assertFalse(ok);
        assertEq(reason, "invalid-delegate");
    }

    // ─── view-only ──────────────────────────────────────────────────────

    function test_isView_doesNotMutate() public {
        address[] memory allowed = new address[](1);
        allowed[0] = TARGET_A;
        IDelegationManager.Delegation memory d = _signedView(8, _one(_caveat(address(targets), abi.encode(allowed))));
        (bool ok1,) = _verify(d, TARGET_A, 0);
        (bool ok2,) = _verify(d, TARGET_A, 0);
        assertTrue(ok1);
        assertTrue(ok2);
        assertFalse(dm.isRevoked(this.callHashDelegation(d)), "verifyAuthorizationForCall MUST be view-only");
    }

    /// @dev view variant of `_signed` (the signing path only reads chain state).
    function _signedView(uint256 salt, IDelegationManager.Caveat[] memory cav)
        internal
        view
        returns (IDelegationManager.Delegation memory d)
    {
        d = _build(salt, cav);
        d.signature = _sign(d, DELEGATOR_PK);
    }
}
