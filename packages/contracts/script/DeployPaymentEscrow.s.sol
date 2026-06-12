// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {PaymentEscrow} from "../src/payments/PaymentEscrow.sol";

/**
 * Incremental (ADDITIVE) deploy of the spec-243 §5.5 escrow rail contract (Phase 4).
 *
 * Like DeployPayments.s.sol, this does NOT run the full Deploy.s.sol (which moves every address).
 * It adds ONE self-contained contract — PaymentEscrow (hold/capture/refund/reclaim). No constructor
 * args, no wiring. The operator merges the logged address into deployments-<network>.json under
 * `paymentEscrow` (no vm.writeJson — path not in foundry fs_permissions).
 *
 *   DEPLOY_NETWORK=base-sepolia forge script script/DeployPaymentEscrow.s.sol \
 *     --rpc-url $BASE_SEPOLIA_RPC --broadcast --private-key $PRIVATE_KEY --sig "run()"
 */
contract DeployPaymentEscrow is Script {
    function run() external {
        console2.log("=== Incremental deploy: PaymentEscrow (spec 243 escrow rail) ===");
        console2.log("chainId: %s", vm.toString(block.chainid));

        vm.startBroadcast();
        PaymentEscrow escrow = new PaymentEscrow();
        vm.stopBroadcast();

        console2.log("paymentEscrow: %s", address(escrow));
    }
}
