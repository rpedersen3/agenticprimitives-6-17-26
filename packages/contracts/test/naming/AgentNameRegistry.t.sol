// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../../src/naming/AgentNameRegistry.sol";

contract AgentNameRegistryTest is Test {
    AgentNameRegistry internal reg;

    address internal deployer = address(0xD3D);
    address internal aliceAgent = address(0xA11CE);
    address internal bobAgent = address(0xB0B);
    address internal eve = address(0xE2E);

    bytes32 internal AGENT_ROOT_NODE;
    bytes32 internal constant KIND = keccak256("namespace:Agent");

    function setUp() public {
        reg = new AgentNameRegistry(deployer, deployer);
        vm.prank(deployer);
        AGENT_ROOT_NODE = reg.initializeRoot("agent", deployer, address(0), KIND);
    }

    // ─── Root init ──────────────────────────────────────────────────

    function test_initializeRoot_setsKindAndOwnerAndLabel() public view {
        assertTrue(reg.isRoot(AGENT_ROOT_NODE));
        assertEq(reg.rootKind(AGENT_ROOT_NODE), KIND);
        assertEq(reg.owner(AGENT_ROOT_NODE), deployer);
        assertEq(reg.rootByLabel("agent"), AGENT_ROOT_NODE);
        bytes32[] memory roots = reg.getRoots();
        assertEq(roots.length, 1);
        assertEq(roots[0], AGENT_ROOT_NODE);
    }

    function test_initializeRoot_secondCallReverts() public {
        vm.prank(deployer);
        vm.expectRevert(AgentNameRegistry.RootAlreadyInitialized.selector);
        reg.initializeRoot("agent", deployer, address(0), KIND);
    }

    function test_initializeRoot_emptyLabelReverts() public {
        vm.prank(deployer);
        vm.expectRevert(AgentNameRegistry.EmptyLabel.selector);
        reg.initializeRoot("", deployer, address(0), KIND);
    }

    function test_initializeRoot_zeroOwnerReverts() public {
        vm.prank(deployer);
        vm.expectRevert(AgentNameRegistry.ZeroOwner.selector);
        reg.initializeRoot("foo", address(0), address(0), KIND);
    }

    /// H7-C.4 / CON-NAMING-001 — non-initializer cannot claim a TLD.
    function test_initializeRoot_nonInitializerReverts() public {
        address attacker = address(0xBAD);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(
            AgentNameRegistry.NotInitializer.selector, attacker, deployer
        ));
        reg.initializeRoot("malicious", attacker, address(0), KIND);
    }

    function test_initializeRoot_multipleRoots() public {
        vm.prank(deployer);
        bytes32 r2 = reg.initializeRoot("test", deployer, address(0), keccak256("namespace:Test"));
        assertTrue(reg.isRoot(r2));
        assertEq(reg.getRoots().length, 2);
    }

    function test_AGENT_ROOT_pureHelperMatchesInitializedRoot() public view {
        assertEq(reg.AGENT_ROOT(), AGENT_ROOT_NODE);
    }

    function test_AGENT_ROOT_matchesRecursiveNamehashAlgorithm() public view {
        // namehash("agent") = keccak256(bytes32(0) || keccak256("agent"))
        bytes32 expected = keccak256(abi.encodePacked(bytes32(0), keccak256(bytes("agent"))));
        assertEq(reg.AGENT_ROOT(), expected);
    }

    // ─── Register ───────────────────────────────────────────────────

    function test_register_aliceUnderRoot_byRootOwner() public {
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        assertTrue(reg.recordExists(alice));
        assertEq(reg.owner(alice), aliceAgent);
        assertEq(reg.parent(alice), AGENT_ROOT_NODE);
        assertEq(reg.labelhash(alice), keccak256(bytes("alice")));
    }

    function test_register_unauthorizedReverts() public {
        vm.prank(eve);
        vm.expectRevert(AgentNameRegistry.NotAuthorized.selector);
        reg.register(AGENT_ROOT_NODE, "evil", eve, address(0), 0);
    }

    function test_register_subregistryDelegateMayRegister() public {
        // deployer (root owner) delegates child issuance to aliceAgent
        vm.prank(deployer);
        reg.setSubregistry(AGENT_ROOT_NODE, aliceAgent);
        // aliceAgent now registers under root
        vm.prank(aliceAgent);
        bytes32 child = reg.register(AGENT_ROOT_NODE, "bob", bobAgent, address(0), 0);
        assertEq(reg.owner(child), bobAgent);
    }

    function test_register_duplicateReverts() public {
        vm.prank(deployer);
        reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        vm.prank(deployer);
        vm.expectRevert(AgentNameRegistry.NodeAlreadyExists.selector);
        reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
    }

    function test_register_emptyLabelReverts() public {
        vm.prank(deployer);
        vm.expectRevert(AgentNameRegistry.EmptyLabel.selector);
        reg.register(AGENT_ROOT_NODE, "", aliceAgent, address(0), 0);
    }

    function test_register_zeroOwnerReverts() public {
        vm.prank(deployer);
        vm.expectRevert(AgentNameRegistry.ZeroOwner.selector);
        reg.register(AGENT_ROOT_NODE, "alice", address(0), address(0), 0);
    }

    function test_register_parentNotFoundReverts() public {
        bytes32 fakeParent = keccak256("nope");
        vm.prank(deployer);
        vm.expectRevert(AgentNameRegistry.ParentNotFound.selector);
        reg.register(fakeParent, "child", aliceAgent, address(0), 0);
    }

    function test_register_expiredParentReverts() public {
        // Initialize a fresh root with expiry, register a name, then time-travel past expiry.
        vm.prank(deployer);
        bytes32 root = reg.initializeRoot("expiring", deployer, address(0), KIND);
        vm.prank(deployer);
        bytes32 alice = reg.register(root, "alice", aliceAgent, address(0), uint64(block.timestamp + 100));
        vm.warp(block.timestamp + 200);
        // Now registering under alice should revert with NameExpired
        vm.prank(aliceAgent);
        vm.expectRevert(AgentNameRegistry.NameExpired.selector);
        reg.register(alice, "child", bobAgent, address(0), 0);
    }

    function test_register_childIndexedByLabelhash() public {
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        assertEq(reg.childNode(AGENT_ROOT_NODE, keccak256(bytes("alice"))), alice);
        assertEq(reg.childCount(AGENT_ROOT_NODE), 1);
        bytes32[] memory labels = reg.childLabelhashes(AGENT_ROOT_NODE);
        assertEq(labels.length, 1);
        assertEq(labels[0], keccak256(bytes("alice")));
    }

    function test_register_namehashMatchesRecursiveAlgorithm() public {
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        bytes32 expected = keccak256(abi.encodePacked(AGENT_ROOT_NODE, keccak256(bytes("alice"))));
        assertEq(alice, expected);
    }

    // ─── Setters (owner-only) ───────────────────────────────────────

    function test_setOwner_byOwner() public {
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        vm.prank(aliceAgent);
        reg.setOwner(alice, bobAgent);
        assertEq(reg.owner(alice), bobAgent);
    }

    function test_setOwner_byNonOwnerReverts() public {
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        vm.prank(eve);
        vm.expectRevert(AgentNameRegistry.NotAuthorized.selector);
        reg.setOwner(alice, eve);
    }

    function test_setOwner_zeroReverts() public {
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        vm.prank(aliceAgent);
        vm.expectRevert(AgentNameRegistry.ZeroOwner.selector);
        reg.setOwner(alice, address(0));
    }

    function test_setResolver_byOwner() public {
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        vm.prank(aliceAgent);
        reg.setResolver(alice, address(0xBEEF));
        assertEq(reg.resolver(alice), address(0xBEEF));
    }

    function test_setResolver_byNonOwnerReverts() public {
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        vm.prank(eve);
        vm.expectRevert(AgentNameRegistry.NotAuthorized.selector);
        reg.setResolver(alice, address(0xBEEF));
    }

    function test_setSubregistry_byOwner() public {
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        vm.prank(aliceAgent);
        reg.setSubregistry(alice, address(0xCAFE));
        assertEq(reg.subregistry(alice), address(0xCAFE));
    }

    function test_renew_byOwner() public {
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), uint64(block.timestamp + 100));
        vm.prank(aliceAgent);
        reg.renew(alice, uint64(block.timestamp + 1000));
        assertEq(reg.expiry(alice), uint64(block.timestamp + 1000));
    }

    function test_isExpired_zeroExpiryNeverExpires() public {
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        vm.warp(block.timestamp + 10_000_000);
        assertFalse(reg.isExpired(alice));
    }

    // ─── Setters on unregistered nodes revert ────────────────────────

    function test_setters_nodeNotFoundReverts() public {
        bytes32 fake = keccak256("nope");
        vm.expectRevert(AgentNameRegistry.NodeNotFound.selector);
        reg.setOwner(fake, aliceAgent);
    }

    // ─── Primary name (reverse record) ──────────────────────────────

    function test_setPrimaryName_byAgent() public {
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        vm.prank(aliceAgent);
        reg.setPrimaryName(alice);
        assertEq(reg.primaryName(aliceAgent), alice);
    }

    function test_setPrimaryName_clearWithZero() public {
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        vm.prank(aliceAgent);
        reg.setPrimaryName(alice);
        vm.prank(aliceAgent);
        reg.setPrimaryName(bytes32(0));
        assertEq(reg.primaryName(aliceAgent), bytes32(0));
    }

    function test_setPrimaryName_unregisteredNodeReverts() public {
        vm.prank(aliceAgent);
        vm.expectRevert(AgentNameRegistry.NodeNotFound.selector);
        reg.setPrimaryName(keccak256("nope"));
    }

    function test_setPrimaryName_anyoneMaySetForSelf() public {
        // Registry is permissive — round-trip is enforced by UniversalResolver,
        // NOT here. eve can claim alice's node as her own primary; the
        // resolver's addr(node) check is what makes such a claim ineffective.
        vm.prank(deployer);
        bytes32 alice = reg.register(AGENT_ROOT_NODE, "alice", aliceAgent, address(0), 0);
        vm.prank(eve);
        reg.setPrimaryName(alice);
        assertEq(reg.primaryName(eve), alice);
    }
}
