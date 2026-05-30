// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";

// ─── Mocks ───────────────────────────────────────────────────────────

/// @dev Minimal ERC-7579 executor module. Conforms to the
///      `IERC7579ModuleLike` shape AgentAccount.installModule expects.
///      Exposes a `callExecuteFromModule` so the test driver can
///      invoke `executeFromModule` from the module's address (which is
///      what AgentAccount's gate checks against).
contract MockExecutorModule {
    address public lastInstalledOn;
    address public lastUninstalledFrom;
    bytes   public lastInitData;

    function onInstall(bytes calldata data) external {
        lastInstalledOn = msg.sender;
        lastInitData = data;
    }

    function onUninstall(bytes calldata) external {
        lastUninstalledFrom = msg.sender;
    }

    /// @notice Test helper: forward into account.executeFromModule.
    function callExecuteFromModule(
        address account,
        address target,
        uint256 value,
        bytes calldata data
    ) external returns (bytes memory) {
        return AgentAccount(payable(account)).executeFromModule(target, value, data);
    }
}

/// @dev Minimal validator module — same shape, different intended type.
contract MockValidatorModule {
    function onInstall(bytes calldata) external {}
    function onUninstall(bytes calldata) external {}

    function callExecuteFromModule(
        address account,
        address target,
        uint256 value,
        bytes calldata data
    ) external returns (bytes memory) {
        return AgentAccount(payable(account)).executeFromModule(target, value, data);
    }
}

/// @dev External-call target. Has a function that records the caller
///      so the test can verify `msg.sender` at the inner-call boundary.
contract TargetEcho {
    address public lastCaller;
    uint256 public lastValue;
    bytes   public lastData;

    receive() external payable {
        lastCaller = msg.sender;
        lastValue = msg.value;
    }

    function ping(uint256 x) external payable returns (uint256) {
        lastCaller = msg.sender;
        lastValue = msg.value;
        lastData = abi.encode(x);
        return x + 1;
    }

    /// @notice Reverts with a specific custom error so the bubble-revert
    ///         test can assert selector preservation.
    error EchoBoom(uint256 code);
    function boom(uint256 code) external pure {
        revert EchoBoom(code);
    }
}

/// @dev Reentrant executor — attempts to call back into executeFromModule
///      while the first call is still on the stack. The OZ ReentrancyGuard
///      on executeFromModule should block this.
contract ReentrantExecutorMock {
    address public target;

    function onInstall(bytes calldata data) external {
        target = abi.decode(data, (address));
    }
    function onUninstall(bytes calldata) external {}

    function attack(address account) external {
        AgentAccount(payable(account)).executeFromModule(
            address(this),
            0,
            abi.encodeCall(this.callback, (account))
        );
    }

    function callback(address account) external {
        // This should revert via nonReentrant.
        AgentAccount(payable(account)).executeFromModule(target, 0, "");
    }
}

// ─── Test suite ──────────────────────────────────────────────────────

contract ExecuteFromModuleTest is Test {
    function _defaultTimelocks() internal pure returns (uint32[7] memory tl) {}
    AgentAccountFactory factory;
    DelegationManager   dm;
    AgentAccount        acct;

    MockExecutorModule  executor;
    MockValidatorModule validatorOnly;
    TargetEcho          echo;

    uint256 internal constant OWNER_PK = 0xA11CE;
    uint256 internal constant MODULE_TYPE_VALIDATOR = 1;
    uint256 internal constant MODULE_TYPE_EXECUTOR  = 2;
    uint256 internal constant MODULE_TYPE_HOOK      = 4;

    address internal owner;
    address internal newOwner = address(0xC0DE);

    function setUp() public {
        EntryPoint ep = new EntryPoint();
        dm = new DelegationManager();
        owner = vm.addr(OWNER_PK);
        CustodyPolicy cp = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(cp),
            address(0xBB),
            address(0xCC),
            address(0xDD)
        );
        address[] memory _c = new address[](1);
        _c[0] = owner;
        AgentAccountInitParams memory p = AgentAccountInitParams({
            mode: 0,
            custodians: _c,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: bytes32(0),
            initialPasskeyX: 0,
            initialPasskeyY: 0
        });
        acct = factory.createAgentAccount(p, _defaultTimelocks(), 42);

        executor      = new MockExecutorModule();
        validatorOnly = new MockValidatorModule();
        echo          = new TargetEcho();

        // Wave 2A: install is `onlySelfOrFactoryInit`. Custodian can no
        // longer install directly. Simulate the self-call (in production
        // routed via CustodyPolicy.ApplySystemUpdate quorum).
        vm.prank(address(acct));
        acct.installModule(MODULE_TYPE_EXECUTOR, address(executor), hex"");
    }

    // ─── 1. Caller must be an installed executor module ───────────────

    function test_executeFromModule_revertsForUninstalledCaller() public {
        // Random EOA — not installed as any module type.
        address rando = address(0xDEAD);
        vm.expectRevert(
            abi.encodeWithSelector(AgentAccount.NotInstalledExecutor.selector, rando)
        );
        vm.prank(rando);
        acct.executeFromModule(address(echo), 0, abi.encodeCall(echo.ping, (1)));
    }

    function test_executeFromModule_revertsForValidatorOnlyModule() public {
        // Install validatorOnly as VALIDATOR (not EXECUTOR). Even though
        // it's installed, the EXECUTOR-type gate must reject.
        vm.prank(address(acct));
        acct.installModule(MODULE_TYPE_VALIDATOR, address(validatorOnly), hex"");

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentAccount.NotInstalledExecutor.selector,
                address(validatorOnly)
            )
        );
        validatorOnly.callExecuteFromModule(
            address(acct),
            address(echo),
            0,
            abi.encodeCall(echo.ping, (1))
        );
    }

    // ─── 2. Installed executor can call ───────────────────────────────

    function test_executeFromModule_succeedsForInstalledExecutor() public {
        // Verify install actually took effect.
        assertTrue(acct.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(executor), hex""));

        bytes memory ret = executor.callExecuteFromModule(
            address(acct),
            address(echo),
            0,
            abi.encodeCall(echo.ping, (42))
        );
        uint256 result = abi.decode(ret, (uint256));
        assertEq(result, 43);
        // Inner-call boundary: target sees msg.sender == account.
        assertEq(echo.lastCaller(), address(acct));
    }

    // ─── 3. Self-call path satisfies onlySelf ─────────────────────────

    function test_executeFromModule_selfCallTriggersAddOwner_onlySelf() public {
        // addCustodian has the onlySelf gate. When executeFromModule routes
        // back to address(this), msg.sender at the callee == account, so
        // the gate passes.
        assertFalse(acct.isCustodian(newOwner), "pre: newOwner not yet an owner");

        executor.callExecuteFromModule(
            address(acct),
            address(acct),
            0,
            abi.encodeCall(IAgentAccount.addCustodian, (newOwner))
        );

        assertTrue(acct.isCustodian(newOwner), "post: newOwner added");
    }

    function test_executeFromModule_selfCallToOnlySelfFromNonModule_reverts() public {
        // Sanity: calling addCustodian directly from a non-self caller still
        // reverts (the onlySelf gate is intact). Catches a regression
        // where executeFromModule accidentally relaxes the gate.
        vm.expectRevert(AgentAccount.NotFromSelf.selector);
        vm.prank(address(0xBADCAFE));
        acct.addCustodian(newOwner);
    }

    // ─── 4. External-call value forwarding ────────────────────────────

    function test_executeFromModule_forwardsValueToExternalTarget() public {
        // Fund the account so it can forward ETH.
        vm.deal(address(acct), 1 ether);

        executor.callExecuteFromModule(
            address(acct),
            address(echo),
            0.123 ether,
            abi.encodeCall(echo.ping, (7))
        );
        assertEq(echo.lastValue(), 0.123 ether);
        assertEq(address(echo).balance, 0.123 ether);
    }

    // ─── 5. Bubble-revert preserves inner selector ────────────────────

    function test_executeFromModule_bubblesInnerRevertSelector() public {
        // The inner call reverts with EchoBoom(code). executeFromModule
        // must bubble the same selector + data so callers see the same
        // shape as a direct call.
        vm.expectRevert(abi.encodeWithSelector(TargetEcho.EchoBoom.selector, uint256(7)));
        executor.callExecuteFromModule(
            address(acct),
            address(echo),
            0,
            abi.encodeCall(echo.boom, (7))
        );
    }

    // ─── 6. Event emission ────────────────────────────────────────────

    function test_executeFromModule_emitsModuleExecuted() public {
        vm.expectEmit(true, true, false, true, address(acct));
        emit AgentAccount.ModuleExecuted(address(executor), address(echo), 0);

        executor.callExecuteFromModule(
            address(acct),
            address(echo),
            0,
            abi.encodeCall(echo.ping, (1))
        );
    }

    // ─── 7. Reentrancy guard blocks self-reentry ──────────────────────

    function test_executeFromModule_nonReentrantBlocksReentry() public {
        ReentrantExecutorMock attacker = new ReentrantExecutorMock();
        vm.prank(address(acct));
        acct.installModule(MODULE_TYPE_EXECUTOR, address(attacker), abi.encode(address(echo)));

        // The inner executeFromModule call inside `callback` should
        // revert. The outer bubble-revert surfaces ReentrancyGuard's
        // revert string. Foundry captures it as a plain bytes-revert;
        // we expect ANY revert and verify the outer call fails.
        vm.expectRevert();
        attacker.attack(address(acct));
    }

    // ─── 8. Uninstall stops the executor ──────────────────────────────

    function test_executeFromModule_uninstalledExecutorIsRejected() public {
        // Confirm install path is reversible (via self-call only post-Wave-2A).
        vm.prank(address(acct));
        acct.uninstallModule(MODULE_TYPE_EXECUTOR, address(executor), hex"");
        assertFalse(acct.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(executor), hex""));

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentAccount.NotInstalledExecutor.selector,
                address(executor)
            )
        );
        executor.callExecuteFromModule(
            address(acct),
            address(echo),
            0,
            abi.encodeCall(echo.ping, (1))
        );
    }
}
