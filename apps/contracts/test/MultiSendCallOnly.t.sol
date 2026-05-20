// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/libraries/MultiSendCallOnly.sol";

/// Two trivial target contracts to exercise the batched-call path. `Sink`
/// records who called and what value it received; `explode` reverts on
/// demand so we can assert the index + revert-data forwarding.
contract Sink {
    uint256 public value;
    address public lastCaller;
    function set(uint256 v) external payable { value = v; lastCaller = msg.sender; }
    function explode(string calldata reason) external pure { revert(reason); }
}

contract MultiSendCallOnlyTest is Test {
    MultiSendCallOnlyHarness internal harness;
    Sink internal sinkA;
    Sink internal sinkB;

    function setUp() public {
        harness = new MultiSendCallOnlyHarness();
        sinkA = new Sink();
        sinkB = new Sink();
    }

    function _entry(uint8 op, address to, uint256 value, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(op, to, value, uint256(data.length), data);
    }

    function test_two_call_batch_succeeds() public {
        bytes memory call1 = abi.encodeCall(Sink.set, (42));
        bytes memory call2 = abi.encodeCall(Sink.set, (99));
        bytes memory batch = bytes.concat(
            _entry(0, address(sinkA), 0, call1),
            _entry(0, address(sinkB), 0, call2)
        );
        harness.multiSend(batch);
        assertEq(sinkA.value(), 42);
        assertEq(sinkB.value(), 99);
        // The harness is the immediate caller; in production the
        // library is delegatecalled from an AgentAccount so `msg.sender`
        // for inner calls is the account itself.
        assertEq(sinkA.lastCaller(), address(harness));
    }

    function test_disallows_delegatecall_op() public {
        bytes memory data = abi.encodeCall(Sink.set, (7));
        bytes memory batch = _entry(1, address(sinkA), 0, data); // op=1 forbidden
        vm.expectRevert(abi.encodeWithSelector(MultiSendCallOnly.InvalidOperation.selector, uint8(1)));
        harness.multiSend(batch);
    }

    function test_propagates_inner_revert_atomically() public {
        bytes memory ok = abi.encodeCall(Sink.set, (1));
        bytes memory bad = abi.encodeCall(Sink.explode, ("nope"));
        bytes memory batch = bytes.concat(
            _entry(0, address(sinkA), 0, ok),
            _entry(0, address(sinkB), 0, bad)
        );
        vm.expectRevert();
        harness.multiSend(batch);
        assertEq(sinkA.value(), 0, "first call must roll back when second reverts");
    }

    function test_zero_length_batch_is_noop() public {
        bytes memory empty;
        harness.multiSend(empty);
        // Nothing to assert except that we don't revert and state stays clean.
        assertEq(sinkA.value(), 0);
    }

    function test_forwards_value() public {
        // Fund the harness, then have it forward value into Sink.
        vm.deal(address(harness), 1 ether);
        bytes memory data = abi.encodeCall(Sink.set, (123));
        bytes memory batch = _entry(0, address(sinkA), 0.25 ether, data);
        harness.multiSend(batch);
        assertEq(sinkA.value(), 123);
        assertEq(address(sinkA).balance, 0.25 ether);
    }
}
