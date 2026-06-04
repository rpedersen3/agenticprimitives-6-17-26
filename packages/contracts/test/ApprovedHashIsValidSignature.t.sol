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
import {ApprovedHashRegistry} from "../src/ApprovedHashRegistry.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";

/**
 * @title ApprovedHashIsValidSignature — spec 253 gate matrix
 * @notice Exercises the `0x03` approved-hash sentinel added to
 *         `AgentAccount.isValidSignature`. These are the seven tests the
 *         security-auditor required as the merge gate (spec 253 §5):
 *           1. userOp `0x03` over a pre-approved hash is REJECTED by the
 *              userOp-auth path (the P0 isolation — sentinel is ERC-1271 only).
 *           2. `isValidSignature(approvedHash, 0x03)` ⇒ magic; un-approved ⇒ invalid.
 *           3. cross-account isolation: B's `0x03` over a hash A approved ⇒ invalid.
 *           4. registry == address(0) ⇒ sentinel fails closed.
 *           5. revoked-in-registry sentinel ⇒ invalid (the on-chain kill switch).
 *           6. custody mutators stay `onlySelf` — an approved hash never opens custody.
 *           7. non-sentinel signatures byte-for-byte unaffected (regression).
 */
contract ApprovedHashIsValidSignatureTest is Test {
    EntryPoint internal ep;
    AgentAccountFactory internal factory;
    AgentAccountFactory internal factoryNoRegistry;
    DelegationManager internal dm;
    ApprovedHashRegistry internal registry;
    AgentAccount internal acctA;
    AgentAccount internal acctB;
    AgentAccount internal acctNoRegistry;

    uint256 internal constant OWNER_PK = 0xA11CE;
    address internal owner;
    address internal nonOwner = address(0xB0B);

    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;
    bytes4 internal constant ERC1271_INVALID = 0xffffffff;
    bytes internal constant SENTINEL = hex"03";

    function setUp() public {
        ep = new EntryPoint();
        dm = new DelegationManager(address(0));
        owner = vm.addr(OWNER_PK);
        registry = new ApprovedHashRegistry();
        CustodyPolicy cp = new CustodyPolicy();

        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)), address(dm), address(cp),
            address(0xBB), address(0xCC), address(0xDD), address(registry)
        );
        // A second factory whose impl bakes a ZERO registry — to prove the
        // sentinel fails closed when no registry is wired.
        factoryNoRegistry = new AgentAccountFactory(
            IEntryPoint(address(ep)), address(dm), address(cp),
            address(0xBB), address(0xCC), address(0xDD), address(0)
        );

        address[] memory custodians = new address[](1);
        custodians[0] = owner;
        acctA = factory.createAgentAccount(_simpleParams(custodians), _tl(), 1);
        acctB = factory.createAgentAccount(_simpleParams(custodians), _tl(), 2);
        acctNoRegistry = factoryNoRegistry.createAgentAccount(_simpleParams(custodians), _tl(), 3);
    }

    function _tl() internal pure returns (uint32[7] memory tl) {}

    function _simpleParams(address[] memory custodians)
        internal pure returns (AgentAccountInitParams memory)
    {
        return AgentAccountInitParams({
            mode: 0,
            custodians: custodians,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0,
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

    /// Approve `hash` as `account` itself (mirrors the production path: the
    /// account `approveHash`es inside its own custody-gated execute/batch).
    function _approveAs(address account, bytes32 hash) internal {
        vm.prank(account);
        registry.approveHash(hash);
    }

    // ── 1 (P0): the sentinel is NOT honored on the userOp-auth path ──────
    function test_userOp_doesNotHonorSentinel() public {
        bytes32 userOpHash = keccak256("op-hash");
        _approveAs(address(acctA), userOpHash); // even though the hash is approved…

        PackedUserOperation memory op = _emptyOp(address(acctA));
        op.signature = SENTINEL;

        vm.prank(address(ep));
        uint256 validationData = acctA.validateUserOp(op, userOpHash, 0);
        // …a userOp signed with 0x03 must FAIL validation (1), never authorize (0).
        assertEq(validationData, 1, "sentinel must not authorize a userOp");
    }

    // ── 2: ERC-1271 sentinel validates an approved hash, rejects others ──
    function test_sentinel_validatesApprovedHash() public {
        bytes32 hash = keccak256("approved");
        _approveAs(address(acctA), hash);
        assertEq(acctA.isValidSignature(hash, SENTINEL), ERC1271_MAGIC);
    }

    function test_sentinel_rejectsUnapprovedHash() public view {
        bytes32 hash = keccak256("never-approved");
        assertEq(acctA.isValidSignature(hash, SENTINEL), ERC1271_INVALID);
    }

    // ── 3: cross-account isolation ───────────────────────────────────────
    function test_sentinel_crossAccountIsolation() public {
        bytes32 hash = keccak256("a-only");
        _approveAs(address(acctA), hash); // approved under A's namespace only
        assertEq(acctA.isValidSignature(hash, SENTINEL), ERC1271_MAGIC, "A accepts");
        assertEq(acctB.isValidSignature(hash, SENTINEL), ERC1271_INVALID, "B must reject");
    }

    // ── 4 (P1): fails closed when no registry is wired ───────────────────
    function test_sentinel_failsClosedWhenRegistryZero() public {
        bytes32 hash = keccak256("anything");
        // Approving in the global registry is irrelevant — this account's
        // impl baked address(0), so it consults nothing and fails closed.
        _approveAs(address(acctNoRegistry), hash);
        assertEq(acctNoRegistry.isValidSignature(hash, SENTINEL), ERC1271_INVALID);
    }

    // ── 5: revocation in the registry kills the sentinel ─────────────────
    function test_sentinel_revokedHashRejected() public {
        bytes32 hash = keccak256("to-be-revoked");
        _approveAs(address(acctA), hash);
        assertEq(acctA.isValidSignature(hash, SENTINEL), ERC1271_MAGIC, "valid before revoke");
        vm.prank(address(acctA));
        registry.revokeHash(hash);
        assertEq(acctA.isValidSignature(hash, SENTINEL), ERC1271_INVALID, "invalid after revoke");
    }

    // ── 6 (F-2): an approved hash never opens custody (mutators onlySelf) ─
    function test_approvedHash_doesNotOpenCustody() public {
        // Approve an arbitrary hash under the account, then prove a non-self
        // caller still cannot mutate custody — custody never routes through
        // isValidSignature / the registry.
        _approveAs(address(acctA), keccak256("mischief"));
        vm.prank(nonOwner);
        vm.expectRevert();
        acctA.addCustodian(address(0xDEAD));
    }

    // ── 7: non-sentinel signatures unaffected (regression) ───────────────
    function test_nonSentinel_ownerSigStillValidates() public view {
        bytes32 hash = keccak256("owner-signed");
        bytes memory sig = _signRaw(OWNER_PK, hash);
        assertEq(acctA.isValidSignature(hash, sig), ERC1271_MAGIC);
    }

    function test_nonSentinel_zeroByteRoutesToValidateSig() public view {
        // A bare 0x00 (not the 0x03 sentinel, not 65 bytes) must NOT touch the
        // registry — it routes to _validateSig and returns invalid.
        bytes32 hash = keccak256("x");
        assertEq(acctA.isValidSignature(hash, hex"00"), ERC1271_INVALID);
    }
}
