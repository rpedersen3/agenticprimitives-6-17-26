// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

import {AgentAccountFactory} from "../src/AgentAccountFactory.sol";
import {DelegationManager} from "../src/agency/DelegationManager.sol";
import {AgenticGovernance} from "../src/governance/AgenticGovernance.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {TimestampEnforcer} from "../src/enforcers/TimestampEnforcer.sol";
import {AllowedTargetsEnforcer} from "../src/enforcers/AllowedTargetsEnforcer.sol";
import {AllowedMethodsEnforcer} from "../src/enforcers/AllowedMethodsEnforcer.sol";
import {ValueEnforcer} from "../src/enforcers/ValueEnforcer.sol";
import {CallDataHashEnforcer} from "../src/enforcers/CallDataHashEnforcer.sol";
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

// R10 — W1 substrate registries (ADR-0023 + spec 241). Two new on-chain
// contracts that close out the spine: AttestationRegistry (Layers 12-15
// credential types in one EAS-aligned registry + bilateral consent) and
// AgreementRegistry (commitment-only Layer 8 anchor + bilateral status
// transitions). Neither takes constructor arguments; both are
// non-upgradeable.
import {AttestationRegistry} from "../src/attestation/AttestationRegistry.sol";
import {AgreementRegistry} from "../src/agreement/AgreementRegistry.sol";
import {SkillDefinitionRegistry} from "../src/skills/SkillDefinitionRegistry.sol";
import {GeoFeatureRegistry} from "../src/geo/GeoFeatureRegistry.sol";
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
 * **R5.4 / CON-DEPLOY-001 / XCON-001 closure (2026-05-31).** Governance,
 * paymaster owner, naming-root owner, ontology / shape / relationship-
 * type-registry owners no longer fan out to the deployer EOA. They all
 * route through a resolved **authority** address:
 *
 *   - `GOVERNANCE_MULTISIG` env var (a multi-sig SA address) → required
 *     for production networks; reverts the deploy if unset.
 *   - On `anvil` / `base-sepolia` / `base-sepolia-testnet` the deploy
 *     falls back to the deployer EOA with a loud warning so testnet
 *     iteration stays frictionless. The fallback message is the same
 *     line operators see during the production-readiness review.
 *
 * **R5.9 / PKG-DEPLOY-002 closure (2026-05-31, external audit P0-1
 * extension).** Per-role authority addresses. Each on-chain role now
 * takes its own env var; unset env vars fall back to the resolved
 * `authority` (preserving R5.4 single-multisig ergonomics):
 *
 *   - `TIMELOCK_ADMIN`, `TIMELOCK_PROPOSER`, `TIMELOCK_EXECUTOR`
 *   - `GOVERNANCE_GUARDIAN`, `GOVERNANCE_SIGNER`
 *   - `PAYMASTER_OWNER`, `NAMING_ROOT_OWNER`
 *   - `ONTOLOGY_ADMIN`, `SHAPE_ADMIN`, `RELATIONSHIP_TYPE_ADMIN`
 *   - `BUNDLER_SIGNER`, `SESSION_ISSUER` (EOA hot keys, R5.4 existing)
 *
 * Operators who want separation point each role at a different multisig;
 * operators who want the R5.4 single-multisig flow leave them unset and
 * everything routes to `GOVERNANCE_MULTISIG`. Multisig-shaped roles
 * enforce `.code.length > 0` on production networks; EOA-shaped hot
 * keys (bundler signer, session issuer) skip the contract check.
 *
 * Single-key compromise of the deployer EOA still owns the broadcast
 * key for THIS deploy transaction, but at the end of the transaction
 * the authority surface lives at the multisig(s), not the deployer.
 *
 * Run:
 *   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 \
 *     --broadcast --private-key 0xac0974... \
 *     --sig "run()"
 *
 *   # production:
 *   GOVERNANCE_MULTISIG=0xMULTISIGSAADDRESS \
 *   DEPLOY_NETWORK=base-mainnet \
 *   forge script script/Deploy.s.sol --rpc-url ... --broadcast --private-key ...
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

        // R5.4 — resolve governance authority BEFORE any auth-conferring
        // deploy. Each network either supplies GOVERNANCE_MULTISIG or
        // the script reverts (production) / warns + falls back (testnet).
        address authority = _resolveAuthority(deployer, network);

        // R5.9 / P0-1 — per-role authority resolution. Each role takes
        // its own env var; unset env vars fall back to `authority`. This
        // lets an operator point e.g. the paymaster owner at one Safe and
        // the naming root at a different one. Single-multisig deploys
        // (the R5.4 ergonomics) keep working — leave all role env vars
        // unset and everything routes to GOVERNANCE_MULTISIG.
        Roles memory roles = _resolveRoles(authority, network);

        console2.log("authority:               %s", authority);
        console2.log("  timelockAdmin:         %s", roles.timelockAdmin);
        console2.log("  timelockProposer:      %s", roles.timelockProposer);
        console2.log("  timelockExecutor:      %s", roles.timelockExecutor);
        console2.log("  governanceGuardian:    %s", roles.governanceGuardian);
        console2.log("  governanceSigner:      %s", roles.governanceSigner);
        console2.log("  paymasterOwner:        %s", roles.paymasterOwner);
        console2.log("  namingRootOwner:       %s", roles.namingRootOwner);
        console2.log("  ontologyAdmin:         %s", roles.ontologyAdmin);
        console2.log("  shapeAdmin:            %s", roles.shapeAdmin);
        console2.log("  relationshipTypeAdmin: %s", roles.relationshipTypeAdmin);
        console2.log("  bundlerSigner:         %s", roles.bundlerSigner);
        console2.log("  sessionIssuer:         %s", roles.sessionIssuer);
        // Keep the named locals for downstream readability — they're now
        // just the unpacked struct fields.
        address bundlerSigner = roles.bundlerSigner;
        address sessionIssuer = roles.sessionIssuer;

        vm.startBroadcast();

        // 1. EntryPoint
        EntryPoint entryPoint = new EntryPoint();
        console2.log("EntryPoint:           %s", address(entryPoint));

        // 1.5. H7-C.9 / EXT3-009 — Governance pattern (Timelock + AgenticGovernance).
        //
        //   TimelockController (24h, OZ standard) holds the slow-path
        //   authority. Bootstrapped with `deployer` as the only proposer +
        //   executor + admin — operator post-deploy step replaces these
        //   with a long-lived multisig (an `AgentAccount` whose
        //   `CustodyPolicy` requires M-of-N signers) and renounces.
        //
        //   AgenticGovernance is the surface every `GovernanceManaged`
        //   contract sees as `governance`. Implements `IGovernanceView`
        //   (pause + signer). Forwards timelock-routed calls so
        //   `onlyGovernance` sees `msg.sender == AgenticGovernance`.
        //   Guardian (deployer at bootstrap) can pause without delay.
        // R5.4 — every auth role bootstrapped via the resolved authority.
        // R5.9 — each role is independently env-overridable via `roles`.
        address[] memory proposers = new address[](1);
        proposers[0] = roles.timelockProposer;
        address[] memory executors = new address[](1);
        executors[0] = roles.timelockExecutor;
        TimelockController timelock = new TimelockController(
            24 hours, // minDelay
            proposers,
            executors,
            roles.timelockAdmin  // admin (multisig from this transaction onward)
        );
        console2.log("TimelockController:   %s", address(timelock));

        address[] memory initialSigners = new address[](1);
        initialSigners[0] = roles.governanceSigner;
        AgenticGovernance governance = new AgenticGovernance(
            address(timelock),
            roles.governanceGuardian,  // guardian (R5.9 per-role)
            initialSigners
        );
        console2.log("AgenticGovernance:    %s", address(governance));

        // 2. DelegationManager — receives the AgenticGovernance pointer
        //    so `redeemDelegation` honors the system-wide pause.
        DelegationManager dm = new DelegationManager(address(governance));
        console2.log("DelegationManager:    %s", address(dm));

        // 2.5. CustodyPolicy — factory-immutable validator. Deployed
        //      BEFORE the factory so its address can be wired into the
        //      factory constructor. Every multi-sig account the factory
        //      creates (mode > 0) installs THIS module instance at birth.
        CustodyPolicy custodyPolicy = new CustodyPolicy();
        console2.log("CustodyPolicy:        %s", address(custodyPolicy));

        // 2.6. ApprovedHashRegistry — deployed BEFORE the factory (spec 253)
        //      so its address can be baked IMMUTABLE into the AgentAccount
        //      impl the factory deploys. The account's `isValidSignature`
        //      0x03 sentinel consults it (org-create batches its outbound
        //      delegation approvals into one deploy userOp); it is ALSO the
        //      QuorumEnforcer v=1 companion (per-signer/per-hash approval,
        //      spam-resistant — only approvals from bound signers count).
        ApprovedHashRegistry approvedHashRegistry = new ApprovedHashRegistry();
        console2.log("ApprovedHashRegistry: %s", address(approvedHashRegistry));

        // 3. AgentAccountFactory (deploys AgentAccount implementation as side-effect)
        // R5.4 — bundlerSigner + sessionIssuer routed through the
        // resolved hot-signer addresses (env-overridable for production
        // KMS keys). Governance pointer stays at AgenticGovernance
        // (which itself is now multisig-rooted, R5.4).
        AgentAccountFactory factory = new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(dm),
            address(custodyPolicy),
            bundlerSigner,
            sessionIssuer,
            address(governance), // H7-C.9: AgenticGovernance, not deployer EOA
            address(approvedHashRegistry) // spec 253: immutable in the AgentAccount impl
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
        // RW1-4b (spec 249, ADR-0027): exact-calldata pinning enforcer —
        // terms = abi.encode(keccak256(callData)). The missing primitive for
        // exact-call sub-delegation (e.g. pinning a sensitive registry call).
        CallDataHashEnforcer callDataHashEnforcer = new CallDataHashEnforcer();
        console2.log("CallDataHashEnforcer: %s", address(callDataHashEnforcer));

        // 4.5. Spec 207 multi-sig substrate (phase 6c).
        //   QuorumEnforcer = N-of-M signature aggregation caveat that
        //     T3+ delegations carry. SDK builders in
        //     `@agenticprimitives/delegation.buildQuorumCaveat` reference
        //     this address; mcp-runtime's `withDelegation` threads it
        //     via `config.quorumEnforcer` (6c.4).
        //   (ApprovedHashRegistry — the v=1 companion — is now deployed
        //     earlier, at step 2.6, because the AgentAccount impl bakes its
        //     address in immutably; see spec 253.)
        QuorumEnforcer quorumEnforcer = new QuorumEnforcer();
        console2.log("QuorumEnforcer:       %s", address(quorumEnforcer));

        // 5. SmartAgentPaymaster — sponsors gas for user-op-based account deploys.
        //    Constructor takes entryPoint, initialOwner (multisig from broadcast
        //    onward — R5.4), governance pointer (AgenticGovernance — H7-C.9),
        //    AND now (R5.7 / P0-2) explicit devMode + verifyingSigner. Pre-R5.7
        //    the paymaster always shipped in dev/accept-all mode; production
        //    deploys had to remember a post-broadcast setDevMode(false) tx.
        //    Now the network governs: testnets → devMode=true; production →
        //    devMode=false with the verifying signer pre-wired.
        bool paymasterDevMode = _isTestnetNetwork(network);
        address verifyingSigner = vm.envOr("PAYMASTER_VERIFYING_SIGNER", address(0));
        if (!paymasterDevMode) {
            // Production: an unset signer + no dev mode = fail-closed
            // (every userOp reverts with SenderNotAccepted until governance
            // populates the allowlist). That is a safe state, but it's a
            // configuration error to land here without a deliberate intent
            // — surface it loudly so the operator can decide.
            if (verifyingSigner == address(0)) {
                console2.log("");
                console2.log("WARNING: PAYMASTER_VERIFYING_SIGNER unset on production network.");
                console2.log("WARNING: Paymaster will refuse every userOp until governance");
                console2.log("WARNING: calls setAccepted(...) or setVerifyingSigner(...).");
                console2.log("WARNING: This is fail-closed, but probably not what you want.");
                console2.log("");
            }
        }
        // R5.9 — paymaster initialOwner is the per-role address (defaults
        // to authority when PAYMASTER_OWNER env var is unset).
        SmartAgentPaymaster paymaster = new SmartAgentPaymaster(
            IEntryPoint(address(entryPoint)),
            roles.paymasterOwner,
            address(governance),
            paymasterDevMode,
            verifyingSigner
        );
        console2.log("SmartAgentPaymaster:  %s", address(paymaster));
        console2.log("  devMode:         %s", paymasterDevMode ? "true (testnet)" : "false (production)");
        if (verifyingSigner != address(0)) {
            console2.log("  verifyingSigner: %s", verifyingSigner);
        }

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
        // R5.4 — ontology + shape registries owned by the resolved authority.
        // R5.9 — each ownership independently env-overridable via roles.
        OntologyTermRegistry ontology = new OntologyTermRegistry(roles.ontologyAdmin);
        console2.log("OntologyTermRegistry: %s", address(ontology));
        ShapeRegistry shapes = new ShapeRegistry(roles.shapeAdmin);
        console2.log("ShapeRegistry:        %s", address(shapes));

        // 6.6. Agent Naming Service (NS Phase 3, spec 215).
        //   Registry + per-node attribute resolver (inherits AttributeStorage)
        //   + universal read aggregator. Deployer bootstraps the .agent
        //   root so demos can register children without chicken-and-egg.
        // H7-C.4: deployer is the immutable initializer (must match the
        // broadcast key so initializeRoot succeeds in the same tx).
        // R5.4: the .agent TLD root OWNER is the resolved authority,
        // not the deployer — initializeRoot's owner arg is the
        // long-lived authority over the root, while the constructor arg
        // is just the one-shot frontrun-resistance handle.
        // R6.8 — constructor now takes governance pointer so the
        // registry can read the system pause flag from
        // AgenticGovernance.isPaused().
        AgentNameRegistry nameRegistry = new AgentNameRegistry(deployer, address(governance));
        console2.log("AgentNameRegistry:    %s", address(nameRegistry));
        AgentNameAttributeResolver nameResolver = new AgentNameAttributeResolver(nameRegistry, address(ontology));
        console2.log("AgentNameResolver:    %s", address(nameResolver));
        AgentNameUniversalResolver nameUniversal = new AgentNameUniversalResolver(nameRegistry);
        console2.log("AgentNameUniversalResolver: %s", address(nameUniversal));
        // R5.9 — `.agent` root owner is per-role (NAMING_ROOT_OWNER).
        bytes32 agentRoot = nameRegistry.initializeRoot(
            "agent",
            roles.namingRootOwner,
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
        console2.log("PermissionlessSubregistry (demo.agent): %s", address(subregistry));
        nameRegistry.setSubregistry(demoNode, address(subregistry));
        console2.log("  subregistry granted under demo.agent");

        // 6.7.3. `.impact` TLD — the user-facing namespace (`<label>.impact`,
        //        impact-agent.me). FIRST-CLASS: provisioned on every deploy
        //        right next to `.agent` so it can never drift out of sync with
        //        the apps (AGENT_NAME_PARENT='impact'). Multi-root registry, so
        //        this is just another root + its own permissionless subregistry.
        //        Root owner = deployer so the same-tx setSubregistry succeeds
        //        (matches the demo.agent ownership shape). This is the canonical
        //        `permissionlessSubregistry` the apps consume.
        bytes32 impactRoot = nameRegistry.initializeRoot(
            "impact",
            deployer,
            address(nameResolver),
            nameRegistry.KIND_AGENT()
        );
        console2.log("  .impact root node:  %s", vm.toString(impactRoot));
        PermissionlessSubregistry impactSubregistry = new PermissionlessSubregistry(
            nameRegistry,
            impactRoot,
            address(nameResolver)
        );
        console2.log("PermissionlessSubregistry (.impact):    %s", address(impactSubregistry));
        nameRegistry.setSubregistry(impactRoot, address(impactSubregistry));
        console2.log("  subregistry granted under .impact");

        // 6.8. Agent Relationships (RL Phase 3, spec 216) — trust-fabric
        //      edge store + governance-gated type semantics registry.
        // R5.4: relationship-type registry owned by resolved authority.
        // R5.9: ownership env-overridable via RELATIONSHIP_TYPE_ADMIN.
        RelationshipTypeRegistry relTypes = new RelationshipTypeRegistry(roles.relationshipTypeAdmin);
        console2.log("RelationshipTypeRegistry: %s", address(relTypes));
        AgentRelationship relationships = new AgentRelationship();
        console2.log("AgentRelationship:    %s", address(relationships));
        _bootstrapRelationshipTypes(relTypes);

        // 6.9. Agent Identity profiles (ID Phase 3, spec 217) — typed
        //      profile resolver reusing the ontology stack.
        AgentProfileResolver profileResolver = new AgentProfileResolver(address(ontology));
        console2.log("AgentProfileResolver: %s", address(profileResolver));
        _bootstrapAgentProfileOntology(ontology, shapes, address(profileResolver));

        // 7. R10 — W1 substrate registries.
        //
        //    AttestationRegistry — EAS-aligned + bilateral-consent (ADR-0023).
        //      Carries credential types Association / Evidence / Outcome /
        //      Validation / TrustUpdate / JointAgreement / PaymentReceipt in
        //      ONE registry per ADR-0024 Decision 2 (the architectural inverse
        //      of the smart-contract-per-credential anti-pattern). Hard
        //      invariants: deterministic UID, refUID single back-pointer,
        //      EIP-712 + ERC-1271 issuer signature, no `issuerRevoke`
        //      entrypoint, epoch-bucket timestamps, four indexed event topics.
        AttestationRegistry attestationRegistry = new AttestationRegistry();
        console2.log("AttestationRegistry:  %s", address(attestationRegistry));

        //    AgreementRegistry — commitment-only registry per spec 241.
        //      The on-chain row holds the commitment hash + issuer + schema +
        //      status + epoch buckets ONLY. Party SAs never appear in
        //      register() calldata (AR-11). Status state-machine: ACTIVE →
        //      COMPLETED | DISPUTED | REVOKED with bilateral signing matrix.
        //      Nullifier set for replay protection. The public
        //      isAssertableCommitment(...) view is the gateway that the
        //      AttestationRegistry.assertJointAgreement path consumes off-
        //      chain to validate refUID back-pointers.
        AgreementRegistry agreementRegistry = new AgreementRegistry();
        console2.log("AgreementRegistry:    %s", address(agreementRegistry));

        //    Skill + Geo DEFINITION registries (spec 251) — versioned PUBLIC
        //      definition anchors only. The agent↔definition association (a
        //      claim) is an OFF-chain vault credential (no claim registry); the
        //      two registries are independent (no on-chain skill↔geo mapping);
        //      metadata is neutral/sanitized (no operational data). Reusable
        //      substrate the Switchboard (demo-gs) + future apps project over.
        SkillDefinitionRegistry skillDefinitions = new SkillDefinitionRegistry();
        console2.log("SkillDefinitionRegistry: %s", address(skillDefinitions));
        GeoFeatureRegistry geoFeatures = new GeoFeatureRegistry();
        console2.log("GeoFeatureRegistry:      %s", address(geoFeatures));

        // Note: the new `DelegationManager.verifyAuthorization(...)` view
        // entrypoint (spec 242 PD-9) is part of the redeployed DM bytecode
        // that already happened at step 2 above — no separate deploy line
        // here. The substrate's `attestations` SDK calls this view as a
        // read-only check off-chain.

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

        // 7. (R5.7) Paymaster mode is now set at construction (see step 5).
        //    No post-broadcast setDevMode/setVerifyingSigner call required.
        //    Governance can rotate later via the same setters; the
        //    deploy-time wiring is the safe initial state.

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
        vm.serializeAddress(key, "callDataHashEnforcer", address(callDataHashEnforcer));
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
        // Canonical: the apps register/resolve `<label>.impact`, so the `.impact`
        // subregistry IS `permissionlessSubregistry`. The demo.agent one is kept
        // under its own key for the `.agent` protocol namespace.
        vm.serializeAddress(key, "permissionlessSubregistry", address(impactSubregistry));
        vm.serializeAddress(key, "permissionlessSubregistryDemoAgent", address(subregistry));
        vm.serializeAddress(key, "relationshipTypeRegistry", address(relTypes));
        vm.serializeAddress(key, "agentRelationship", address(relationships));
        vm.serializeAddress(key, "agentProfileResolver", address(profileResolver));
        // R10 — W1 substrate registries (ADR-0023 + spec 241). Appended at
        // the end so the chained `vm.serializeAddress` returns the full
        // JSON with all R9 + R10 keys present.
        vm.serializeAddress(key, "attestationRegistry", address(attestationRegistry));
        vm.serializeAddress(key, "agreementRegistry", address(agreementRegistry));
        vm.serializeAddress(key, "skillDefinitionRegistry", address(skillDefinitions));
        string memory out = vm.serializeAddress(key, "geoFeatureRegistry", address(geoFeatures));

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

    // ─── R5.9: per-role authority bundle ────────────────────────────────

    /// @dev Bundle of every distinct on-chain role this deploy sets.
    ///      Pre-R5.9 every field collapsed to the resolved `authority`;
    ///      post-R5.9 each is independently env-overridable.
    struct Roles {
        // Multisig-shaped (contract on production)
        address timelockAdmin;
        address timelockProposer;
        address timelockExecutor;
        address governanceGuardian;
        address governanceSigner;
        address paymasterOwner;
        address namingRootOwner;
        address ontologyAdmin;
        address shapeAdmin;
        address relationshipTypeAdmin;
        // EOA-shaped hot keys
        address bundlerSigner;
        address sessionIssuer;
    }

    function _resolveRoles(address authority, string memory network) internal view returns (Roles memory) {
        return Roles({
            timelockAdmin:         _resolveContractRole("TIMELOCK_ADMIN",         authority, network),
            timelockProposer:      _resolveContractRole("TIMELOCK_PROPOSER",      authority, network),
            timelockExecutor:      _resolveContractRole("TIMELOCK_EXECUTOR",      authority, network),
            governanceGuardian:    _resolveContractRole("GOVERNANCE_GUARDIAN",    authority, network),
            governanceSigner:      _resolveContractRole("GOVERNANCE_SIGNER",      authority, network),
            paymasterOwner:        _resolveContractRole("PAYMASTER_OWNER",        authority, network),
            namingRootOwner:       _resolveContractRole("NAMING_ROOT_OWNER",      authority, network),
            ontologyAdmin:         _resolveContractRole("ONTOLOGY_ADMIN",         authority, network),
            shapeAdmin:            _resolveContractRole("SHAPE_ADMIN",            authority, network),
            relationshipTypeAdmin: _resolveContractRole("RELATIONSHIP_TYPE_ADMIN", authority, network),
            bundlerSigner:         _resolveEoaRole("BUNDLER_SIGNER",  authority),
            sessionIssuer:         _resolveEoaRole("SESSION_ISSUER",  authority)
        });
    }

    // ─── R5.4: governance-authority resolution ─────────────────────────

    /// @dev Resolve the address that holds every governance / pause /
    ///      ownership role at the end of this deploy. Either:
    ///        - `GOVERNANCE_MULTISIG` env var is set → use it
    ///        - testnet network with no env var → deployer (loud warn)
    ///        - production network with no env var → revert
    ///
    ///      The audit's "single-key compromise = total system takeover"
    ///      concern is the testnet-fallback case. The production-reverts
    ///      case turns the documented manual hand-off ceremony into a
    ///      hard precondition for the broadcast.
    function _resolveAuthority(address deployer, string memory network) internal view returns (address) {
        // vm.envOr is preferred over `try vm.envAddress { } catch { }` here
        // because the try-catch semantics are inconsistent across forge
        // test contexts (the catch swallows env-not-set but also legitimate
        // require reverts further down). vm.envOr returns the default when
        // the env var is unset, with no overloaded failure mode.
        address multisig = vm.envOr("GOVERNANCE_MULTISIG", address(0));

        if (multisig != address(0)) {
            require(multisig.code.length > 0, "Deploy: GOVERNANCE_MULTISIG must be a contract (Smart Agent / Safe / Timelock).");
            return multisig;
        }

        if (_isTestnetNetwork(network)) {
            console2.log("");
            console2.log(string.concat("WARNING: GOVERNANCE_MULTISIG unset for `", network, "` deploy."));
            console2.log("WARNING: Falling back to deployer EOA as authority.");
            console2.log("WARNING: All Timelock proposer/executor/admin, AgenticGovernance");
            console2.log("WARNING: guardian/signers, paymaster owner, .agent root owner,");
            console2.log("WARNING: ontology/shape/relationship-type registry owners point at");
            console2.log("WARNING: the deployer key. Single-key compromise = total system");
            console2.log("WARNING: takeover. Acceptable for anvil/testnet; never for prod.");
            console2.log("");
            return deployer;
        }

        revert(string.concat(
            "Deploy: GOVERNANCE_MULTISIG env var REQUIRED for network `",
            network,
            "`. Set it to a multi-sig SA address (deployed separately) so the post-broadcast authority surface lives at the multisig, not the deployer EOA. See R5.4 / CON-DEPLOY-001 audit closure."
        ));
    }

    // ─── R5.9: per-role authority resolution (P0-1 extension) ───────────
    //
    //   R5.4 collapsed every authority surface into one `GOVERNANCE_MULTISIG`
    //   address. That closed the "deployer owns everything" failure mode
    //   but left every role (timelock admin, paymaster owner, naming root,
    //   ontology / shape / relationship admins, bundler signer, session
    //   issuer) co-located on the same multisig. External audit P0-1 asked
    //   for role separation: an operator should be able to point the
    //   timelock admin at one multisig, the paymaster owner at another,
    //   the naming root at a third, etc.
    //
    //   The pattern: each role takes its own env var; unset env vars fall
    //   back to the resolved authority (preserving R5.4 single-multisig
    //   ergonomics for operators who don't need separation). On production
    //   networks, multisig-shaped roles enforce `.code.length > 0` so a
    //   misconfigured env var can't accidentally point at an EOA.
    //
    //   EOA-shaped hot keys (bundler signer, session issuer, paymaster
    //   verifying signer) skip the contract check — they're explicitly
    //   meant to be KMS-backed EOAs.

    /// @dev Resolve a multisig-shaped role from env, defaulting to
    ///      `defaultAuth`. On production networks, enforces that the
    ///      resolved address is a contract (same invariant as
    ///      `GOVERNANCE_MULTISIG`). The default (`GOVERNANCE_MULTISIG`)
    ///      already passed that check, so the require is only on the
    ///      env override path.
    function _resolveContractRole(
        string memory roleName,
        address defaultAuth,
        string memory network
    ) internal view returns (address) {
        address resolved = vm.envOr(roleName, defaultAuth);
        if (resolved != defaultAuth && !_isTestnetNetwork(network)) {
            require(
                resolved.code.length > 0,
                string.concat(
                    "Deploy: ",
                    roleName,
                    " must be a contract on production networks (Smart Agent / Safe / Timelock)"
                )
            );
        }
        return resolved;
    }

    /// @dev Resolve an EOA-shaped hot-key role from env, defaulting to
    ///      authority. No contract check — these roles are explicitly
    ///      KMS-backed EOAs (bundler signer, session issuer).
    function _resolveEoaRole(string memory roleName, address defaultAuth) internal view returns (address) {
        return vm.envOr(roleName, defaultAuth);
    }

    /// @dev Bundler signer is hot-key-rotatable separately from governance
    ///      (a paymaster operator can swap KMS keys without disturbing
    ///      the slow path). Pulls from `BUNDLER_SIGNER` env var; falls
    ///      back to the resolved authority.
    function _resolveBundlerSigner(address authority) internal view returns (address) {
        return _resolveEoaRole("BUNDLER_SIGNER", authority);
    }

    /// @dev Session issuer is also hot-key-rotatable. Pulls from
    ///      `SESSION_ISSUER` env var; falls back to authority.
    function _resolveSessionIssuer(address authority) internal view returns (address) {
        return _resolveEoaRole("SESSION_ISSUER", authority);
    }

    /// @dev Networks where deployer-as-authority fallback is allowed.
    ///      Anything else is production and requires GOVERNANCE_MULTISIG.
    function _isTestnetNetwork(string memory network) internal pure returns (bool) {
        return (
            keccak256(bytes(network)) == keccak256(bytes("anvil")) ||
            keccak256(bytes(network)) == keccak256(bytes("base-sepolia")) ||
            keccak256(bytes(network)) == keccak256(bytes("base-sepolia-testnet")) ||
            keccak256(bytes(network)) == keccak256(bytes("sepolia"))
        );
    }
}
