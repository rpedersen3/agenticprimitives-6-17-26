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
// Local var renamed below; deployment JSON key kept as
// `thresholdValidator` until phase 6g.4 redeploys + updates the
// deployments JSON canonical key (separate ops concern).

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

        // 3. AgentAccountFactory (deploys AgentAccount implementation as side-effect)
        AgentAccountFactory factory = new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(dm),
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

        // 4.6. Spec 209 module — CustodyPolicy. Phase 6c.5-d.1
        //   relocated the propose/execute/cancel admin surface out of
        //   AgentAccount and into this ERC-7579 module. The factory
        //   installs it on every account created via
        //   `createAccountWithMode`. Deploying it here means the
        //   demo apps + SDK can read the canonical address from
        //   deployments-<network>.json without a separate broadcast.
        CustodyPolicy custodyPolicy = new CustodyPolicy();
        console2.log("CustodyPolicy:   %s", address(custodyPolicy));

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
        vm.serializeAddress(key, "thresholdValidator", address(custodyPolicy));
        string memory out = vm.serializeAddress(key, "universalSignatureValidator", address(universalValidator));

        string memory path = string.concat("deployments-", network, ".json");
        vm.writeFile(path, out);
        console2.log("wrote %s", path);
    }
}
