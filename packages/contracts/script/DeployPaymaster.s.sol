// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {SmartAgentPaymaster} from "../src/SmartAgentPaymaster.sol";

/**
 * @title DeployPaymaster
 * @notice Incremental deploy: adds SmartAgentPaymaster next to an
 *         already-deployed AgentAccountFactory + EntryPoint stack. Avoids
 *         re-deploying the factory + accounts on networks where the
 *         existing deployment is live.
 *
 * Usage:
 *   ENTRY_POINT=0x... GOVERNANCE=0x... forge script DeployPaymaster.s.sol \
 *     --rpc-url $RPC --broadcast --private-key $PRIVATE_KEY \
 *     --sig "run()"
 *
 * Defaults (when env unset):
 *   PAYMASTER_STAKE_WEI       = 0.0005 ether
 *   PAYMASTER_DEPOSIT_WEI     = 0.001  ether
 *   PAYMASTER_UNSTAKE_DELAY   = 1 day
 *   PAYMASTER_DEV_MODE        = false  (R5.7 — was implicitly true)
 *   PAYMASTER_VERIFYING_SIGNER = address(0) (allowlist mode)
 *
 * The caller is also used as governance unless GOVERNANCE is set. For
 * the demo we accept this collapse; production splits governance into a
 * separate multisig.
 *
 * R5.7 — devMode is now explicit + defaults to `false`. The previous
 *        constructor silently shipped accept-all (`_dev=true`) and
 *        relied on the operator remembering setDevMode(false). Local
 *        deploys that want accept-all must set `PAYMASTER_DEV_MODE=true`
 *        on the command line.
 */
contract DeployPaymaster is Script {
    function run() external {
        address entryPoint = vm.envAddress("ENTRY_POINT");
        address deployer;
        try vm.envAddress("DEPLOYER_ADDRESS") returns (address d) {
            deployer = d;
        } catch {
            deployer = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266; // anvil[0]
        }
        address governance = vm.envOr("GOVERNANCE", deployer);

        uint256 stake = vm.envOr("PAYMASTER_STAKE_WEI", uint256(0.0005 ether));
        uint256 deposit = vm.envOr("PAYMASTER_DEPOSIT_WEI", uint256(0.001 ether));
        uint32 unstakeDelay = uint32(vm.envOr("PAYMASTER_UNSTAKE_DELAY", uint256(1 days)));
        bool devMode = vm.envOr("PAYMASTER_DEV_MODE", false);
        address verifyingSigner = vm.envOr("PAYMASTER_VERIFYING_SIGNER", address(0));

        console2.log("=== Deploying SmartAgentPaymaster ===");
        console2.log("entryPoint:     %s", entryPoint);
        console2.log("deployer:       %s", deployer);
        console2.log("governance:     %s", governance);
        console2.log("stake (wei):    %s", stake);
        console2.log("deposit (wei):  %s", deposit);
        console2.log("devMode:        %s", devMode ? "true (accept-all - DEV ONLY)" : "false");
        if (verifyingSigner != address(0)) {
            console2.log("verifyingSigner: %s", verifyingSigner);
        } else if (!devMode) {
            console2.log("verifyingSigner: <unset> (allowlist mode, fail-closed until setAccepted)");
        }

        vm.startBroadcast();
        SmartAgentPaymaster paymaster = new SmartAgentPaymaster(
            IEntryPoint(entryPoint),
            deployer,
            governance,
            devMode,
            verifyingSigner
        );
        paymaster.addStake{value: stake}(unstakeDelay);
        paymaster.deposit{value: deposit}();
        vm.stopBroadcast();

        console2.log("SmartAgentPaymaster: %s", address(paymaster));

        // Write a slim JSON sidecar — callers append into the network's
        // deployments file via scripts/append-paymaster.ts.
        string memory key = "paymaster";
        vm.serializeUint(key, "stake", stake);
        vm.serializeUint(key, "deposit", deposit);
        string memory out = vm.serializeAddress(key, "smartAgentPaymaster", address(paymaster));
        string memory network = vm.envOr("DEPLOY_NETWORK", string("anvil"));
        string memory path = string.concat("deployments-paymaster-", network, ".json");
        vm.writeFile(path, out);
        console2.log("wrote %s", path);
    }
}
