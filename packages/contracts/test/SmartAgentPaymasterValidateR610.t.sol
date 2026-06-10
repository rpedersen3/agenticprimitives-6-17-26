// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IPaymaster} from "account-abstraction/interfaces/IPaymaster.sol";
import "../src/SmartAgentPaymaster.sol";

/// R6.10 — Direct exercise of `_validatePaymasterUserOp` through the
///         `validatePaymasterUserOp` external entry, via `vm.prank` from
///         the EntryPoint address (BasePaymaster's `_requireFromEntryPoint`
///         gate).
///
/// R6.9 surfaced SmartAgentPaymaster at 50.9% line / 22.2% branch coverage
/// — below the security-critical 70% floor. The pre-existing tests
/// asserted off-chain hash-recovery sanity but never exercised the
/// validation body's branches: dev-mode short-circuit, pause revert,
/// allowlist accept + reject, verifying-mode happy-path packing,
/// malformed paymasterAndData revert, sig-invalid revert, and the
/// ECDSA recover-to-zero edge. This file exercises each branch via a
/// real `validatePaymasterUserOp` call.
contract MockGovernancePausable {
    bool public isPaused;
    function setPaused(bool p) external { isPaused = p; }
    function isSigner(address) external pure returns (bool) { return false; }
}

contract SmartAgentPaymasterValidateR610Test is Test {
    EntryPoint internal ep;
    SmartAgentPaymaster internal pm;
    MockGovernancePausable internal gov;

    address internal deployer = address(0xD1);
    address internal someSender = address(0x1234);

    uint256 internal constant VS_PK = 0xC0FFEE;
    address internal vsAddr;

    function setUp() public {
        vsAddr = vm.addr(VS_PK);
        ep = new EntryPoint();
        gov = new MockGovernancePausable();
        vm.prank(deployer);
        // Production-mode paymaster wired with the verifying signer
        // from construction (R5.7 explicit-mode default).
        pm = new SmartAgentPaymaster(
            IEntryPoint(address(ep)),
            deployer,
            address(gov),
            /* devMode_ */ false,
            /* verifyingSigner_ */ vsAddr
        );
    }

    // ─── Helpers ────────────────────────────────────────────────────

    function _baseOp(address sender) internal pure returns (PackedUserOperation memory) {
        return PackedUserOperation({
            sender: sender,
            nonce: 0,
            initCode: hex"",
            callData: hex"",
            accountGasLimits: bytes32(uint256((350_000 << 128) | 0)),
            preVerificationGas: 60_000,
            gasFees: bytes32(uint256((100_000_000 << 128) | 200_000_000)),
            paymasterAndData: hex"",
            signature: hex""
        });
    }

    /// Build a paymasterAndData blob signed by the given PK.
    /// Layout: [addr(20)][verifGas(16)][postOpGas(16)][validUntil(6)][validAfter(6)][sig(65)]
    function _verifyingPaymasterData(
        PackedUserOperation memory op,
        uint48 validUntil,
        uint48 validAfter,
        uint256 signerPk
    ) internal view returns (bytes memory) {
        bytes32 hash = pm.getHash(op, validUntil, validAfter);
        bytes32 ethHash = keccak256(abi.encodePacked('\x19Ethereum Signed Message:\n32', hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, ethHash);
        bytes memory sig = abi.encodePacked(r, s, v);
        return abi.encodePacked(
            address(pm),
            bytes16(uint128(50_000)),
            bytes16(uint128(0)),
            bytes6(uint48(validUntil)),
            bytes6(uint48(validAfter)),
            sig
        );
    }

    /// Prefix-only paymasterAndData (no tail) — for malformed-length tests.
    function _prefixOnly() internal view returns (bytes memory) {
        return abi.encodePacked(
            address(pm),
            bytes16(uint128(50_000)),
            bytes16(uint128(0))
        );
    }

    // ─── Dev-mode short-circuit ────────────────────────────────────

    function test_R6_10_validate_devMode_acceptsAll() public {
        // Flip to dev mode → every userOp passes with (ctx="", vd=0).
        vm.prank(address(gov));
        pm.setDevMode(true);

        PackedUserOperation memory op = _baseOp(someSender);
        vm.prank(address(ep));
        (bytes memory ctx, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(0), 0);
        assertEq(ctx.length, 0, "ctx must be empty");
        assertEq(vd, 0, "validationData must be 0 (valid, no time window)");
    }

    function test_R6_10_validate_devMode_paymasterDataIgnored() public {
        // In dev mode, even a malformed paymasterAndData is accepted —
        // the dev branch returns before length-checking.
        vm.prank(address(gov));
        pm.setDevMode(true);

        PackedUserOperation memory op = _baseOp(someSender);
        op.paymasterAndData = hex"deadbeef"; // 4 bytes — would fail length check in prod
        vm.prank(address(ep));
        (, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(0), 0);
        assertEq(vd, 0);
    }

    // ─── Pause gate ────────────────────────────────────────────────

    function test_R6_10_validate_paused_reverts() public {
        gov.setPaused(true);
        // PM-1: validation reads the LOCAL mirror (ERC-7562), not governance
        // storage — propagate the pause via the out-of-band sync first.
        pm.syncPauseFromGovernance();
        PackedUserOperation memory op = _baseOp(someSender);
        op.paymasterAndData = _verifyingPaymasterData(op, uint48(block.timestamp + 1 hours), 0, VS_PK);

        vm.prank(address(ep));
        vm.expectRevert(SmartAgentPaymaster.SystemPaused.selector);
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    function test_R6_10_validate_paused_then_unpaused_succeeds() public {
        gov.setPaused(true);
        pm.syncPauseFromGovernance(); // PM-1: push pause into the validation-time mirror
        PackedUserOperation memory op = _baseOp(someSender);
        uint48 validUntil = uint48(block.timestamp + 1 hours);
        op.paymasterAndData = _verifyingPaymasterData(op, validUntil, 0, VS_PK);

        vm.prank(address(ep));
        vm.expectRevert(SmartAgentPaymaster.SystemPaused.selector);
        pm.validatePaymasterUserOp(op, bytes32(0), 0);

        gov.setPaused(false);
        pm.syncPauseFromGovernance(); // PM-1: refresh the mirror to the unpaused state
        vm.prank(address(ep));
        (, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(0), 0);
        assertGt(vd, 0, "unpaused must produce a non-zero validationData (encoded window)");
    }

    function test_R6_10_validate_governance_is_EOA_skipsPauseCheck() public {
        // Governance with no code (EOA) — pause staticcall is skipped.
        SmartAgentPaymaster eoaGovPm = new SmartAgentPaymaster(
            IEntryPoint(address(ep)),
            deployer,
            /* governance = EOA */ address(0xE0A),
            /* devMode_ */ true,
            address(0)
        );
        PackedUserOperation memory op = _baseOp(someSender);
        vm.prank(address(ep));
        (, uint256 vd) = eoaGovPm.validatePaymasterUserOp(op, bytes32(0), 0);
        assertEq(vd, 0);
    }

    // ─── Verifying-paymaster happy path ─────────────────────────────

    function test_R6_10_validate_verifying_validSig_packsValidationData() public {
        uint48 validUntil = uint48(block.timestamp + 1 hours);
        uint48 validAfter = uint48(block.timestamp);

        PackedUserOperation memory op = _baseOp(someSender);
        op.paymasterAndData = _verifyingPaymasterData(op, validUntil, validAfter, VS_PK);

        vm.prank(address(ep));
        (bytes memory ctx, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(0), 0);
        assertEq(ctx.length, 0, "ctx must be empty");

        // Decode the packed validationData layout:
        //   bit 0       = sigFailed flag
        //   bits 160..207 = validUntil  (48 bits)
        //   bits 208..255 = validAfter  (48 bits)
        uint256 sigFailed = vd & 1;
        uint48 decodedUntil = uint48((vd >> 160) & ((1 << 48) - 1));
        uint48 decodedAfter = uint48((vd >> (160 + 48)) & ((1 << 48) - 1));
        assertEq(sigFailed, 0, "sigFailed bit must be 0 on a valid sig");
        assertEq(decodedUntil, validUntil, "validUntil round-trip");
        assertEq(decodedAfter, validAfter, "validAfter round-trip");
    }

    // ─── Verifying-paymaster — malformed length ─────────────────────

    function test_R6_10_validate_verifying_malformedLength_reverts() public {
        PackedUserOperation memory op = _baseOp(someSender);
        op.paymasterAndData = _prefixOnly(); // 52 bytes — missing the 77-byte tail

        vm.prank(address(ep));
        vm.expectRevert(SmartAgentPaymaster.PaymasterDataMalformed.selector);
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    function test_R6_10_validate_verifying_oneBaitByteShort_reverts() public {
        // 52 + 76 = 128 bytes — one short of the required 52 + 77 = 129.
        PackedUserOperation memory op = _baseOp(someSender);
        op.paymasterAndData = bytes.concat(_prefixOnly(), new bytes(76));
        assertEq(op.paymasterAndData.length, 128);

        vm.prank(address(ep));
        vm.expectRevert(SmartAgentPaymaster.PaymasterDataMalformed.selector);
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    // ─── Verifying-paymaster — wrong signer ─────────────────────────

    function test_R6_10_validate_verifying_wrongSigner_reverts() public {
        uint256 wrongPk = 0xBADBADBAD;
        PackedUserOperation memory op = _baseOp(someSender);
        op.paymasterAndData = _verifyingPaymasterData(
            op,
            uint48(block.timestamp + 1 hours),
            uint48(block.timestamp),
            wrongPk
        );

        vm.prank(address(ep));
        vm.expectRevert(SmartAgentPaymaster.PaymasterSignatureInvalid.selector);
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    // ─── Verifying-paymaster — ECDSA recover errors ─────────────────

    function test_R6_10_validate_verifying_zeroSignature_reverts() public {
        // sig = 65 bytes of zero. ECDSA.tryRecover returns RecoverError !=
        // NoError (InvalidSignatureS or InvalidSignature). The contract
        // reverts PaymasterSignatureInvalid for ANY recovery failure.
        uint48 validUntil = uint48(block.timestamp + 1 hours);
        uint48 validAfter = uint48(block.timestamp);
        PackedUserOperation memory op = _baseOp(someSender);
        bytes memory sig = new bytes(65); // all zeros
        op.paymasterAndData = abi.encodePacked(
            address(pm),
            bytes16(uint128(50_000)),
            bytes16(uint128(0)),
            bytes6(validUntil),
            bytes6(validAfter),
            sig
        );

        vm.prank(address(ep));
        vm.expectRevert(SmartAgentPaymaster.PaymasterSignatureInvalid.selector);
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    function test_R6_10_validate_verifying_garbageSignature_reverts() public {
        // Random 65-byte payload that doesn't recover to a valid pubkey.
        uint48 validUntil = uint48(block.timestamp + 1 hours);
        uint48 validAfter = uint48(block.timestamp);
        PackedUserOperation memory op = _baseOp(someSender);
        bytes memory sig = new bytes(65);
        for (uint256 i = 0; i < 65; i++) sig[i] = bytes1(uint8(0xAB));

        op.paymasterAndData = abi.encodePacked(
            address(pm),
            bytes16(uint128(50_000)),
            bytes16(uint128(0)),
            bytes6(validUntil),
            bytes6(validAfter),
            sig
        );

        vm.prank(address(ep));
        vm.expectRevert(SmartAgentPaymaster.PaymasterSignatureInvalid.selector);
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    // ─── Allowlist-mode fallback ────────────────────────────────────

    function test_R6_10_validate_allowlist_acceptedSender_succeeds() public {
        // Disable verifying signer → falls back to allowlist; pre-accept
        // the sender + expect (ctx="", vd=0).
        vm.startPrank(address(gov));
        pm.setVerifyingSigner(address(0));
        pm.setAccepted(someSender, true);
        vm.stopPrank();

        PackedUserOperation memory op = _baseOp(someSender);
        vm.prank(address(ep));
        (bytes memory ctx, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(0), 0);
        assertEq(ctx.length, 0);
        assertEq(vd, 0);
    }

    function test_R6_10_validate_allowlist_unacceptedSender_reverts() public {
        // Disable verifying signer → falls back to allowlist; sender NOT
        // accepted → fail-closed revert.
        vm.prank(address(gov));
        pm.setVerifyingSigner(address(0));

        PackedUserOperation memory op = _baseOp(someSender);
        vm.prank(address(ep));
        vm.expectRevert(
            abi.encodeWithSelector(SmartAgentPaymaster.SenderNotAccepted.selector, someSender)
        );
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    function test_R6_10_validate_allowlist_revokedSender_reverts() public {
        // Add then revoke; reverts as if never added.
        vm.startPrank(address(gov));
        pm.setVerifyingSigner(address(0));
        pm.setAccepted(someSender, true);
        pm.setAccepted(someSender, false);
        vm.stopPrank();

        PackedUserOperation memory op = _baseOp(someSender);
        vm.prank(address(ep));
        vm.expectRevert(
            abi.encodeWithSelector(SmartAgentPaymaster.SenderNotAccepted.selector, someSender)
        );
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    // ─── EntryPoint gate ────────────────────────────────────────────

    function test_R6_10_validate_notFromEntryPoint_reverts() public {
        // BasePaymaster's _requireFromEntryPoint gate.
        PackedUserOperation memory op = _baseOp(someSender);
        op.paymasterAndData = _verifyingPaymasterData(op, uint48(block.timestamp + 1 hours), 0, VS_PK);
        // Call from a non-EP address; the revert is the BasePaymaster
        // NotFromEntryPoint error. We use vm.expectRevert without a
        // selector match (the upstream error signature isn't directly
        // imported here).
        vm.expectRevert();
        pm.validatePaymasterUserOp(op, bytes32(0), 0);
    }

    // ─── Hash binding (CON-PAYMASTER-004 / H7-C.7) ──────────────────

    function test_R6_10_getHash_bindsEntryPoint_addressChange_changesHash() public {
        // Two paymasters with the same governance + signer but different
        // EntryPoint addresses produce different hashes for the same op
        // (H7-C.7 binding).
        EntryPoint ep2 = new EntryPoint();
        SmartAgentPaymaster pm2 = new SmartAgentPaymaster(
            IEntryPoint(address(ep2)),
            deployer,
            address(gov),
            false,
            vsAddr
        );
        PackedUserOperation memory op = _baseOp(someSender);
        bytes32 h1 = pm.getHash(op, 1000, 0);
        bytes32 h2 = pm2.getHash(op, 1000, 0);
        assertTrue(h1 != h2, "EntryPoint binding must change the hash");
    }

    function test_R6_10_getHash_changesWithChainId() public {
        PackedUserOperation memory op = _baseOp(someSender);
        bytes32 h1 = pm.getHash(op, 1000, 0);
        vm.chainId(999_999);
        bytes32 h2 = pm.getHash(op, 1000, 0);
        assertTrue(h1 != h2);
    }

    // ─── _postOp coverage ───────────────────────────────────────────

    function test_R6_10_postOp_noopThroughEntryPoint() public {
        // _postOp is intentionally a no-op. Reach it via the EntryPoint-
        // gated `postOp` external. PostOpMode.opSucceeded = 0.
        vm.prank(address(ep));
        pm.postOp(IPaymaster.PostOpMode.opSucceeded, hex"", 0, 0);
        // No revert = pass; the function body is empty.
    }

    // ─── validationData layout invariant ────────────────────────────

    function test_R6_10_validationData_validUntilZero_collapsesToNoTimeBound() public {
        // validUntil=0 means "no deadline" per the v0.7 reference; the
        // packing still emits 0 in those bits.
        uint48 validUntil = 0;
        uint48 validAfter = 0;
        PackedUserOperation memory op = _baseOp(someSender);
        op.paymasterAndData = _verifyingPaymasterData(op, validUntil, validAfter, VS_PK);

        vm.prank(address(ep));
        (, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(0), 0);
        // Both packed values are zero → vd is 0 (sigFailed=0 too).
        assertEq(vd, 0);
    }

    function test_R6_10_validationData_validUntilMax_packsCorrectly() public {
        uint48 validUntil = type(uint48).max;
        uint48 validAfter = 0;
        PackedUserOperation memory op = _baseOp(someSender);
        op.paymasterAndData = _verifyingPaymasterData(op, validUntil, validAfter, VS_PK);

        vm.prank(address(ep));
        (, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(0), 0);
        uint48 decoded = uint48((vd >> 160) & ((1 << 48) - 1));
        assertEq(decoded, validUntil);
    }

    // ─── PM-1 (2026-06-10 contract-by-contract audit) ─────────────────

    /// PM-1: validation reads the LOCAL mirror, NOT governance storage. Pausing
    /// governance WITHOUT syncing must NOT halt validation — proving the
    /// ERC-7562-violating cross-contract read is gone.
    function test_PM1_validation_readsLocalMirror_notGovernanceStorage() public {
        gov.setPaused(true); // governance paused, but mirror not synced
        PackedUserOperation memory op = _baseOp(someSender);
        op.paymasterAndData = _verifyingPaymasterData(op, uint48(block.timestamp + 1 hours), 0, VS_PK);
        vm.prank(address(ep));
        // Succeeds: the mirror is still false (no cross-contract read in validation).
        (, uint256 vd) = pm.validatePaymasterUserOp(op, bytes32(0), 0);
        assertGt(vd, 0);
        assertFalse(pm.paused());
    }

    /// PM-1: `syncPauseFromGovernance` is permissionless and refreshes the mirror
    /// from the canonical governance flag.
    function test_PM1_syncPause_permissionless_propagates() public {
        gov.setPaused(true);
        vm.prank(address(0xBEEF)); // anyone may sync
        pm.syncPauseFromGovernance();
        assertTrue(pm.paused());
        gov.setPaused(false);
        pm.syncPauseFromGovernance();
        assertFalse(pm.paused());
    }

    /// PM-1: the direct push `setPauseMirror` is governance-only.
    function test_PM1_setPauseMirror_onlyGovernance() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(SmartAgentPaymaster.NotGovernance.selector);
        pm.setPauseMirror(true);

        vm.prank(address(gov));
        pm.setPauseMirror(true);
        assertTrue(pm.paused());
    }

    // ─── PM-2 (2026-06-10 contract-by-contract audit) ─────────────────

    function _fundDeposit(uint256 amount) internal {
        vm.deal(address(this), address(this).balance + amount);
        pm.deposit{value: amount}();
    }

    /// PM-2: scheduling a deposit withdrawal is governance-only.
    function test_PM2_schedule_onlyGovernance() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(SmartAgentPaymaster.NotGovernance.selector);
        pm.scheduleDepositWithdrawal(payable(address(0xBEEF)), 1);
    }

    /// PM-2: a scheduled withdrawal cannot execute before its timelock elapses.
    function test_PM2_executeBeforeTimelock_reverts() public {
        _fundDeposit(1 ether);
        vm.prank(address(gov));
        pm.scheduleDepositWithdrawal(payable(address(0xBEEF)), 0.5 ether);
        (, , uint64 eta) = pm.pendingWithdrawal();
        vm.prank(address(gov));
        vm.expectRevert(abi.encodeWithSelector(SmartAgentPaymaster.WithdrawalNotReady.selector, eta));
        pm.executeDepositWithdrawal();
    }

    /// PM-2: after the timelock, the governance-scheduled withdrawal pays out.
    function test_PM2_executeAfterTimelock_withdraws() public {
        _fundDeposit(1 ether);
        address payable to = payable(address(0xBEEF));
        vm.prank(address(gov));
        pm.scheduleDepositWithdrawal(to, 0.5 ether);
        skip(pm.DEPOSIT_WITHDRAWAL_TIMELOCK());
        uint256 before = to.balance;
        vm.prank(address(gov));
        pm.executeDepositWithdrawal();
        assertEq(to.balance - before, 0.5 ether, "recipient paid out");
        (, , uint64 eta) = pm.pendingWithdrawal();
        assertEq(eta, 0, "pending cleared after execute");
    }

    /// PM-2: a pending withdrawal can be cancelled (governance de-escalation),
    /// after which execute reverts.
    function test_PM2_cancel_thenExecuteReverts() public {
        _fundDeposit(1 ether);
        vm.prank(address(gov));
        pm.scheduleDepositWithdrawal(payable(address(0xBEEF)), 0.5 ether);
        vm.prank(address(gov));
        pm.cancelDepositWithdrawal();
        skip(pm.DEPOSIT_WITHDRAWAL_TIMELOCK());
        vm.prank(address(gov));
        vm.expectRevert(SmartAgentPaymaster.NoPendingWithdrawal.selector);
        pm.executeDepositWithdrawal();
    }

    /// PM-2: executing with nothing scheduled reverts.
    function test_PM2_executeWithNoPending_reverts() public {
        vm.prank(address(gov));
        vm.expectRevert(SmartAgentPaymaster.NoPendingWithdrawal.selector);
        pm.executeDepositWithdrawal();
    }
}
