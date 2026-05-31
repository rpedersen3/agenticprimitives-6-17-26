// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/agency/DelegationManager.sol";
import "../src/enforcers/TimestampEnforcer.sol";

/**
 * @title DelegationManagerRedeemCoverageTest
 * @notice R3.3 closure of CON-DelegationManager-001. Forge coverage for
 *         `DelegationManager.sol` was 47.89% lines / 41.18% branches —
 *         worst of any load-bearing contract. The pre-existing test
 *         suites (`DelegationManager.t.sol` + `DelegationManagerCoverage.t.sol`)
 *         exercised `hashDelegation` + `revokeDelegationByOwner` thoroughly
 *         but never reached `redeemDelegation`, leaving `_validateDelegation`,
 *         `_runBeforeHooks`, `_runAfterHooks`, `_executeFromDelegator`,
 *         and `_validateSignature` ENTIRELY uncovered.
 *
 *         This file exercises the redemption path end-to-end through
 *         every public revert + happy-path branch using EOA delegators
 *         (calls to EOAs with calldata silently succeed via `.call`, so
 *         the happy path completes without needing a mock SA contract).
 *         Caveat hooks are exercised via the existing TimestampEnforcer.
 *
 *         Targets ≥85% lines, ≥75% branches on `DelegationManager.sol`.
 *         Spec 214 SB-1/SB-2 invariants live in this contract.
 */
contract DelegationManagerRedeemCoverageTest is Test {
    DelegationManager dm;
    TimestampEnforcer timestampEnf;

    // Test EOAs (deterministic).
    uint256 internal constant DELEGATOR_PK = 0xA11CE;
    uint256 internal constant DELEGATE_PK = 0xB0B;
    uint256 internal constant MID_PK = 0xC4747; // intermediate delegate in chain
    address internal delegator;
    address internal delegate;
    address internal mid;
    address internal target;

    function setUp() public {
        dm = new DelegationManager(address(0));
        timestampEnf = new TimestampEnforcer();
        delegator = vm.addr(DELEGATOR_PK);
        delegate = vm.addr(DELEGATE_PK);
        mid = vm.addr(MID_PK);
        target = address(0xDEAD);
        // Fund delegator EOA so `.call{value: 0}` works without revert
        // on the receive path. value=0 doesn't actually need funding but
        // keeping it explicit.
        vm.deal(delegator, 1 ether);
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    function _emptyCaveats() internal pure returns (IDelegationManager.Caveat[] memory) {
        return new IDelegationManager.Caveat[](0);
    }

    function _rootDelegation(uint256 salt, address dtor, address dte)
        internal
        view
        returns (IDelegationManager.Delegation memory d)
    {
        d.delegator = dtor;
        d.delegate = dte;
        d.authority = dm.ROOT_AUTHORITY();
        d.caveats = _emptyCaveats();
        d.salt = salt;
        d.signature = "";
    }

    function _signWith(IDelegationManager.Delegation memory d, uint256 pk) internal view returns (bytes memory) {
        bytes32 dHash = _hashOne(d);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _hashOne(IDelegationManager.Delegation memory d) internal view returns (bytes32) {
        return this.callHashDelegation(d);
    }

    function callHashDelegation(IDelegationManager.Delegation calldata d) external view returns (bytes32) {
        return dm.hashDelegation(d);
    }

    function _array(IDelegationManager.Delegation memory d)
        internal
        pure
        returns (IDelegationManager.Delegation[] memory arr)
    {
        arr = new IDelegationManager.Delegation[](1);
        arr[0] = d;
    }

    function _signedRootChainOfOne(uint256 salt)
        internal
        view
        returns (IDelegationManager.Delegation[] memory chain)
    {
        IDelegationManager.Delegation memory d = _rootDelegation(salt, delegator, delegate);
        d.signature = _signWith(d, DELEGATOR_PK);
        chain = _array(d);
    }

    // ─── Happy path ─────────────────────────────────────────────────────

    function test_redeemDelegation_singleDelegation_emptyCaveats_eoaDelegator_succeeds() public {
        IDelegationManager.Delegation[] memory chain = _signedRootChainOfOne(1);

        // msg.sender must be the delegate for `i == 0` validation.
        vm.prank(delegate);
        dm.redeemDelegation(chain, target, 0, hex"");
        // No revert == pass. `_executeFromDelegator` calls into the
        // delegator EOA which accepts any calldata silently.
    }

    function test_redeemDelegation_openDelegation_anyMsgSenderSucceeds() public {
        // OPEN_DELEGATION sentinel = address(0xa11) — any msg.sender is allowed.
        IDelegationManager.Delegation memory d = _rootDelegation(2, delegator, dm.OPEN_DELEGATION());
        d.signature = _signWith(d, DELEGATOR_PK);

        vm.prank(address(0xBEEF));
        dm.redeemDelegation(_array(d), target, 0, hex"");
    }

    function test_redeemDelegation_chainOfTwo_succeeds() public {
        // Root delegation: delegator → mid
        IDelegationManager.Delegation memory root = _rootDelegation(10, delegator, mid);
        root.signature = _signWith(root, DELEGATOR_PK);
        bytes32 rootHash = _hashOne(root);

        // Child delegation: mid → delegate, authority = root hash
        IDelegationManager.Delegation memory child;
        child.delegator = mid;
        child.delegate = delegate;
        child.authority = rootHash;
        child.caveats = _emptyCaveats();
        child.salt = 11;
        child.signature = _signWith(child, MID_PK);

        IDelegationManager.Delegation[] memory chain = new IDelegationManager.Delegation[](2);
        chain[0] = child; // leaf first
        chain[1] = root;

        vm.deal(mid, 1 ether);
        vm.prank(delegate);
        dm.redeemDelegation(chain, target, 0, hex"");
    }

    // ─── Pause gate (line 144-156) ──────────────────────────────────────

    function test_redeemDelegation_systemPaused_reverts() public {
        // Deploy a pause-asserting governance contract and a fresh DM
        // bound to it. The contract must have code (passes governance.code.length > 0).
        MockPausedGovernance pauseGov = new MockPausedGovernance(true);
        DelegationManager dmPaused = new DelegationManager(address(pauseGov));

        IDelegationManager.Delegation memory d = _rootDelegation(20, delegator, delegate);
        // Need to sign against the new dm's domain separator — easier to use a fresh
        // signing helper bound to dmPaused.
        bytes32 dHash;
        {
            IDelegationManager.Delegation memory copyD = d;
            dHash = this._hashOnInstance(dmPaused, copyD);
        }
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(DELEGATOR_PK, ethHash);
        d.signature = abi.encodePacked(r, s, v);

        vm.prank(delegate);
        vm.expectRevert(DelegationManager.SystemPaused.selector);
        dmPaused.redeemDelegation(_array(d), target, 0, hex"");
    }

    function test_redeemDelegation_governanceUnpaused_proceeds() public {
        MockPausedGovernance gov = new MockPausedGovernance(false);
        DelegationManager dmGov = new DelegationManager(address(gov));

        IDelegationManager.Delegation memory d = _rootDelegation(21, delegator, delegate);
        bytes32 dHash = this._hashOnInstance(dmGov, d);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(DELEGATOR_PK, ethHash);
        d.signature = abi.encodePacked(r, s, v);

        vm.prank(delegate);
        dmGov.redeemDelegation(_array(d), target, 0, hex"");
    }

    function test_redeemDelegation_governanceIsEoa_skipsPauseGate() public {
        // governance.code.length == 0 → pause check skipped entirely.
        DelegationManager dmEoaGov = new DelegationManager(address(0xC0FFEE));
        IDelegationManager.Delegation memory d = _rootDelegation(22, delegator, delegate);
        bytes32 dHash = this._hashOnInstance(dmEoaGov, d);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(DELEGATOR_PK, ethHash);
        d.signature = abi.encodePacked(r, s, v);

        vm.prank(delegate);
        dmEoaGov.redeemDelegation(_array(d), target, 0, hex"");
    }

    function test_redeemDelegation_governanceReturnsBadData_skipsGate() public {
        // Governance returns 0-byte response → `ok && data.length >= 32` is false → skip.
        MockBadDataGovernance gov = new MockBadDataGovernance();
        DelegationManager dmBad = new DelegationManager(address(gov));
        IDelegationManager.Delegation memory d = _rootDelegation(23, delegator, delegate);
        bytes32 dHash = this._hashOnInstance(dmBad, d);
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(DELEGATOR_PK, ethHash);
        d.signature = abi.encodePacked(r, s, v);

        vm.prank(delegate);
        dmBad.redeemDelegation(_array(d), target, 0, hex"");
    }

    // External wrapper so we can call hashDelegation on an arbitrary dm instance with calldata coercion.
    function _hashOnInstance(DelegationManager _dm, IDelegationManager.Delegation memory d)
        external
        view
        returns (bytes32)
    {
        return _dm.hashDelegation(d);
    }

    // ─── Validation: delegate / authority chain ─────────────────────────

    function test_redeemDelegation_leafDelegate_wrongMsgSender_reverts() public {
        IDelegationManager.Delegation[] memory chain = _signedRootChainOfOne(30);

        // msg.sender != delegate AND delegate != OPEN_DELEGATION → InvalidDelegate
        vm.prank(address(0xBADD));
        vm.expectRevert(DelegationManager.InvalidDelegate.selector);
        dm.redeemDelegation(chain, target, 0, hex"");
    }

    function test_redeemDelegation_nonRootWithoutParent_reverts() public {
        IDelegationManager.Delegation memory d = _rootDelegation(40, delegator, delegate);
        // Inject a fake authority (not root) but only one item in chain → no parent.
        d.authority = bytes32(uint256(0xDEADBEEF));
        d.signature = _signWith(d, DELEGATOR_PK);

        vm.prank(delegate);
        vm.expectRevert(DelegationManager.InvalidAuthority.selector);
        dm.redeemDelegation(_array(d), target, 0, hex"");
    }

    function test_redeemDelegation_brokenAuthorityChain_reverts() public {
        // Two-deep chain but the child's `authority` does NOT match the parent's hash.
        IDelegationManager.Delegation memory root = _rootDelegation(50, delegator, mid);
        root.signature = _signWith(root, DELEGATOR_PK);

        IDelegationManager.Delegation memory child;
        child.delegator = mid;
        child.delegate = delegate;
        child.authority = bytes32(uint256(0xFA1ED)); // not the root's hash
        child.caveats = _emptyCaveats();
        child.salt = 51;
        child.signature = _signWith(child, MID_PK);

        IDelegationManager.Delegation[] memory chain = new IDelegationManager.Delegation[](2);
        chain[0] = child;
        chain[1] = root;

        vm.deal(mid, 1 ether);
        vm.prank(delegate);
        vm.expectRevert(DelegationManager.InvalidAuthority.selector);
        dm.redeemDelegation(chain, target, 0, hex"");
    }

    function test_redeemDelegation_chainDelegateMismatch_reverts() public {
        // Chain step `i = 1` (root): root.delegate must equal chain[0].delegator.
        // Construct chain[0].delegator != root.delegate → triggers `InvalidDelegate`
        // on the i>0 branch of `_validateDelegation`. To avoid the i=0 signature
        // check firing first, sign child with the matching PK for its delegator.
        uint256 wrongPk = 0xF00DBEEF;
        address wrongDelegator = vm.addr(wrongPk);

        IDelegationManager.Delegation memory root = _rootDelegation(60, delegator, mid);
        root.signature = _signWith(root, DELEGATOR_PK);
        bytes32 rootHash = _hashOne(root);

        // Child delegator is NOT mid → breaks chain at root.delegate (mid) vs child.delegator (wrong).
        IDelegationManager.Delegation memory child;
        child.delegator = wrongDelegator;
        child.delegate = delegate;
        child.authority = rootHash;
        child.caveats = _emptyCaveats();
        child.salt = 61;
        child.signature = _signWith(child, wrongPk); // matches wrongDelegator

        IDelegationManager.Delegation[] memory chain = new IDelegationManager.Delegation[](2);
        chain[0] = child;
        chain[1] = root;

        vm.deal(wrongDelegator, 1 ether);
        vm.prank(delegate);
        vm.expectRevert(DelegationManager.InvalidDelegate.selector);
        dm.redeemDelegation(chain, target, 0, hex"");
    }

    // ─── Revocation ─────────────────────────────────────────────────────

    function test_redeemDelegation_revokedDelegation_reverts() public {
        IDelegationManager.Delegation[] memory chain = _signedRootChainOfOne(70);

        // Revoke via the authenticated path BEFORE redemption.
        vm.prank(delegator);
        dm.revokeDelegationByOwner(chain[0]);

        vm.prank(delegate);
        vm.expectRevert(DelegationManager.DelegationRevoked_.selector);
        dm.redeemDelegation(chain, target, 0, hex"");
    }

    // ─── Signature validation ───────────────────────────────────────────

    function test_redeemDelegation_invalidSignature_reverts() public {
        IDelegationManager.Delegation memory d = _rootDelegation(80, delegator, delegate);
        // Sign with the WRONG private key — recovery will not equal delegator.
        d.signature = _signWith(d, DELEGATE_PK);

        vm.prank(delegate);
        vm.expectRevert(DelegationManager.DelegationManager_InvalidSignature.selector);
        dm.redeemDelegation(_array(d), target, 0, hex"");
    }

    function test_redeemDelegation_contractDelegator_validErc1271_succeeds() public {
        MockERC1271 mockSA = new MockERC1271(true);
        IDelegationManager.Delegation memory d = _rootDelegation(81, address(mockSA), delegate);
        d.signature = hex"deadbeef"; // any bytes; mock accepts.

        vm.prank(delegate);
        dm.redeemDelegation(_array(d), target, 0, hex"");
    }

    function test_redeemDelegation_contractDelegator_erc1271Rejects_reverts() public {
        MockERC1271 mockSA = new MockERC1271(false);
        IDelegationManager.Delegation memory d = _rootDelegation(82, address(mockSA), delegate);
        d.signature = hex"deadbeef";

        vm.prank(delegate);
        vm.expectRevert(DelegationManager.DelegationManager_InvalidSignature.selector);
        dm.redeemDelegation(_array(d), target, 0, hex"");
    }

    // ─── Caveats: hooks (before + after) ────────────────────────────────

    function test_redeemDelegation_timestampCaveat_validWindow_succeeds() public {
        IDelegationManager.Delegation memory d = _rootDelegation(90, delegator, delegate);
        // TimestampEnforcer terms = abi.encode(uint256 validAfter, uint256 validUntil).
        bytes memory terms = abi.encode(uint256(0), uint256(block.timestamp + 1 hours));
        IDelegationManager.Caveat[] memory caveats = new IDelegationManager.Caveat[](1);
        caveats[0] = IDelegationManager.Caveat({enforcer: address(timestampEnf), terms: terms, args: hex""});
        d.caveats = caveats;
        d.signature = _signWith(d, DELEGATOR_PK);

        vm.prank(delegate);
        dm.redeemDelegation(_array(d), target, 0, hex"");
    }

    function test_redeemDelegation_unknownEnforcer_reverts() public {
        IDelegationManager.Delegation memory d = _rootDelegation(91, delegator, delegate);
        IDelegationManager.Caveat[] memory caveats = new IDelegationManager.Caveat[](1);
        // EOA address as enforcer → call to .beforeHook reverts (no code)
        caveats[0] = IDelegationManager.Caveat({enforcer: address(0xC0DE), terms: hex"", args: hex""});
        d.caveats = caveats;
        d.signature = _signWith(d, DELEGATOR_PK);

        vm.prank(delegate);
        vm.expectRevert();
        dm.redeemDelegation(_array(d), target, 0, hex"");
    }
}

// ─── Mocks ──────────────────────────────────────────────────────────────

interface IGovernanceViewLike {
    function isPaused() external view returns (bool);
}

contract MockPausedGovernance is IGovernanceViewLike {
    bool internal _paused;

    constructor(bool paused_) {
        _paused = paused_;
    }

    function isPaused() external view returns (bool) {
        return _paused;
    }
}

contract MockBadDataGovernance {
    // Has code but `isPaused` returns nothing — DM's staticcall fallback
    // checks `data.length >= 32` and skips the gate when length is 0.
    fallback() external {
        // returns no data
    }
}

contract MockERC1271 {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    bool internal accept;

    constructor(bool accept_) {
        accept = accept_;
    }

    function isValidSignature(bytes32, bytes calldata) external view returns (bytes4) {
        return accept ? MAGIC : bytes4(0);
    }

    // Accept the redeem path's `execute(address,uint256,bytes)` callback so
    // `_executeFromDelegator` doesn't revert with `ExecutionFailed()`. Mock
    // does nothing with the call — coverage only needs the success path.
    function execute(address, uint256, bytes calldata) external {
        // no-op
    }

    // Allow value sends in case future tests use value > 0.
    receive() external payable {}
}
