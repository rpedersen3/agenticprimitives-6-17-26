// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {SkillDefinitionRegistry} from "../src/skills/SkillDefinitionRegistry.sol";
import {GeoFeatureRegistry} from "../src/geo/GeoFeatureRegistry.sol";

/**
 * @title DeploySkillsGeo
 * @notice Targeted, ADDITIVE deploy of the spec-251 skill + geo DEFINITION registries.
 *
 * Both registries are fully independent — no constructor args, no cross-references, and
 * nothing else in the substrate references them yet. So we deploy ONLY these two and merge
 * their addresses into the existing `deployments-<network>.json` (a node post-step), rather
 * than running the full `Deploy.s.sol` (which would re-deploy every contract and churn every
 * address + force all apps to redeploy). The other addresses are untouched.
 *
 * Run: `forge script script/DeploySkillsGeo.s.sol --rpc-url $BASE_SEPOLIA_RPC \
 *         --private-key $PRIVATE_KEY --broadcast`
 * then merge the two logged addresses into deployments-base-sepolia.json + `pnpm build:deployments`.
 */
contract DeploySkillsGeo is Script {
    function run() external {
        vm.startBroadcast();
        SkillDefinitionRegistry skills = new SkillDefinitionRegistry();
        GeoFeatureRegistry geo = new GeoFeatureRegistry();
        vm.stopBroadcast();

        console2.log("skillDefinitionRegistry", address(skills));
        console2.log("geoFeatureRegistry", address(geo));
    }
}
