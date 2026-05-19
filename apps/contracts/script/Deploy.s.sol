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
        string memory out = vm.serializeAddress(key, "valueEnforcer", address(valueEnforcer));

        string memory path = string.concat("deployments-", network, ".json");
        vm.writeFile(path, out);
        console2.log("wrote %s", path);
    }
}
