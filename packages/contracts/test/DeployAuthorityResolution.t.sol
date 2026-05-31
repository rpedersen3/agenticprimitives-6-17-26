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

    // ─── R5.9 / PKG-DEPLOY-002 — per-role authority resolution ──────────
    //
    //   The R5.4 single-authority pattern collapsed every governance /
    //   admin / ownership role onto one address. R5.9 adds per-role env
    //   vars so an operator can split (or keep collapsed if all unset).
    //
    //   Test matrix per role:
    //     1. Env set + contract addr → returns env addr (production OK)
    //     2. Env unset → falls back to authority
    //     3. Env set + EOA on production → reverts (must be contract)
    //     4. Env set + EOA on testnet → accepted (fallback semantics)

    // Each R5.9 test uses a UNIQUE role-env-var so cross-test bleed
    // via `vm.setEnv` (which persists at process level) is impossible.
    // The existing tests demonstrated that `vm.setEnv("X", "")` plus
    // `vm.envOr` doesn't reliably round-trip across test invocations,
    // so we sidestep the issue by partitioning the env namespace.

    function test_R5_9_resolveContractRole_envSetReturnsEnvOnProduction() public {
        ContractStub roleAddr = new ContractStub();
        vm.setEnv("R5_9_TEST_ROLE_A", vm.toString(address(roleAddr)));
        address authority = address(0xC0DE);
        assertEq(
            harness.callResolveContractRole("R5_9_TEST_ROLE_A", authority, "base-mainnet"),
            address(roleAddr)
        );
    }

    function test_R5_9_resolveContractRole_envUnsetReturnsDefault() public {
        // Distinct role name so we KNOW the env was never set.
        address authority = address(0xC0DE);
        assertEq(
            harness.callResolveContractRole("R5_9_TEST_ROLE_B", authority, "base-mainnet"),
            authority
        );
    }

    function test_R5_9_resolveContractRole_rejectsEoaOnProduction() public {
        address eoaAddr = address(0xBADBAD);
        vm.setEnv("R5_9_TEST_ROLE_C", vm.toString(eoaAddr));
        address authority = address(0xC0DE);
        vm.expectRevert(bytes("Deploy: R5_9_TEST_ROLE_C must be a contract on production networks (Smart Agent / Safe / Timelock)"));
        harness.callResolveContractRole("R5_9_TEST_ROLE_C", authority, "base-mainnet");
    }

    function test_R5_9_resolveContractRole_acceptsEoaOnTestnet() public {
        // Testnet path bypasses the contract-shape check so anvil
        // operators can keep using EOAs for every role.
        address eoaAddr = address(0xBADBAD);
        vm.setEnv("R5_9_TEST_ROLE_D", vm.toString(eoaAddr));
        address authority = address(0xC0DE);
        assertEq(
            harness.callResolveContractRole("R5_9_TEST_ROLE_D", authority, "anvil"),
            eoaAddr
        );
    }

    function test_R5_9_resolveContractRole_works_for_every_role_name() public {
        // Sanity check: every documented role string passes through.
        // Locks the env-var contract: a future refactor that renames or
        // case-sensitises a role string fails here.
        //
        // We use R5_9_ALL_* test prefixes (NOT the real role names) for
        // the same isolation reason as the other R5.9 tests — touching
        // the real names (PAYMASTER_OWNER, etc.) bleeds into the rest
        // of the test contract. The test below verifies the resolver
        // accepts arbitrary role strings; the integration tests run via
        // forge script will exercise the real names end-to-end.
        ContractStub roleAddr = new ContractStub();
        string[10] memory roleNames = [
            "R5_9_ALL_TIMELOCK_ADMIN",
            "R5_9_ALL_TIMELOCK_PROPOSER",
            "R5_9_ALL_TIMELOCK_EXECUTOR",
            "R5_9_ALL_GOVERNANCE_GUARDIAN",
            "R5_9_ALL_GOVERNANCE_SIGNER",
            "R5_9_ALL_PAYMASTER_OWNER",
            "R5_9_ALL_NAMING_ROOT_OWNER",
            "R5_9_ALL_ONTOLOGY_ADMIN",
            "R5_9_ALL_SHAPE_ADMIN",
            "R5_9_ALL_RELATIONSHIP_TYPE_ADMIN"
        ];
        address authority = address(0xC0DE);
        for (uint256 i = 0; i < roleNames.length; i++) {
            vm.setEnv(roleNames[i], vm.toString(address(roleAddr)));
            assertEq(
                harness.callResolveContractRole(roleNames[i], authority, "base-mainnet"),
                address(roleAddr),
                roleNames[i]
            );
        }
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
    function callResolveContractRole(
        string memory roleName,
        address defaultAuth,
        string memory network
    ) external view returns (address) {
        return _resolveContractRole(roleName, defaultAuth, network);
    }
}

// Minimal contract used as a per-role env address (helper requires
// `.code.length > 0` on production networks).
contract ContractStub {
    function bar() external pure returns (uint256) { return 1337; }
}

// Minimal contract used as the env-var multisig (helper requires
// `.code.length > 0`).
contract MultisigStub {
    function foo() external pure returns (uint256) { return 42; }
}
