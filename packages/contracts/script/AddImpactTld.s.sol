// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {AgentNameRegistry} from "../src/naming/AgentNameRegistry.sol";
import {PermissionlessSubregistry} from "../src/naming/PermissionlessSubregistry.sol";

/**
 * Add a `.impact` TLD to the EXISTING AgentNameRegistry and deploy a permissionless subregistry
 * under it, so members claim `<label>.impact` directly (e.g. `rich-pedersen.impact`).
 *
 * INCREMENTAL — this does NOT redeploy the naming system. The registry is multi-root, so `.impact`
 * is added alongside the existing `.agent` / `demo.agent` namespace (which is left untouched).
 *   1. initializeRoot("impact", deployer, resolver, KIND_AGENT) — permissionless; deployer owns it.
 *   2. new PermissionlessSubregistry(registry, impactRoot, resolver) — one-name-per-caller, same as
 *      the demo.agent one; labels register DIRECTLY under `.impact`.
 *   3. setSubregistry(impactRoot, sub) — grant it authority (requires the root owner = deployer).
 *
 * Run as the deployer EOA (it becomes the `.impact` root owner, which step 3 requires):
 *
 *   DEPLOYER_ADDRESS=0x<deployer> \
 *   AGENT_NAME_REGISTRY=0xE9Bf4f67701Ba6eD7843b9848c3fe0C6e0212427 \
 *   AGENT_NAME_RESOLVER=0x6EB256475EeC2B6A64a2a2b4dC0D23718c8e6fD8 \
 *   forge script script/AddImpactTld.s.sol:AddImpactTld \
 *     --rpc-url "$RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast
 *
 * Then set deployments-base-sepolia.json `permissionlessSubregistry` = the printed address and
 * redeploy demo-a2a (PERMISSIONLESS_SUBREGISTRY) + the apps with AGENT_NAME_PARENT='impact'.
 */
contract AddImpactTld is Script {
    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        AgentNameRegistry registry = AgentNameRegistry(vm.envAddress("AGENT_NAME_REGISTRY"));
        address resolver = vm.envAddress("AGENT_NAME_RESOLVER");
        string memory tld = vm.envOr("IMPACT_TLD", string("impact"));

        console2.log("=== add .impact TLD ===");
        console2.log("tld:       %s", tld);
        console2.log("registry:  %s", address(registry));
        console2.log("resolver:  %s", resolver);
        console2.log("deployer:  %s", deployer);

        vm.startBroadcast();
        bytes32 root = registry.initializeRoot(tld, deployer, resolver, registry.KIND_AGENT());
        PermissionlessSubregistry sub = new PermissionlessSubregistry(registry, root, resolver);
        registry.setSubregistry(root, address(sub));
        vm.stopBroadcast();

        console2.log("  .impact root node:         %s", vm.toString(root));
        console2.log("  PermissionlessSubregistry: %s", address(sub));
        console2.log("");
        console2.log(">>> Set deployments-base-sepolia.json permissionlessSubregistry = the address above");
    }
}
