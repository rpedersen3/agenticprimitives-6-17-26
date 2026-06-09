// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {AgreementRegistry} from "../src/agreement/AgreementRegistry.sol";
import {AttestationRegistry} from "../src/attestation/AttestationRegistry.sol";

/**
 * @title DeployRegistries
 * @notice Incremental redeploy of the two standalone, no-arg leaf registries that the 2026-06-09
 *         audit fixes re-bytecoded:
 *           - AgreementRegistry  (SC-1 — issuer signature now bound to agreement contents)
 *           - AttestationRegistry (SC-2 — issuer signature now binds the subject)
 *
 *         Both take NO constructor args, and nothing on-chain bakes in their addresses (only apps
 *         reference them), so they can be redeployed WITHOUT a full factory reset — preserving every
 *         persona / name / SA address in the existing deployment. (SC-3's DelegationManager change is
 *         immutable in the factory and therefore needs the next full reset; it is a latent view fn.)
 *
 * After running:
 *   1. Copy the two logged addresses into `deployments-<network>.json` under
 *      `agreementRegistry` + `attestationRegistry`.
 *   2. `pnpm build:deployments` in packages/contracts (regenerates the subpath export).
 *   3. Redeploy the only consumer with the changed ABI: demo-jp
 *      (`cd apps/demo-jp && pnpm build && wrangler pages deploy dist --branch=main`).
 *
 * Run (base-sepolia):
 *   DEPLOY_NETWORK=base-sepolia forge script script/DeployRegistries.s.sol \
 *     --rpc-url $BASE_SEPOLIA_RPC --broadcast --private-key $PRIVATE_KEY --sig "run()"
 */
contract DeployRegistries is Script {
    function run() external {
        console2.log("=== Incremental deploy: AgreementRegistry + AttestationRegistry (SC-1/SC-2) ===");
        console2.log("chainId: %s", vm.toString(block.chainid));

        vm.startBroadcast();
        AgreementRegistry agreement = new AgreementRegistry();
        AttestationRegistry attestation = new AttestationRegistry();
        vm.stopBroadcast();

        console2.log("agreementRegistry:   %s", address(agreement));
        console2.log("attestationRegistry: %s", address(attestation));

        // Slim sidecar — operator copies these two keys into deployments-<network>.json.
        string memory key = "registries";
        vm.serializeAddress(key, "agreementRegistry", address(agreement));
        string memory out = vm.serializeAddress(key, "attestationRegistry", address(attestation));
        string memory network = vm.envOr("DEPLOY_NETWORK", string("anvil"));
        string memory path = string.concat("deployments-registries-", network, ".json");
        vm.writeFile(path, out);
        console2.log("wrote %s  (copy these 2 keys into deployments-%s.json)", path, network);
    }
}
