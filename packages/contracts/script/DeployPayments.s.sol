// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {PaymentEnforcer} from "../src/enforcers/PaymentEnforcer.sol";
import {PaymentReceiptRegistry} from "../src/payments/PaymentReceiptRegistry.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/**
 * Incremental (ADDITIVE) deploy of the spec-272 x402 pay-per-use substrate (Wave 1).
 *
 * This does NOT run the full Deploy.s.sol — that redeploys the core and would move
 * `delegationManager` + every address, breaking every existing grant + the live demos
 * (the delegationManager-moved lesson). It only adds the 3 new, self-contained contracts:
 *   - PaymentReceiptRegistry — trustless settlement log
 *   - PaymentEnforcer(registry) — the stateful x402 caveat (wired as the registry's sole recorder)
 *   - MockUSDC — dev fee asset (EIP-3009)
 *
 * Writes the 3 addresses to a sidecar `deployments-payments-<network>.json`; the operator (or the
 * follow-up tooling) copies them into `deployments-<network>.json` under `paymentEnforcer` /
 * `paymentReceiptRegistry` / `mockUsdc`.
 *
 *   DEPLOY_NETWORK=base-sepolia forge script script/DeployPayments.s.sol \
 *     --rpc-url $BASE_SEPOLIA_RPC --broadcast --private-key $PRIVATE_KEY --sig "run()"
 */
contract DeployPayments is Script {
    function run() external {
        console2.log("=== Incremental deploy: x402 pay-per-use (spec 272 W1) ===");
        console2.log("chainId: %s", vm.toString(block.chainid));

        vm.startBroadcast();
        PaymentReceiptRegistry receipts = new PaymentReceiptRegistry();
        PaymentEnforcer enforcer = new PaymentEnforcer(address(receipts));
        receipts.setEnforcer(address(enforcer));
        MockUSDC usdc = new MockUSDC();
        vm.stopBroadcast();

        console2.log("paymentReceiptRegistry: %s", address(receipts));
        console2.log("paymentEnforcer:        %s", address(enforcer));
        console2.log("mockUsdc:               %s", address(usdc));

        string memory key = "payments";
        vm.serializeAddress(key, "paymentEnforcer", address(enforcer));
        vm.serializeAddress(key, "paymentReceiptRegistry", address(receipts));
        string memory out = vm.serializeAddress(key, "mockUsdc", address(usdc));
        string memory network = vm.envOr("DEPLOY_NETWORK", string("anvil"));
        string memory path = string.concat("deployments-payments-", network, ".json");
        vm.writeJson(out, path);
        console2.log("wrote %s (merge these 3 keys into deployments-%s.json)", path, network);
    }
}
