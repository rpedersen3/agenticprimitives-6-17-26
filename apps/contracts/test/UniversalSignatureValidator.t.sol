// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/UniversalSignatureValidator.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "../src/DelegationManager.sol";

contract UniversalSignatureValidatorTest is Test {
    UniversalSignatureValidator validator;
    AgentAccountFactory factory;
    DelegationManager dm;

    uint256 internal constant OWNER_PK = 0xA11CE;
    address internal owner;
    AgentAccount internal acct;

    bytes32 internal constant ERC6492_MAGIC =
        0x6492649264926492649264926492649264926492649264926492649264926492;

    function setUp() public {
        validator = new UniversalSignatureValidator();
        EntryPoint ep = new EntryPoint();
        dm = new DelegationManager();
        owner = vm.addr(OWNER_PK);
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(0xBB),
            address(0xCC),
            address(0xDD)
        );
        acct = factory.createAccount(owner, 1);
    }

    function _signRaw(uint256 pk, bytes32 hash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);
        return abi.encodePacked(r, s, v);
    }

    // ─── ECDSA path (EOA signer, no code) ────────────────────────────

    function test_ecdsa_path_accepts_valid_eoa_signature() public {
        bytes32 hash = keccak256("ecdsa");
        bytes memory sig = _signRaw(OWNER_PK, hash);
        assertTrue(validator.isValidSig(owner, hash, sig));
        assertTrue(validator.isValidSigView(owner, hash, sig));
    }

    function test_ecdsa_path_rejects_wrong_signer_address() public {
        bytes32 hash = keccak256("ecdsa-wrong");
        bytes memory sig = _signRaw(OWNER_PK, hash);
        assertFalse(validator.isValidSig(address(0xDEAD), hash, sig));
    }

    function test_ecdsa_path_rejects_malformed_signature_length() public {
        bytes32 hash = keccak256("malformed");
        bytes memory bad = new bytes(33); // not 65
        assertFalse(validator.isValidSig(owner, hash, bad));
    }

    // ─── ERC-1271 path (deployed smart account) ──────────────────────

    function test_erc1271_path_accepts_owner_sig_on_deployed_account() public {
        bytes32 hash = keccak256("1271");
        bytes memory sig = _signRaw(OWNER_PK, hash);
        assertTrue(validator.isValidSig(address(acct), hash, sig));
        assertTrue(validator.isValidSigView(address(acct), hash, sig));
    }

    function test_erc1271_path_rejects_non_owner_sig() public {
        bytes32 hash = keccak256("1271-bad");
        bytes memory sig = _signRaw(0xBEEF, hash);
        assertFalse(validator.isValidSig(address(acct), hash, sig));
    }

    // ─── ERC-6492 path (counterfactual account) ──────────────────────

    function test_erc6492_path_deploys_then_verifies() public {
        // Predict address of a not-yet-deployed account.
        address predicted = factory.getAddress(owner, 99);
        assertEq(predicted.code.length, 0);

        // Inner sig: owner's ECDSA over the hash. After 6492 deploy, the
        // proxy's isValidSignature delegates to AgentAccount which
        // routes to _verifyEcdsa.
        bytes32 hash = keccak256("6492");
        bytes memory innerSig = _signRaw(OWNER_PK, hash);

        // Build 6492-wrapped sig: abi.encode(factory, factoryCalldata, innerSig) || MAGIC
        bytes memory factoryCalldata = abi.encodeCall(factory.createAccount, (owner, 99));
        bytes memory prefix = abi.encode(address(factory), factoryCalldata, innerSig);
        bytes memory wrapped = abi.encodePacked(prefix, ERC6492_MAGIC);

        // isValidSig deploys and verifies in one shot.
        assertTrue(validator.isValidSig(predicted, hash, wrapped));
        assertGt(predicted.code.length, 0, "account should be deployed by validator");
    }

    function test_erc6492_path_view_returns_false_when_not_deployed() public view {
        // View path can't deploy; with no code, must return false.
        address predicted = factory.getAddress(owner, 100);
        bytes32 hash = keccak256("6492-view");
        bytes memory innerSig = _signRaw(OWNER_PK, hash);
        bytes memory factoryCalldata = abi.encodeCall(factory.createAccount, (owner, 100));
        bytes memory prefix = abi.encode(address(factory), factoryCalldata, innerSig);
        bytes memory wrapped = abi.encodePacked(prefix, ERC6492_MAGIC);
        assertFalse(validator.isValidSigView(predicted, hash, wrapped));
    }

    function test_erc6492_path_view_works_if_already_deployed() public {
        // If the account is already deployed, the view path strips the
        // 6492 envelope and just calls 1271.
        bytes32 hash = keccak256("6492-already");
        bytes memory innerSig = _signRaw(OWNER_PK, hash);
        bytes memory wrapped = abi.encodePacked(
            abi.encode(address(factory), bytes(""), innerSig),
            ERC6492_MAGIC
        );
        assertTrue(validator.isValidSigView(address(acct), hash, wrapped));
    }

    function test_erc6492_path_reverts_when_factory_call_does_not_deploy() public {
        // A factory call that returns OK but doesn't deploy at the
        // predicted address must revert with DeployFailed.
        address predicted = factory.getAddress(owner, 101);
        bytes32 hash = keccak256("6492-bad-factory");
        bytes memory innerSig = _signRaw(OWNER_PK, hash);
        // Wrong factoryCalldata — deploy at a different salt:
        bytes memory wrongCalldata = abi.encodeCall(factory.createAccount, (owner, 9999));
        bytes memory prefix = abi.encode(address(factory), wrongCalldata, innerSig);
        bytes memory wrapped = abi.encodePacked(prefix, ERC6492_MAGIC);
        vm.expectRevert(UniversalSignatureValidator.DeployFailed.selector);
        validator.isValidSig(predicted, hash, wrapped);
    }
}
