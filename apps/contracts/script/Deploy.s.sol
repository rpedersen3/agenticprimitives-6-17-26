// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

import {AgentAccountFactory} from "../src/AgentAccountFactory.sol";
import {DelegationManager} from "../src/DelegationManager.sol";
import {TimestampEnforcer} from "../src/enforcers/TimestampEnforcer.sol";
import {AllowedTargetsEnforcer} from "../src/enforcers/AllowedTargetsEnforcer.sol";
import {AllowedMethodsEnforcer} from "../src/enforcers/AllowedMethodsEnforcer.sol";
import {ValueEnforcer} from "../src/enforcers/ValueEnforcer.sol";
import {SmartAgentPaymaster} from "../src/SmartAgentPaymaster.sol";
import {UniversalSignatureValidator} from "../src/UniversalSignatureValidator.sol";

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
        string memory out = vm.serializeAddress(key, "universalSignatureValidator", address(universalValidator));

        string memory path = string.concat("deployments-", network, ".json");
        vm.writeFile(path, out);
        console2.log("wrote %s", path);
    }
}
