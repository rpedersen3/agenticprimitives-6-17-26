// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

import {AgentAccountFactory} from "../src/AgentAccountFactory.sol";
import {DelegationManager} from "../src/agency/DelegationManager.sol";
import {TimestampEnforcer} from "../src/enforcers/TimestampEnforcer.sol";
import {AllowedTargetsEnforcer} from "../src/enforcers/AllowedTargetsEnforcer.sol";
import {AllowedMethodsEnforcer} from "../src/enforcers/AllowedMethodsEnforcer.sol";
import {ValueEnforcer} from "../src/enforcers/ValueEnforcer.sol";
import {SmartAgentPaymaster} from "../src/SmartAgentPaymaster.sol";
import {UniversalSignatureValidator} from "../src/UniversalSignatureValidator.sol";
import {QuorumEnforcer} from "../src/enforcers/QuorumEnforcer.sol";
import {ApprovedHashRegistry} from "../src/ApprovedHashRegistry.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {AgentNameRegistry} from "../src/naming/AgentNameRegistry.sol";
import {AgentNameAttributeResolver} from "../src/naming/AgentNameAttributeResolver.sol";
import {AgentNameUniversalResolver} from "../src/naming/AgentNameUniversalResolver.sol";
import {AgentNamePredicates} from "../src/naming/AgentNamePredicates.sol";
import {PermissionlessSubregistry} from "../src/naming/PermissionlessSubregistry.sol";
import {OntologyTermRegistry} from "../src/ontology/OntologyTermRegistry.sol";
import {ShapeRegistry} from "../src/ontology/ShapeRegistry.sol";
import {AttributeStorage} from "../src/ontology/AttributeStorage.sol";
import {AgentRelationship} from "../src/relationships/AgentRelationship.sol";
import {RelationshipTypeRegistry} from "../src/relationships/RelationshipTypeRegistry.sol";
import {AgentRelationshipPredicates} from "../src/relationships/AgentRelationshipPredicates.sol";
import {AgentProfileResolver} from "../src/identity/AgentProfileResolver.sol";
import {AgentProfilePredicates} from "../src/identity/AgentProfilePredicates.sol";
// JSON output key is now "custodyPolicy" (was "thresholdValidator"
// pre-6g.4). On the next testnet redeploy the existing
// `deployments-base-sepolia.json` field will be overwritten under the
// new key; until then, env-var pipeline through gen-dev-vars.ts +
// deploy-cloudflare.ts speaks the new name end-to-end.

/**
 * Deploys the minimum on-chain surface the demo needs:
 *   - EntryPoint (ERC-4337 v0.9)
 *   - DelegationManager
 *   - AgentAccountFactory (which deploys an AgentAccount implementation singleton)
 *   - Four enforcers used by the demo
 *
 * Writes the resulting addresses to deployments-<network>.json so the
 * demo TypeScript apps can read them on startup.
 *
 * For demo purposes, the deployer EOA plays all four trust roles
 * (governance, bundlerSigner, sessionIssuer). Never do this in production.
 *
 * Run:
 *   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 \
 *     --broadcast --private-key 0xac0974... \
 *     --sig "run()"
 */
contract Deploy is Script {
    function run() external {
        // Detect the deployer's address from the active broadcast key.
        address deployer;
        try vm.envAddress("DEPLOYER_ADDRESS") returns (address d) {
            deployer = d;
        } catch {
            // Anvil's deterministic first account
            deployer = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
        }

        string memory network = vm.envOr("DEPLOY_NETWORK", string("anvil"));

        console2.log("=== agenticprimitives demo deploy ===");
        console2.log("network:    %s", network);
        console2.log("deployer:   %s", deployer);
        console2.log("chainId:    %s", vm.toString(block.chainid));

        vm.startBroadcast();

        // 1. EntryPoint
        EntryPoint entryPoint = new EntryPoint();
        console2.log("EntryPoint:           %s", address(entryPoint));

        // 2. DelegationManager
        DelegationManager dm = new DelegationManager();
        console2.log("DelegationManager:    %s", address(dm));

        // 2.5. CustodyPolicy — factory-immutable validator. Deployed
        //      BEFORE the factory so its address can be wired into the
        //      factory constructor. Every multi-sig account the factory
        //      creates (mode > 0) installs THIS module instance at birth.
        CustodyPolicy custodyPolicy = new CustodyPolicy();
        console2.log("CustodyPolicy:        %s", address(custodyPolicy));

        // 3. AgentAccountFactory (deploys AgentAccount implementation as side-effect)
        AgentAccountFactory factory = new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(dm),
            address(custodyPolicy),
            deployer,    // bundlerSigner
            deployer,    // sessionIssuer
            deployer     // governance
        );
        console2.log("AgentAccountFactory:  %s", address(factory));
        console2.log("AgentAccount (impl):  %s", address(factory.accountImplementation()));

        // 4. Enforcers
        TimestampEnforcer timestamp = new TimestampEnforcer();
        console2.log("TimestampEnforcer:    %s", address(timestamp));
        AllowedTargetsEnforcer allowedTargets = new AllowedTargetsEnforcer();
        console2.log("AllowedTargets:       %s", address(allowedTargets));
        AllowedMethodsEnforcer allowedMethods = new AllowedMethodsEnforcer();
        console2.log("AllowedMethods:       %s", address(allowedMethods));
        ValueEnforcer valueEnforcer = new ValueEnforcer();
        console2.log("ValueEnforcer:        %s", address(valueEnforcer));

        // 4.5. Spec 207 multi-sig substrate (phase 6c).
        //   QuorumEnforcer = N-of-M signature aggregation caveat that
        //     T3+ delegations carry. SDK builders in
        //     `@agenticprimitives/delegation.buildQuorumCaveat` reference
        //     this address; mcp-runtime's `withDelegation` threads it
        //     via `config.quorumEnforcer` (6c.4).
        //   ApprovedHashRegistry = v=1 signature path companion for
        //     passkey-only or hardware-wallet signers participating in
        //     quorums without producing off-chain ECDSA. Per-signer +
        //     per-hash approval; spam-resistant by construction (only
        //     approvals from signers in the bound set count at the
        //     QuorumEnforcer layer).
        QuorumEnforcer quorumEnforcer = new QuorumEnforcer();
        console2.log("QuorumEnforcer:       %s", address(quorumEnforcer));
        ApprovedHashRegistry approvedHashRegistry = new ApprovedHashRegistry();
        console2.log("ApprovedHashRegistry: %s", address(approvedHashRegistry));

        // 5. SmartAgentPaymaster — sponsors gas for user-op-based account deploys.
        //    Constructor takes entryPoint, initialOwner (for stake/deposit in this
        //    broadcast), and governance (for setDevMode + setAccepted later).
        //    For the demo, deployer plays both roles. Production would split.
        SmartAgentPaymaster paymaster = new SmartAgentPaymaster(
            IEntryPoint(address(entryPoint)),
            deployer,    // initialOwner (transient; can transferOwnership to governance later)
            deployer     // governance
        );
        console2.log("SmartAgentPaymaster:  %s", address(paymaster));

        // 6. UniversalSignatureValidator — signer-agnostic verifier
        //    (ECDSA / ERC-1271 / ERC-6492). demo-a2a's /auth/siwe-verify
        //    calls into this so it never inspects signature bytes;
        //    passkey vs EOA dispatch happens on-chain inside the validator.
        UniversalSignatureValidator universalValidator = new UniversalSignatureValidator();
        console2.log("UniversalSignatureValidator: %s", address(universalValidator));

        // 6.5. Shared ontology stack (ADR-0009, NS Phase 3 pivot).
        //   OntologyTermRegistry governs which predicate bytes32 ids may
        //   appear on AttributeStorage subclasses (the AgentName
        //   AttributeResolver below; relationships + identity Phase 3 will
        //   reuse this). ShapeRegistry holds SHACL-style class shapes that
        //   validate subjects against expected predicate / datatype /
        //   cardinality / enum constraints.
        OntologyTermRegistry ontology = new OntologyTermRegistry(deployer);
        console2.log("OntologyTermRegistry: %s", address(ontology));
        ShapeRegistry shapes = new ShapeRegistry(deployer);
        console2.log("ShapeRegistry:        %s", address(shapes));

        // 6.6. Agent Naming Service (NS Phase 3, spec 215).
        //   Registry + per-node attribute resolver (inherits AttributeStorage)
        //   + universal read aggregator. Deployer bootstraps the .agent
        //   root so demos can register children without chicken-and-egg.
        // H7-C.4: deployer is the immutable initializer; deploy + initializeRoot
        // run in the same transaction below so the TLD cannot be frontrun.
        AgentNameRegistry nameRegistry = new AgentNameRegistry(deployer);
        console2.log("AgentNameRegistry:    %s", address(nameRegistry));
        AgentNameAttributeResolver nameResolver = new AgentNameAttributeResolver(nameRegistry, address(ontology));
        console2.log("AgentNameResolver:    %s", address(nameResolver));
        AgentNameUniversalResolver nameUniversal = new AgentNameUniversalResolver(nameRegistry);
        console2.log("AgentNameUniversalResolver: %s", address(nameUniversal));
        bytes32 agentRoot = nameRegistry.initializeRoot(
            "agent",
            deployer,
            address(nameResolver),
            nameRegistry.KIND_AGENT()
        );
        console2.log("  .agent root node:   %s", vm.toString(agentRoot));

        // 6.7. Register the AgentName predicates so resolver writes can
        //      land. Batch-register the ten canonical atl:* predicates +
        //      define the AGENT_KIND enum set + AgentName shape. All
        //      optional cardinality initially (gradual adoption).
        _bootstrapAgentNameOntology(ontology, shapes, address(nameResolver));

        // 6.7.1. Register demo.agent + acme.agent so the bootstrap
        //        namespace exists before we wire the permissionless
        //        subregistry under demo.agent.
        bytes32 demoNode = nameRegistry.register(agentRoot, "demo", deployer, address(nameResolver), 0);
        nameRegistry.register(agentRoot, "acme", deployer, address(nameResolver), 0);
        console2.log("  demo.agent node:    %s", vm.toString(demoNode));

        // 6.7.2. Deploy the permissionless subregistry under demo.agent
        //        and grant it subregistry authority. After this, ANY
        //        caller (EOA OR Smart Agent) can claim
        //        <label>.demo.agent for an owner of their choice
        //        (capped at one claim per caller for anti-spam).
        PermissionlessSubregistry subregistry = new PermissionlessSubregistry(
            nameRegistry,
            demoNode,
            address(nameResolver)
        );
        console2.log("PermissionlessSubregistry: %s", address(subregistry));
        nameRegistry.setSubregistry(demoNode, address(subregistry));
        console2.log("  subregistry granted under demo.agent");

        // 6.8. Agent Relationships (RL Phase 3, spec 216) — trust-fabric
        //      edge store + governance-gated type semantics registry.
        RelationshipTypeRegistry relTypes = new RelationshipTypeRegistry(deployer);
        console2.log("RelationshipTypeRegistry: %s", address(relTypes));
        AgentRelationship relationships = new AgentRelationship();
        console2.log("AgentRelationship:    %s", address(relationships));
        _bootstrapRelationshipTypes(relTypes);

        // 6.9. Agent Identity profiles (ID Phase 3, spec 217) — typed
        //      profile resolver reusing the ontology stack.
        AgentProfileResolver profileResolver = new AgentProfileResolver(address(ontology));
        console2.log("AgentProfileResolver: %s", address(profileResolver));
        _bootstrapAgentProfileOntology(ontology, shapes, address(profileResolver));

        // Stake + deposit so the paymaster can sponsor UserOps immediately.
        // - addStake locks ETH for the unstake-delay window (anti-DoS for bundlers
        //   that want to know the paymaster has skin in the game).
        // - deposit goes to the EntryPoint's per-paymaster balance, charged for
        //   sponsored userOp gas reimbursement. Refilled by sending ETH to the
        //   paymaster + calling deposit() again, or by direct EntryPoint.depositTo.
        uint256 stakeAmount = vm.envOr("PAYMASTER_STAKE_WEI", uint256(0.0005 ether));
        uint256 depositAmount = vm.envOr("PAYMASTER_DEPOSIT_WEI", uint256(0.001 ether));
        uint32 unstakeDelaySec = uint32(vm.envOr("PAYMASTER_UNSTAKE_DELAY", uint256(1 days)));
        paymaster.addStake{value: stakeAmount}(unstakeDelaySec);
        paymaster.deposit{value: depositAmount}();
        console2.log("  stake:   %s wei", stakeAmount);
        console2.log("  deposit: %s wei", depositAmount);

        // 7. Optional: switch paymaster into verifying-paymaster mode
        //    (audit C2 closure). When PAYMASTER_VERIFYING_SIGNER env is
        //    set, sets the signer address + flips dev mode off. demo-a2a
        //    will sign every paymaster envelope with the matching KMS
        //    key. For local anvil deploys, leave the env unset → paymaster
        //    stays in dev/accept-all mode (which is fine for tests).
        address verifyingSigner = vm.envOr("PAYMASTER_VERIFYING_SIGNER", address(0));
        if (verifyingSigner != address(0)) {
            paymaster.setVerifyingSigner(verifyingSigner);
            paymaster.setDevMode(false);
            console2.log("  verifyingSigner: %s (dev mode OFF)", verifyingSigner);
        } else {
            console2.log("  (PAYMASTER_VERIFYING_SIGNER unset; dev mode stays ON)");
        }

        vm.stopBroadcast();

        // Write deployments-<network>.json so the TS demo apps can read addresses on startup.
        string memory key = "deployments";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "entryPoint", address(entryPoint));
        vm.serializeAddress(key, "delegationManager", address(dm));
        vm.serializeAddress(key, "agentAccountFactory", address(factory));
        vm.serializeAddress(key, "agentAccountImplementation", address(factory.accountImplementation()));
        vm.serializeAddress(key, "timestampEnforcer", address(timestamp));
        vm.serializeAddress(key, "allowedTargetsEnforcer", address(allowedTargets));
        vm.serializeAddress(key, "allowedMethodsEnforcer", address(allowedMethods));
        vm.serializeAddress(key, "valueEnforcer", address(valueEnforcer));
        vm.serializeAddress(key, "smartAgentPaymaster", address(paymaster));
        vm.serializeAddress(key, "quorumEnforcer", address(quorumEnforcer));
        vm.serializeAddress(key, "approvedHashRegistry", address(approvedHashRegistry));
        vm.serializeAddress(key, "custodyPolicy", address(custodyPolicy));
        vm.serializeAddress(key, "universalSignatureValidator", address(universalValidator));
        vm.serializeAddress(key, "ontologyTermRegistry", address(ontology));
        vm.serializeAddress(key, "shapeRegistry", address(shapes));
        vm.serializeAddress(key, "agentNameRegistry", address(nameRegistry));
        vm.serializeAddress(key, "agentNameResolver", address(nameResolver));
        vm.serializeAddress(key, "agentNameUniversalResolver", address(nameUniversal));
        vm.serializeAddress(key, "permissionlessSubregistry", address(subregistry));
        vm.serializeAddress(key, "relationshipTypeRegistry", address(relTypes));
        vm.serializeAddress(key, "agentRelationship", address(relationships));
        string memory out = vm.serializeAddress(key, "agentProfileResolver", address(profileResolver));

        string memory path = string.concat("deployments-", network, ".json");
        vm.writeFile(path, out);
        console2.log("wrote %s", path);
    }

    /**
     * @dev Register the ten canonical `atl:*` predicates on the
     *      OntologyTermRegistry, define the `AGENT_KIND` enum set, and
     *      define the `atl:AgentName` shape on the ShapeRegistry.
     *      Called during deploy AFTER the resolver is constructed
     *      (the resolver address is needed to read its public DT_*_PUB
     *      datatype discriminators).
     */
    function _bootstrapAgentNameOntology(
        OntologyTermRegistry ontology,
        ShapeRegistry shapes,
        address resolverAddr
    ) internal {
        // ─── 1. Register the predicates (governance batch) ──────────
        bytes32[] memory ids = new bytes32[](10);
        string[] memory curies = new string[](10);
        string[] memory uris = new string[](10);
        string[] memory labels = new string[](10);
        string[] memory datatypes = new string[](10);

        ids[0] = AgentNamePredicates.ATL_ADDR;
        curies[0] = "atl:addr"; uris[0] = "https://agentictrust.io/ontology/core#addr"; labels[0] = "Address"; datatypes[0] = "address";

        ids[1] = AgentNamePredicates.ATL_AGENT_KIND;
        curies[1] = "atl:agentKind"; uris[1] = "https://agentictrust.io/ontology/core#agentKind"; labels[1] = "Agent Kind"; datatypes[1] = "bytes32";

        ids[2] = AgentNamePredicates.ATL_DISPLAY_NAME;
        curies[2] = "atl:displayName"; uris[2] = "https://agentictrust.io/ontology/core#displayName"; labels[2] = "Display Name"; datatypes[2] = "string";

        ids[3] = AgentNamePredicates.ATL_A2A_ENDPOINT;
        curies[3] = "atl:a2aEndpoint"; uris[3] = "https://agentictrust.io/ontology/core#a2aEndpoint"; labels[3] = "A2A Endpoint"; datatypes[3] = "string";

        ids[4] = AgentNamePredicates.ATL_MCP_ENDPOINT;
        curies[4] = "atl:mcpEndpoint"; uris[4] = "https://agentictrust.io/ontology/core#mcpEndpoint"; labels[4] = "MCP Endpoint"; datatypes[4] = "string";

        ids[5] = AgentNamePredicates.ATL_METADATA_URI;
        curies[5] = "atl:metadataURI"; uris[5] = "https://agentictrust.io/ontology/core#metadataURI"; labels[5] = "Metadata URI"; datatypes[5] = "string";

        ids[6] = AgentNamePredicates.ATL_METADATA_HASH;
        curies[6] = "atl:metadataHash"; uris[6] = "https://agentictrust.io/ontology/core#metadataHash"; labels[6] = "Metadata Hash"; datatypes[6] = "bytes32";

        ids[7] = AgentNamePredicates.ATL_PASSKEY_CREDENTIAL_DIGEST;
        curies[7] = "atl:passkeyCredentialDigest"; uris[7] = "https://agentictrust.io/ontology/core#passkeyCredentialDigest"; labels[7] = "Passkey Credential Digest"; datatypes[7] = "bytes32";

        ids[8] = AgentNamePredicates.ATL_CUSTODY_POLICY;
        curies[8] = "atl:custodyPolicy"; uris[8] = "https://agentictrust.io/ontology/core#custodyPolicy"; labels[8] = "Custody Policy"; datatypes[8] = "address";

        ids[9] = AgentNamePredicates.ATL_NATIVE_ID;
        curies[9] = "atl:nativeId"; uris[9] = "https://agentictrust.io/ontology/core#nativeId"; labels[9] = "Native (CAIP-10) ID"; datatypes[9] = "string";

        ontology.registerTermBatch(ids, curies, uris, labels, datatypes);
        console2.log("  registered %s AgentName predicates", vm.toString(ids.length));

        // ─── 2. Define the AGENT_KIND enum set ───────────────────────
        // 3-valued (person/org/service). treasury is a service subtype at the
        // profile layer, not an agent kind (specs 210/217/225 §6). Existing
        // testnet name records with keccak256("treasury") as atl:agentKind are
        // re-seeded as 'service' on redeploy.
        bytes32[] memory kinds = new bytes32[](3);
        kinds[0] = AgentNamePredicates.AGENT_KIND_PERSON;
        kinds[1] = AgentNamePredicates.AGENT_KIND_ORG;
        kinds[2] = AgentNamePredicates.AGENT_KIND_SERVICE;
        shapes.defineEnumSet(AgentNamePredicates.AGENT_KIND_ENUM, kinds);

        // ─── 3. Define the AgentName shape ──────────────────────────
        // All cardinalities OPTIONAL for v0 (gradual adoption); the
        // shape exists primarily to give consumers a single read for
        // "is this AgentName well-formed".
        uint8 DT_STRING = AttributeStorage(resolverAddr).DT_STRING_PUB();
        uint8 DT_ADDRESS = AttributeStorage(resolverAddr).DT_ADDRESS_PUB();
        uint8 DT_BYTES32 = AttributeStorage(resolverAddr).DT_BYTES32_PUB();

        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](10);
        props[0] = ShapeRegistry.PropertyConstraint(AgentNamePredicates.ATL_ADDR, DT_ADDRESS, ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[1] = ShapeRegistry.PropertyConstraint(AgentNamePredicates.ATL_AGENT_KIND, DT_BYTES32, ShapeRegistry.Cardinality.OPTIONAL, AgentNamePredicates.AGENT_KIND_ENUM, bytes32(0));
        props[2] = ShapeRegistry.PropertyConstraint(AgentNamePredicates.ATL_DISPLAY_NAME, DT_STRING, ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[3] = ShapeRegistry.PropertyConstraint(AgentNamePredicates.ATL_A2A_ENDPOINT, DT_STRING, ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[4] = ShapeRegistry.PropertyConstraint(AgentNamePredicates.ATL_MCP_ENDPOINT, DT_STRING, ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[5] = ShapeRegistry.PropertyConstraint(AgentNamePredicates.ATL_METADATA_URI, DT_STRING, ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[6] = ShapeRegistry.PropertyConstraint(AgentNamePredicates.ATL_METADATA_HASH, DT_BYTES32, ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[7] = ShapeRegistry.PropertyConstraint(AgentNamePredicates.ATL_PASSKEY_CREDENTIAL_DIGEST, DT_BYTES32, ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[8] = ShapeRegistry.PropertyConstraint(AgentNamePredicates.ATL_CUSTODY_POLICY, DT_ADDRESS, ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[9] = ShapeRegistry.PropertyConstraint(AgentNamePredicates.ATL_NATIVE_ID, DT_STRING, ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));

        shapes.defineShape(
            AgentNamePredicates.CLASS_AGENT_NAME,
            props,
            "https://agentictrust.io/ontology/shapes/AgentName#v1",
            keccak256(bytes("AgentName-shape-v1"))
        );
        console2.log("  defined atl:AgentName shape with %s properties", vm.toString(props.length));
    }

    /**
     * @dev Register the six well-known relationship types in the
     *      RelationshipTypeRegistry. Semantics chosen to match
     *      spec 216 § 5 + the TS taxonomy in
     *      `agent-relationships/src/taxonomy.ts`.
     */
    function _bootstrapRelationshipTypes(RelationshipTypeRegistry reg) internal {
        reg.registerType(AgentRelationshipPredicates.HAS_MEMBER,             "HAS_MEMBER",             false, false, false);
        reg.registerType(AgentRelationshipPredicates.HAS_GOVERNANCE_OVER,    "HAS_GOVERNANCE_OVER",    true,  false, false);
        reg.registerType(AgentRelationshipPredicates.VALIDATION_TRUST,       "VALIDATION_TRUST",       false, false, false);
        reg.registerType(AgentRelationshipPredicates.PARTNERSHIP,            "PARTNERSHIP",            false, false, true);
        reg.registerType(AgentRelationshipPredicates.OPERATES_ON_BEHALF_OF,  "OPERATES_ON_BEHALF_OF",  false, false, false);
        reg.registerType(AgentRelationshipPredicates.RECOMMENDS,             "RECOMMENDS",             false, false, false);
        console2.log("  registered 6 well-known relationship types");
    }

    /**
     * @dev Register the identity-only predicates (the shared ones —
     *      atl:displayName, atl:agentKind, atl:metadataURI,
     *      atl:metadataHash — already exist from
     *      `_bootstrapAgentNameOntology`). Then define the
     *      atl:AgentProfile shape.
     */
    function _bootstrapAgentProfileOntology(
        OntologyTermRegistry ontology,
        ShapeRegistry shapes,
        address profileAddr
    ) internal {
        bytes32[] memory ids = new bytes32[](6);
        string[] memory curies = new string[](6);
        string[] memory uris = new string[](6);
        string[] memory labels = new string[](6);
        string[] memory datatypes = new string[](6);

        ids[0] = AgentProfilePredicates.ATL_DESCRIPTION;
        curies[0] = "atl:description"; uris[0] = "https://agentictrust.io/ontology/core#description"; labels[0] = "Description"; datatypes[0] = "string";

        ids[1] = AgentProfilePredicates.ATL_HOMEPAGE;
        curies[1] = "atl:homepage"; uris[1] = "https://agentictrust.io/ontology/core#homepage"; labels[1] = "Homepage"; datatypes[1] = "string";

        ids[2] = AgentProfilePredicates.ATL_AVATAR;
        curies[2] = "atl:avatar"; uris[2] = "https://agentictrust.io/ontology/core#avatar"; labels[2] = "Avatar URI"; datatypes[2] = "string";

        ids[3] = AgentProfilePredicates.ATL_PROFILE_SCHEMA_URI;
        curies[3] = "atl:profileSchemaURI"; uris[3] = "https://agentictrust.io/ontology/core#profileSchemaURI"; labels[3] = "Profile Schema URI"; datatypes[3] = "string";

        ids[4] = AgentProfilePredicates.ATL_PROFILE_ACTIVE;
        curies[4] = "atl:profileActive"; uris[4] = "https://agentictrust.io/ontology/core#profileActive"; labels[4] = "Profile Active"; datatypes[4] = "bool";

        ids[5] = AgentProfilePredicates.ATL_PROFILE_REGISTERED_AT;
        curies[5] = "atl:profileRegisteredAt"; uris[5] = "https://agentictrust.io/ontology/core#profileRegisteredAt"; labels[5] = "Profile Registered At"; datatypes[5] = "uint256";

        ontology.registerTermBatch(ids, curies, uris, labels, datatypes);
        console2.log("  registered %s AgentProfile predicates", vm.toString(ids.length));

        // Define the AgentProfile shape (all OPTIONAL, gradual adoption).
        uint8 DT_STRING = AttributeStorage(profileAddr).DT_STRING_PUB();
        uint8 DT_BOOL = AttributeStorage(profileAddr).DT_BOOL_PUB();
        uint8 DT_BYTES32 = AttributeStorage(profileAddr).DT_BYTES32_PUB();
        uint8 DT_UINT = AttributeStorage(profileAddr).DT_UINT256_PUB();

        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](10);
        props[0] = ShapeRegistry.PropertyConstraint(AgentProfilePredicates.ATL_DISPLAY_NAME,           DT_STRING,  ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[1] = ShapeRegistry.PropertyConstraint(AgentProfilePredicates.ATL_DESCRIPTION,            DT_STRING,  ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[2] = ShapeRegistry.PropertyConstraint(AgentProfilePredicates.ATL_AGENT_KIND,             DT_BYTES32, ShapeRegistry.Cardinality.OPTIONAL, AgentNamePredicates.AGENT_KIND_ENUM, bytes32(0));
        props[3] = ShapeRegistry.PropertyConstraint(AgentProfilePredicates.ATL_HOMEPAGE,               DT_STRING,  ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[4] = ShapeRegistry.PropertyConstraint(AgentProfilePredicates.ATL_AVATAR,                 DT_STRING,  ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[5] = ShapeRegistry.PropertyConstraint(AgentProfilePredicates.ATL_METADATA_URI,           DT_STRING,  ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[6] = ShapeRegistry.PropertyConstraint(AgentProfilePredicates.ATL_METADATA_HASH,          DT_BYTES32, ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[7] = ShapeRegistry.PropertyConstraint(AgentProfilePredicates.ATL_PROFILE_SCHEMA_URI,     DT_STRING,  ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[8] = ShapeRegistry.PropertyConstraint(AgentProfilePredicates.ATL_PROFILE_ACTIVE,         DT_BOOL,    ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));
        props[9] = ShapeRegistry.PropertyConstraint(AgentProfilePredicates.ATL_PROFILE_REGISTERED_AT,  DT_UINT,    ShapeRegistry.Cardinality.OPTIONAL, bytes32(0), bytes32(0));

        shapes.defineShape(
            AgentProfilePredicates.CLASS_AGENT_PROFILE,
            props,
            "https://agentictrust.io/ontology/shapes/AgentProfile#v1",
            keccak256(bytes("AgentProfile-shape-v1"))
        );
        console2.log("  defined atl:AgentProfile shape with %s properties", vm.toString(props.length));
    }
}
