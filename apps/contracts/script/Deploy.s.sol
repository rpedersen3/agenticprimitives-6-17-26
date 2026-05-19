// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// TODO (next commit): vendor contracts from smart-agent and complete this script.
//
// Final shape (per the demo plan):
//
//   import {AgentAccountFactory} from "../src/AgentAccountFactory.sol";
//   import {DelegationManager}   from "../src/DelegationManager.sol";
//   import {TimestampEnforcer}   from "../src/enforcers/TimestampEnforcer.sol";
//   import {AllowedTargetsEnforcer} from "../src/enforcers/AllowedTargetsEnforcer.sol";
//   import {AllowedMethodsEnforcer} from "../src/enforcers/AllowedMethodsEnforcer.sol";
//   import {ValueEnforcer}       from "../src/enforcers/ValueEnforcer.sol";
//
//   contract Deploy is Script {
//     function run() external {
//       vm.startBroadcast();
//       AgentAccountFactory factory = new AgentAccountFactory(entryPoint);
//       DelegationManager dm        = new DelegationManager();
//       TimestampEnforcer time      = new TimestampEnforcer();
//       AllowedTargetsEnforcer tgt  = new AllowedTargetsEnforcer();
//       AllowedMethodsEnforcer meth = new AllowedMethodsEnforcer();
//       ValueEnforcer val           = new ValueEnforcer();
//       vm.stopBroadcast();
//
//       // Write deployments-<network>.json
//       string memory json = serialize(...);
//       vm.writeFile(string.concat("deployments-", vm.envString("DEPLOY_NETWORK"), ".json"), json);
//     }
//   }

import "forge-std/Script.sol";

contract Deploy is Script {
    function run() external pure {
        // Stub. See TODO above. Next commit vendors contracts + completes this.
        revert("Deploy.s.sol: not yet implemented (waiting on contract vendoring)");
    }
}
