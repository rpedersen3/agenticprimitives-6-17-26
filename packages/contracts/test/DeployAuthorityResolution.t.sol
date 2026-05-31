// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../script/Deploy.s.sol";

/**
 * @title DeployAuthorityResolutionTest
 * @notice R5.4 / CON-DEPLOY-001 closure. Verifies the deploy script's
 *         `_resolveAuthority` helper enforces the three documented
 *         branches:
 *
 *           1. `GOVERNANCE_MULTISIG` env var set → returns that address.
 *           2. env unset + testnet network → returns deployer (with the
 *              warn log; we just check the return value).
 *           3. env unset + production network → reverts with the
 *              "GOVERNANCE_MULTISIG env var REQUIRED" message.
 *
 *         The reverting case is the one that turns the previously-
 *         documented manual hand-off ceremony into a hard precondition
 *         for the broadcast. Single-key compromise of the deployer EOA
 *         can no longer ship a production deploy where the deployer
 *         holds every governance / paymaster / TLD / registry role.
 */
contract DeployAuthorityResolutionTest is Test {
    DeployHarness harness;
    address constant DEPLOYER = address(0xD1);
    address constant MULTISIG_EOA = address(0xC0DE);

    function setUp() public {
        harness = new DeployHarness();
    }

    // ─── 1. Multisig path ───────────────────────────────────────────────

    function test_resolveAuthority_returnsEnvMultisigWhenSetAndContract() public {
        // Deploy a no-op contract to act as the multisig (the helper
        // requires `.code.length > 0`).
        MultisigStub multisig = new MultisigStub();
        vm.setEnv("GOVERNANCE_MULTISIG", vm.toString(address(multisig)));

        assertEq(
            harness.callResolveAuthority(DEPLOYER, "base-mainnet"),
            address(multisig)
        );
    }

    function test_resolveAuthority_rejectsEoaMultisig() public {
        vm.setEnv("GOVERNANCE_MULTISIG", vm.toString(MULTISIG_EOA));

        // EOAs (no code) are rejected so a misconfigured env var can't
        // accidentally point at a single key.
        vm.expectRevert(bytes("Deploy: GOVERNANCE_MULTISIG must be a contract (Smart Agent / Safe / Timelock)."));
        harness.callResolveAuthority(DEPLOYER, "base-mainnet");
    }

    // ─── 2. Testnet fallback path ───────────────────────────────────────

    function test_resolveAuthority_fallbacksToDeployerForAnvil() public {
        // Clear env so the try-catch in _resolveAuthority misses.
        try this.unsetEnv("GOVERNANCE_MULTISIG") {} catch {}

        assertEq(
            harness.callResolveAuthority(DEPLOYER, "anvil"),
            DEPLOYER
        );
    }

    function test_resolveAuthority_fallbacksToDeployerForBaseSepolia() public {
        try this.unsetEnv("GOVERNANCE_MULTISIG") {} catch {}

        assertEq(
            harness.callResolveAuthority(DEPLOYER, "base-sepolia"),
            DEPLOYER
        );
    }

    function test_resolveAuthority_fallbacksToDeployerForSepolia() public {
        try this.unsetEnv("GOVERNANCE_MULTISIG") {} catch {}

        assertEq(
            harness.callResolveAuthority(DEPLOYER, "sepolia"),
            DEPLOYER
        );
    }

    // ─── 3. Production-reverts path ─────────────────────────────────────

    function test_resolveAuthority_revertsForProductionWithoutEnvVar() public {
        try this.unsetEnv("GOVERNANCE_MULTISIG") {} catch {}

        vm.expectRevert();
        harness.callResolveAuthority(DEPLOYER, "base-mainnet");
    }

    function test_resolveAuthority_revertsForUnknownNetworkWithoutEnvVar() public {
        try this.unsetEnv("GOVERNANCE_MULTISIG") {} catch {}

        vm.expectRevert();
        harness.callResolveAuthority(DEPLOYER, "polygon");
    }

    function test_resolveAuthority_revertsForOptimismMainnetWithoutEnvVar() public {
        try this.unsetEnv("GOVERNANCE_MULTISIG") {} catch {}

        vm.expectRevert();
        harness.callResolveAuthority(DEPLOYER, "optimism");
    }

    // ─── BUNDLER_SIGNER + SESSION_ISSUER env paths ──────────────────────

    function test_resolveBundlerSigner_envSetReturnsEnv() public {
        address envAddr = address(0xB5);
        vm.setEnv("BUNDLER_SIGNER", vm.toString(envAddr));
        assertEq(harness.callResolveBundlerSigner(DEPLOYER), envAddr);
    }

    function test_resolveBundlerSigner_envUnsetReturnsAuthority() public {
        try this.unsetEnv("BUNDLER_SIGNER") {} catch {}
        assertEq(harness.callResolveBundlerSigner(DEPLOYER), DEPLOYER);
    }

    function test_resolveSessionIssuer_envSetReturnsEnv() public {
        address envAddr = address(0x5511);
        vm.setEnv("SESSION_ISSUER", vm.toString(envAddr));
        assertEq(harness.callResolveSessionIssuer(DEPLOYER), envAddr);
    }

    function test_resolveSessionIssuer_envUnsetReturnsAuthority() public {
        try this.unsetEnv("SESSION_ISSUER") {} catch {}
        assertEq(harness.callResolveSessionIssuer(DEPLOYER), DEPLOYER);
    }

    // ─── helper: try to clear env vars (vm.setEnv with empty string is
    // the only available mechanism in current Foundry). Wrap in an
    // external function so tests can catch the call without aborting.
    function unsetEnv(string calldata key) external {
        vm.setEnv(key, "");
    }
}

// External wrapper so we can call the script's `internal` helpers from a test.
contract DeployHarness is Deploy {
    function callResolveAuthority(address deployer, string memory network) external returns (address) {
        return _resolveAuthority(deployer, network);
    }
    function callResolveBundlerSigner(address authority) external returns (address) {
        return _resolveBundlerSigner(authority);
    }
    function callResolveSessionIssuer(address authority) external returns (address) {
        return _resolveSessionIssuer(authority);
    }
}

// Minimal contract used as the env-var multisig (helper requires
// `.code.length > 0`).
contract MultisigStub {
    function foo() external pure returns (uint256) { return 42; }
}
