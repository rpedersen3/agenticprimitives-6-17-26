// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";

/**
 * @title AgentAccountCoveragePart2Test
 * @notice R3.5 — push AgentAccount.sol coverage from R3.4's 82.19%
 *         toward the ≥90% lines / ≥80% branches target. Targets the
 *         four remaining substantive uncovered surfaces:
 *
 *           1. Upgrade lifecycle: `setUpgradeTimelock` too-long revert,
 *              `executePendingUpgrade` (covers `_authorizeUpgrade`),
 *              `cancelPendingUpgrade` with valid + bad owner sig.
 *           2. ERC-7579 module install: `onInstall` revert rollback +
 *              uninstall happy path.
 *           3. ERC-4337 `validateUserOp` (covers `_validateSignature`):
 *              owner ECDSA accept + bad-sig reject + WebAuthn-type
 *              prefix routing.
 *
 *         (CA-1, RESOLVED: `scheduleUpgrade` is now the production writer of
 *         `_pendingUpgrade`, and `_authorizeUpgrade` ENFORCES the per-account
 *         timelock — a direct `upgradeToAndCall` is refused once a timelock is
 *         set. The legacy `vm.store` injection helper is retained for the
 *         older execute/cancel branch tests; the new flow is covered by the
 *         `test_CA1_*` cases below.)
 */
contract AgentAccountCoveragePart2Test is Test {
    function _defaultTimelocks() internal pure returns (uint32[7] memory tl) {}

    AgentAccountFactory factory;
    DelegationManager dm;
    EntryPoint ep;
    AgentAccount acct;

    uint256 internal constant OWNER_PK = 0xA11CE;
    address internal owner;
    address internal nonOwner = address(0xB0B);

    function setUp() public {
        ep = new EntryPoint();
        dm = new DelegationManager(address(0));
        owner = vm.addr(OWNER_PK);
        CustodyPolicy cp = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(cp),
            address(0xBB),
            address(0xCC),
            address(0xDD), address(0)
        );
        address[] memory custodians = new address[](1);
        custodians[0] = owner;
        acct = factory.createAgentAccount(_simpleParams(custodians, bytes32(0), 0, 0), _defaultTimelocks(), 7777);
        vm.deal(address(acct), 10 ether);
    }

    function _simpleParams(address[] memory custodians, bytes32 cred, uint256 x, uint256 y)
        internal
        pure
        returns (AgentAccountInitParams memory)
    {
        return AgentAccountInitParams({
            mode: 0,
            custodians: custodians,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: cred,
            initialPasskeyX: x,
            initialPasskeyY: y,
            initialPasskeyRpIdHash: bytes32(uint256(0x7270696468617368))
        });
    }

    function _signRaw(uint256 pk, bytes32 hash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);
        return abi.encodePacked(r, s, v);
    }

    function _emptyOp(address sender) internal pure returns (PackedUserOperation memory op) {
        op.sender = sender;
        op.nonce = 0;
        op.initCode = "";
        op.callData = "";
        op.accountGasLimits = bytes32(0);
        op.preVerificationGas = 0;
        op.gasFees = bytes32(0);
        op.paymasterAndData = "";
        op.signature = "";
    }

    /// Storage slot for `_pendingUpgrade` per the locked storage-layout
    /// snapshot at `test/storage-layouts/AgentAccount.snap.json`.
    uint256 internal constant SLOT_PENDING_UPGRADE = 7;

    /// Inject a pending upgrade by writing the packed struct directly.
    /// Layout: address (160 bits at offset 0) | uint64 readyAt (at offset 160).
    function _injectPendingUpgrade(address newImpl, uint64 readyAt) internal {
        uint256 packed = uint256(uint160(newImpl)) | (uint256(readyAt) << 160);
        vm.store(address(acct), bytes32(SLOT_PENDING_UPGRADE), bytes32(packed));
    }

    // ─── Upgrade lifecycle ──────────────────────────────────────────────

    function test_setUpgradeTimelock_revertsForTooLong() public {
        vm.prank(address(acct));
        vm.expectRevert(); // UpgradeTimelockTooLong custom error
        acct.setUpgradeTimelock(31 days); // MAX is 30 days
    }

    function test_setUpgradeTimelock_acceptsZero() public {
        vm.prank(address(acct));
        acct.setUpgradeTimelock(0);
        assertEq(acct.upgradeTimelock(), 0);
    }

    function test_pendingUpgrade_readsBackInjectedValue() public {
        address impl = address(0xBADF00D);
        uint64 readyAt = uint64(block.timestamp + 1 days);
        _injectPendingUpgrade(impl, readyAt);

        (address gotImpl, uint64 gotReadyAt) = acct.pendingUpgrade();
        assertEq(gotImpl, impl);
        assertEq(gotReadyAt, readyAt);
    }

    function test_executePendingUpgrade_revertsBeforeReadyAt() public {
        DummyImpl newImpl = new DummyImpl();
        uint64 readyAt = uint64(block.timestamp + 1 hours);
        _injectPendingUpgrade(address(newImpl), readyAt);

        // Before readyAt → UpgradeNotReady
        vm.expectRevert();
        acct.executePendingUpgrade();
    }

    function test_executePendingUpgrade_succeedsAfterReady() public {
        DummyImpl newImpl = new DummyImpl();
        uint64 readyAt = uint64(block.timestamp + 1 hours);
        _injectPendingUpgrade(address(newImpl), readyAt);

        vm.warp(block.timestamp + 2 hours);
        // Expect the UpgradeAuthorized event from executePendingUpgrade +
        // the standard ERC-1967 Upgraded event from upgradeToAndCall.
        // _authorizeUpgrade is exercised on the path to upgradeToAndCall.
        // We cannot call pendingUpgrade() after — the implementation slot
        // now points at DummyImpl whose fallback returns nothing — so we
        // just confirm executePendingUpgrade does NOT revert.
        acct.executePendingUpgrade();
    }

    function test_cancelPendingUpgrade_succeedsWithValidOwnerSig() public {
        address impl = address(0xC4FE);
        uint64 readyAt = uint64(block.timestamp + 1 days);
        _injectPendingUpgrade(impl, readyAt);

        bytes32 digest = keccak256(abi.encode(
            bytes32("UPGRADE_CANCEL"), impl, address(acct), block.chainid
        ));
        // _verifyEcdsa (likely) verifies eth-signed; sign accordingly.
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        bytes memory sig = _signRaw(OWNER_PK, ethHash);

        acct.cancelPendingUpgrade(sig);

        (address i, uint64 r) = acct.pendingUpgrade();
        assertEq(i, address(0));
        assertEq(r, 0);
    }

    function test_cancelPendingUpgrade_revertsWithBadOwnerSig() public {
        address impl = address(0xDEAD);
        uint64 readyAt = uint64(block.timestamp + 1 days);
        _injectPendingUpgrade(impl, readyAt);

        bytes32 digest = keccak256(abi.encode(
            bytes32("UPGRADE_CANCEL"), impl, address(acct), block.chainid
        ));
        // Sign with WRONG key.
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        uint256 wrongPk = 0xDEADC0DE;
        bytes memory badSig = _signRaw(wrongPk, ethHash);

        vm.expectRevert(); // NotOwnerSig
        acct.cancelPendingUpgrade(badSig);
    }

    // ─── CA-1 — upgrade timelock is now ENFORCED (was dead code) ────────

    /// With a timelock configured, a DIRECT owner `upgradeToAndCall` is refused —
    /// the owner must schedule + execute. (Pre-CA-1 the timelock was never
    /// consulted, so this fired immediately.)
    function test_CA1_directUpgrade_blockedWhenTimelockSet() public {
        DummyImpl newImpl = new DummyImpl();
        vm.prank(address(acct));
        acct.setUpgradeTimelock(1 days);
        vm.prank(address(acct));
        vm.expectRevert(AgentAccount.DirectUpgradeBlocked.selector);
        acct.upgradeToAndCall(address(newImpl), "");
    }

    /// With no timelock (default), a direct upgrade still fires immediately
    /// (backward-compatible).
    function test_CA1_directUpgrade_allowedWhenNoTimelock() public {
        DummyImpl newImpl = new DummyImpl();
        vm.prank(address(acct));
        acct.upgradeToAndCall(address(newImpl), ""); // no revert
    }

    /// `scheduleUpgrade` is meaningless without a timelock → rejected.
    function test_CA1_scheduleUpgrade_revertsWhenNoTimelock() public {
        DummyImpl newImpl = new DummyImpl();
        vm.prank(address(acct));
        vm.expectRevert(AgentAccount.UpgradeTimelockNotSet.selector);
        acct.scheduleUpgrade(address(newImpl));
    }

    /// `scheduleUpgrade` is onlySelf.
    function test_CA1_scheduleUpgrade_onlySelf() public {
        DummyImpl newImpl = new DummyImpl();
        vm.prank(address(acct));
        acct.setUpgradeTimelock(1 days);
        vm.prank(nonOwner);
        vm.expectRevert();
        acct.scheduleUpgrade(address(newImpl));
    }

    /// The full owner flow: setUpgradeTimelock → scheduleUpgrade → wait →
    /// executePendingUpgrade. Before the delay it reverts; after, it applies.
    function test_CA1_scheduleThenExecute_succeedsAfterDelay() public {
        DummyImpl newImpl = new DummyImpl();
        vm.prank(address(acct));
        acct.setUpgradeTimelock(1 days);
        vm.prank(address(acct));
        acct.scheduleUpgrade(address(newImpl));

        (address pendImpl, uint64 readyAt) = acct.pendingUpgrade();
        assertEq(pendImpl, address(newImpl));
        assertEq(readyAt, uint64(block.timestamp + 1 days));

        vm.expectRevert(); // UpgradeNotReady before the delay
        acct.executePendingUpgrade();

        vm.warp(block.timestamp + 1 days + 1);
        acct.executePendingUpgrade(); // matured queue → _authorizeUpgrade passes
    }

    /// CA-1 "simple-path only": the custody-module path (executeFromModule) is
    /// EXEMPT from the per-account upgrade timelock — it carries its own quorum +
    /// timelock, so no double delay. Even with `_upgradeTimelock` set, an upgrade
    /// dispatched through an installed executor module succeeds immediately.
    function test_CA1_custodyModulePath_exemptFromTimelock() public {
        OkModule mod = new OkModule();
        vm.prank(address(acct));
        acct.installModule(2 /* EXECUTOR */, address(mod), hex"");
        vm.prank(address(acct));
        acct.setUpgradeTimelock(7 days);

        DummyImpl newImpl = new DummyImpl();
        // The module dispatches `upgradeToAndCall` via executeFromModule (the
        // account calls itself). _upgradeAuthorizedCtx is set for that frame, so
        // _authorizeUpgrade passes despite the 7-day timelock — no double delay.
        vm.prank(address(mod));
        acct.executeFromModule(
            address(acct),
            0,
            abi.encodeWithSignature("upgradeToAndCall(address,bytes)", address(newImpl), "")
        );
    }

    // ─── ERC-7579 module install/uninstall ──────────────────────────────

    function test_installModule_revertsWhenOnInstallReverts() public {
        FailingModule failing = new FailingModule();
        vm.prank(address(acct));
        vm.expectRevert(); // ModuleOnInstallFailed(reason)
        acct.installModule(2 /* EXECUTOR */, address(failing), hex"");
        // Storage write was rolled back per the contract's catch block.
        address[] memory mods = acct.getInstalledModules(2);
        assertEq(mods.length, 0);
    }

    function test_installModule_revertsForZeroAddress() public {
        vm.prank(address(acct));
        vm.expectRevert(); // ZeroAddress
        acct.installModule(2, address(0), hex"");
    }

    function test_installModule_revertsForUnsupportedTypeId() public {
        OkModule okMod = new OkModule();
        vm.prank(address(acct));
        vm.expectRevert(); // UnsupportedModuleType — 3 = FALLBACK is not in supported list per contract
        acct.installModule(3 /* FALLBACK — supported list is 1/2/4 */, address(okMod), hex"");
    }

    function test_installModule_succeedsAndUninstall() public {
        OkModule okMod = new OkModule();
        vm.prank(address(acct));
        acct.installModule(2 /* EXECUTOR */, address(okMod), hex"");
        address[] memory mods = acct.getInstalledModules(2);
        assertEq(mods.length, 1);
        assertEq(mods[0], address(okMod));

        vm.prank(address(acct));
        acct.uninstallModule(2, address(okMod), hex"");
        mods = acct.getInstalledModules(2);
        assertEq(mods.length, 0);
    }

    function test_installModule_duplicate_reverts() public {
        OkModule okMod = new OkModule();
        vm.prank(address(acct));
        acct.installModule(2, address(okMod), hex"");
        vm.prank(address(acct));
        vm.expectRevert(); // ModuleAlreadyInstalled
        acct.installModule(2, address(okMod), hex"");
    }

    function test_installModule_revertsWhenOuter() public {
        OkModule okMod = new OkModule();
        vm.prank(nonOwner);
        vm.expectRevert();
        acct.installModule(2, address(okMod), hex"");
    }

    function test_installModule_hookMaxLimit_succeedsAtEdge() public {
        // Install 8 distinct hooks; the 9th should revert with TooManyHooks.
        for (uint256 i = 0; i < 8; i++) {
            OkModule m = new OkModule();
            vm.prank(address(acct));
            acct.installModule(4 /* HOOK */, address(m), hex"");
        }
        OkModule overflow = new OkModule();
        vm.prank(address(acct));
        vm.expectRevert(); // TooManyHooks
        acct.installModule(4, address(overflow), hex"");
    }

    // ─── ERC-4337 validateUserOp (covers _validateSignature) ────────────

    function test_validateUserOp_acceptsOwnerEcdsaSig() public {
        PackedUserOperation memory op = _emptyOp(address(acct));
        bytes32 userOpHash = keccak256("op-1");
        op.signature = _signRaw(OWNER_PK, userOpHash); // raw, no eth-prefix

        // EntryPoint is the only valid caller of validateUserOp.
        vm.prank(address(ep));
        uint256 validationData = acct.validateUserOp(op, userOpHash, 0);
        assertEq(validationData, 0); // 0 == valid
    }

    function test_validateUserOp_rejectsBadSig() public {
        PackedUserOperation memory op = _emptyOp(address(acct));
        bytes32 userOpHash = keccak256("op-2");
        uint256 wrongPk = 0xDEAD;
        op.signature = _signRaw(wrongPk, userOpHash);

        vm.prank(address(ep));
        uint256 validationData = acct.validateUserOp(op, userOpHash, 0);
        assertEq(validationData, 1); // 1 == SIG_VALIDATION_FAILED
    }

    function test_validateUserOp_webAuthnTypePrefix_rejectsBareEmpty() public {
        // sig type byte 0x01 = WebAuthn; decoding empty payload → returns false.
        PackedUserOperation memory op = _emptyOp(address(acct));
        bytes32 userOpHash = keccak256("op-3");
        op.signature = abi.encodePacked(bytes1(0x01), hex"deadbeef"); // garbage payload

        vm.prank(address(ep));
        uint256 validationData = acct.validateUserOp(op, userOpHash, 0);
        assertEq(validationData, 1); // garbage WebAuthn payload → SIG_VALIDATION_FAILED
    }

    function test_validateUserOp_revertsWhenNotEntryPoint() public {
        PackedUserOperation memory op = _emptyOp(address(acct));
        bytes32 userOpHash = keccak256("op-4");
        op.signature = _signRaw(OWNER_PK, userOpHash);

        vm.prank(nonOwner);
        vm.expectRevert(); // BaseAccount checks caller
        acct.validateUserOp(op, userOpHash, 0);
    }

    // ─── executeFromModule (covers ModuleExecuted + executor gate) ──────

    function test_executeFromModule_revertsWhenCallerNotInstalledExecutor() public {
        // Default state: no executors installed. Calling executeFromModule
        // from any address triggers NotInstalledExecutor.
        vm.prank(nonOwner);
        vm.expectRevert();
        acct.executeFromModule(address(0xDEAD), 0, hex"");
    }

    function test_executeFromModule_succeedsWhenCallerIsInstalledExecutor() public {
        OkModule executorMod = new OkModule();
        vm.prank(address(acct));
        acct.installModule(2 /* EXECUTOR */, address(executorMod), hex"");

        Sink2 sinkOpt = new Sink2();
        // executor module calls executeFromModule on the account
        vm.prank(address(executorMod));
        acct.executeFromModule(address(sinkOpt), 0, abi.encodeWithSelector(Sink2.bump.selector));
        assertEq(sinkOpt.count(), 1);
    }

    function test_executeFromModule_propagatesTargetRevert() public {
        OkModule executorMod = new OkModule();
        vm.prank(address(acct));
        acct.installModule(2, address(executorMod), hex"");

        Sink2 sinkOpt = new Sink2();
        vm.prank(address(executorMod));
        vm.expectRevert(Sink2.Sink2Reverted.selector);
        acct.executeFromModule(address(sinkOpt), 0, abi.encodeWithSelector(Sink2.willRevert.selector));
    }

    // ─── _isAgenticPrimitivesAgent branches via addCustodian ────────────

    function test_addCustodian_revertsWhenOwnerIsAgenticAgent() public {
        // _isAgenticPrimitivesAgent returns true for a contract that
        // advertises the IAgenticPrimitivesAgentAccount interface.
        // Our own AgentAccount qualifies, so try adding `address(acct)`
        // itself as a custodian — should hit the
        // AgenticPrimitivesAgentNotAllowedAsCustodian revert.
        vm.prank(address(acct));
        vm.expectRevert();
        acct.addCustodian(address(acct));
    }

    function test_addCustodian_revertsForZeroAddress() public {
        vm.prank(address(acct));
        vm.expectRevert();
        acct.addCustodian(address(0));
    }

    function test_addCustodian_duplicateReverts() public {
        // owner is already a custodian (added in initialize).
        vm.prank(address(acct));
        vm.expectRevert();
        acct.addCustodian(owner);
    }

    // ─── uninstallModule (covers onUninstall failure + checks) ──────────

    function test_uninstallModule_revertsForNotInstalled() public {
        vm.prank(address(acct));
        vm.expectRevert(); // ModuleNotInstalled
        acct.uninstallModule(2, address(0xC0DE), hex"");
    }

    function test_uninstallModule_revertsForUnsupportedType() public {
        vm.prank(address(acct));
        vm.expectRevert(); // UnsupportedModuleType
        acct.uninstallModule(3 /* FALLBACK */, address(0xC0DE), hex"");
    }

    function test_uninstallModule_revertsWhenNotSelf() public {
        OkModule mod = new OkModule();
        vm.prank(address(acct));
        acct.installModule(2, address(mod), hex"");

        vm.prank(nonOwner);
        vm.expectRevert(); // ModuleOperationNotAllowed
        acct.uninstallModule(2, address(mod), hex"");
    }

    function test_uninstallModule_revertsWhenOnUninstallReverts() public {
        FailingUninstallModule failing = new FailingUninstallModule();
        vm.prank(address(acct));
        acct.installModule(2, address(failing), hex"");

        vm.prank(address(acct));
        vm.expectRevert(); // ModuleOnUninstallFailed
        acct.uninstallModule(2, address(failing), hex"");
    }

    // ─── execute() with installed hook — covers pre/postCheck iteration ──

    function test_execute_withInstalledHook_invokesPreAndPostCheck() public {
        TrackingHook hook = new TrackingHook();
        vm.prank(address(acct));
        acct.installModule(4 /* HOOK */, address(hook), hex"");

        Sink2 sinkOpt = new Sink2();
        vm.prank(address(acct));
        acct.execute(address(sinkOpt), 0, abi.encodeWithSelector(Sink2.bump.selector));

        assertEq(hook.preCalls(), 1);
        assertEq(hook.postCalls(), 1);
        assertEq(sinkOpt.count(), 1);
    }

    function test_executeBatch_withInstalledHook_invokesPreAndPostCheck() public {
        TrackingHook hook = new TrackingHook();
        vm.prank(address(acct));
        acct.installModule(4, address(hook), hex"");

        Sink2 sinkOpt = new Sink2();
        BaseAccount.Call[] memory calls = new BaseAccount.Call[](2);
        calls[0] = BaseAccount.Call({
            target: address(sinkOpt), value: 0, data: abi.encodeWithSelector(Sink2.bump.selector)
        });
        calls[1] = BaseAccount.Call({
            target: address(sinkOpt), value: 0, data: abi.encodeWithSelector(Sink2.bump.selector)
        });

        vm.prank(address(acct));
        acct.executeBatch(calls);

        assertEq(hook.preCalls(), 1);
        assertEq(hook.postCalls(), 1);
        assertEq(sinkOpt.count(), 2);
    }

    // ─── _removeFromList middle-element branch ──────────────────────────

    function test_uninstallModule_middleElement_compactsList() public {
        // Install 3 modules, uninstall the MIDDLE one. Hits the
        // `i != len - 1 → list[i] = list[len-1]` branch in _removeFromList.
        OkModule m0 = new OkModule();
        OkModule m1 = new OkModule();
        OkModule m2 = new OkModule();
        vm.startPrank(address(acct));
        acct.installModule(2, address(m0), hex"");
        acct.installModule(2, address(m1), hex"");
        acct.installModule(2, address(m2), hex"");

        acct.uninstallModule(2, address(m1), hex""); // middle
        vm.stopPrank();

        address[] memory mods = acct.getInstalledModules(2);
        assertEq(mods.length, 2);
        // m0 stays at [0]; m2 was moved into m1's slot at [1].
        assertEq(mods[0], address(m0));
        assertEq(mods[1], address(m2));
    }

    // ─── ERC-6492 wrapped signature path ────────────────────────────────

    // ─── Misc small branches ────────────────────────────────────────────

    function test_isCustodian_selfIsCustodian() public view {
        // `account == address(this)` → true branch.
        assertTrue(acct.isCustodian(address(acct)));
    }

    function test_isValidSignature_emptySigReturnsInvalid() public view {
        // sig.length < 1 → false branch in _validateSig.
        bytes4 r = acct.isValidSignature(keccak256("h"), hex"");
        assertEq(r, bytes4(0xffffffff));
    }

    function test_removeCustodian_cannotRemoveLastCustodian() public {
        // Initial setup has owner as the only custodian and no passkeys.
        // Removing owner should hit CannotRemoveLastCustodian.
        vm.prank(address(acct));
        vm.expectRevert();
        acct.removeCustodian(owner);
    }

    function test_removeCustodian_revertsForNonCustodian() public {
        vm.prank(address(acct));
        vm.expectRevert();
        acct.removeCustodian(nonOwner);
    }

    function test_isValidSignature_erc6492WrappedSig_unwraps() public view {
        // ERC-6492 unwrap path lives in isValidSignature (ERC-1271), not in
        // validateUserOp. Wrap a raw owner sig with the ERC-6492 envelope
        // and confirm the ERC-1271 magic value comes back.
        bytes32 hash = keccak256("erc-6492");
        bytes memory inner = _signRaw(OWNER_PK, hash);

        bytes32 magic = 0x6492649264926492649264926492649264926492649264926492649264926492;
        bytes memory wrapped = abi.encodePacked(
            abi.encode(address(0xfa57047), hex"", inner),
            magic
        );

        bytes4 result = acct.isValidSignature(hash, wrapped);
        assertEq(result, bytes4(0x1626ba7e)); // ERC-1271 magic
    }
}

// ─── Mocks ──────────────────────────────────────────────────────────────

/// Minimal UUPS-compatible implementation used as upgrade target. The
/// `proxiableUUID` check is what UUPS requires; everything else is a no-op
/// so the upgrade can complete without further state changes.
contract DummyImpl {
    // UUPS proxiableUUID — must match EIP-1967 implementation slot.
    bytes32 internal constant IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function proxiableUUID() external pure returns (bytes32) {
        return IMPL_SLOT;
    }

    fallback() external payable {}
    receive() external payable {}
}

/// Module that reverts on onInstall — exercises the catch-block rollback.
contract FailingModule {
    function onInstall(bytes calldata) external pure {
        revert("nope");
    }
    function onUninstall(bytes calldata) external pure {}
    function isModuleType(uint256) external pure returns (bool) {
        return true;
    }
}

/// Module that accepts onInstall + onUninstall silently.
contract OkModule {
    function onInstall(bytes calldata) external {}
    function onUninstall(bytes calldata) external {}
    function isModuleType(uint256) external pure returns (bool) {
        return true;
    }
}

contract Sink2 {
    error Sink2Reverted();

    uint256 public count;

    function bump() external {
        count += 1;
    }

    function willRevert() external pure {
        revert Sink2Reverted();
    }

    receive() external payable {}
}

/// Module that reverts on uninstall.
contract FailingUninstallModule {
    function onInstall(bytes calldata) external {}
    function onUninstall(bytes calldata) external pure {
        revert("uninstall-failed");
    }
    function isModuleType(uint256) external pure returns (bool) {
        return true;
    }
}

/// Hook that increments counters on pre/postCheck. Matches the contract's
/// `IERC7579HookLike` interface: `preCheck(address,uint256,bytes)` returning
/// `bytes` + `postCheck(bytes)`.
contract TrackingHook {
    uint256 public preCalls;
    uint256 public postCalls;

    function onInstall(bytes calldata) external {}
    function onUninstall(bytes calldata) external {}
    function isModuleType(uint256) external pure returns (bool) {
        return true;
    }
    function preCheck(address, uint256, bytes calldata) external returns (bytes memory) {
        preCalls += 1;
        return hex"";
    }
    function postCheck(bytes calldata) external {
        postCalls += 1;
    }
}
