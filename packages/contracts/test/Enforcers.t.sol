// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/enforcers/TimestampEnforcer.sol";
import "../src/enforcers/ValueEnforcer.sol";
import "../src/enforcers/AllowedTargetsEnforcer.sol";
import "../src/enforcers/AllowedMethodsEnforcer.sol";

contract TimestampEnforcerTest is Test {
    TimestampEnforcer enf;

    function setUp() public {
        enf = new TimestampEnforcer();
    }

    function _call(uint256 validAfter, uint256 validUntil) internal view {
        bytes memory terms = abi.encode(validAfter, validUntil);
        enf.beforeHook(terms, "", bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_accepts_when_within_window() public {
        vm.warp(1_000);
        _call(500, 1500);
    }

    function test_reverts_when_before_window() public {
        vm.warp(1_000);
        vm.expectRevert(TimestampEnforcer.TimestampNotYetValid.selector);
        _call(2000, 3000);
    }

    function test_reverts_when_after_window() public {
        vm.warp(5_000);
        vm.expectRevert(TimestampEnforcer.TimestampExpired.selector);
        _call(1000, 2000);
    }

    function test_accepts_exact_boundaries() public {
        vm.warp(1500);
        _call(1500, 1500);
    }

    function test_afterHook_is_noop() public view {
        enf.afterHook("", "", bytes32(0), address(0), address(0), address(0), 0, "");
    }
}

contract ValueEnforcerTest is Test {
    ValueEnforcer enf;

    function setUp() public {
        enf = new ValueEnforcer();
    }

    function _call(uint256 maxValue, uint256 actualValue) internal view {
        bytes memory terms = abi.encode(maxValue);
        enf.beforeHook(terms, "", bytes32(0), address(0), address(0), address(0), actualValue, "");
    }

    function test_accepts_at_limit() public view {
        _call(1 ether, 1 ether);
    }

    function test_accepts_below_limit() public view {
        _call(1 ether, 0.5 ether);
    }

    function test_accepts_zero_value() public view {
        _call(1 ether, 0);
    }

    function test_reverts_above_limit() public {
        vm.expectRevert(ValueEnforcer.ValueExceedsLimit.selector);
        _call(1 ether, 1 ether + 1);
    }

    function test_zero_max_means_no_eth() public {
        _call(0, 0); // ok
        vm.expectRevert(ValueEnforcer.ValueExceedsLimit.selector);
        _call(0, 1);
    }
}

contract AllowedTargetsEnforcerTest is Test {
    AllowedTargetsEnforcer enf;
    address constant T1 = address(0xAAAA);
    address constant T2 = address(0xBBBB);
    address constant T3 = address(0xCCCC);

    function setUp() public {
        enf = new AllowedTargetsEnforcer();
    }

    function _call(address[] memory allowed, address target) internal view {
        bytes memory terms = abi.encode(allowed);
        enf.beforeHook(terms, "", bytes32(0), address(0), address(0), target, 0, "");
    }

    function test_accepts_target_in_list() public view {
        address[] memory list = new address[](2);
        list[0] = T1;
        list[1] = T2;
        _call(list, T1);
        _call(list, T2);
    }

    function test_reverts_target_not_in_list() public {
        address[] memory list = new address[](2);
        list[0] = T1;
        list[1] = T2;
        vm.expectRevert(AllowedTargetsEnforcer.TargetNotAllowed.selector);
        _call(list, T3);
    }

    function test_empty_list_blocks_all() public {
        address[] memory empty = new address[](0);
        vm.expectRevert(AllowedTargetsEnforcer.TargetNotAllowed.selector);
        _call(empty, T1);
    }

    function test_single_target_exact_match() public view {
        address[] memory one = new address[](1);
        one[0] = T1;
        _call(one, T1);
    }
}

contract AllowedMethodsEnforcerTest is Test {
    AllowedMethodsEnforcer enf;
    bytes4 constant SEL_TRANSFER = bytes4(keccak256("transfer(address,uint256)"));
    bytes4 constant SEL_APPROVE = bytes4(keccak256("approve(address,uint256)"));
    bytes4 constant SEL_BURN = bytes4(keccak256("burn(uint256)"));

    function setUp() public {
        enf = new AllowedMethodsEnforcer();
    }

    function _call(bytes4[] memory allowed, bytes memory callData) internal view {
        bytes memory terms = abi.encode(allowed);
        enf.beforeHook(terms, "", bytes32(0), address(0), address(0), address(0), 0, callData);
    }

    function test_accepts_allowed_selector() public view {
        bytes4[] memory list = new bytes4[](2);
        list[0] = SEL_TRANSFER;
        list[1] = SEL_APPROVE;
        _call(list, abi.encodeWithSelector(SEL_TRANSFER, address(0x1), 100));
        _call(list, abi.encodeWithSelector(SEL_APPROVE, address(0x1), 100));
    }

    function test_reverts_disallowed_selector() public {
        bytes4[] memory list = new bytes4[](1);
        list[0] = SEL_TRANSFER;
        vm.expectRevert(AllowedMethodsEnforcer.MethodNotAllowed.selector);
        _call(list, abi.encodeWithSelector(SEL_BURN, 100));
    }

    function test_reverts_calldata_too_short() public {
        bytes4[] memory list = new bytes4[](1);
        list[0] = SEL_TRANSFER;
        vm.expectRevert(AllowedMethodsEnforcer.CalldataTooShort.selector);
        _call(list, hex"112233"); // 3 bytes, no selector
    }

    function test_extracts_selector_from_full_calldata() public view {
        bytes4[] memory list = new bytes4[](1);
        list[0] = SEL_TRANSFER;
        // a full transfer call with selector + 2 args
        bytes memory full = abi.encodeWithSelector(SEL_TRANSFER, address(0xdead), 12345);
        _call(list, full);
    }

    function test_empty_allowlist_blocks_all() public {
        bytes4[] memory empty = new bytes4[](0);
        vm.expectRevert(AllowedMethodsEnforcer.MethodNotAllowed.selector);
        _call(empty, abi.encodeWithSelector(SEL_TRANSFER, address(0x1), 100));
    }
}
