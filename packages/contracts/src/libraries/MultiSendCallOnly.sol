// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MultiSendCallOnly
 * @notice Atomic batched-call library, ported from Safe's
 *         `MultiSendCallOnly` shape. Lets an `AgentAccount` execute
 *         multiple inner calls in one userOp without changing
 *         `execute`'s ABI — important for flows like
 *         `approveHash + redeem` (multi-sig pre-approval path) and the
 *         coming Treasury withdraw + emit-event combinations.
 *
 * @dev This is the **call-only** variant. The full Safe `MultiSend`
 *      supports `op = 1` (delegatecall) but we explicitly disallow it
 *      here because delegatecall from a smart account whose authority
 *      is gated by caveats is a footgun — a single malicious target
 *      can nullify every caveat we enforce. If you need
 *      delegatecall semantics inside a quorum-gated flow, build a
 *      dedicated module + caveat rather than reaching for this
 *      library.
 *
 *      Packed format per entry (one slot):
 *        {1 byte op}{20 bytes target}{32 bytes value}{32 bytes dataLen}{dataLen bytes data}
 *      where `op` MUST be 0 (call). Total slot size is `0x55 + dataLen`.
 *
 *      MUST be invoked via `delegatecall` from the caller's
 *      `AgentAccount` so each inner call's `msg.sender` is the account
 *      itself (not this library). This contract is stateless — safe
 *      to deploy once per chain and reuse from any account.
 *
 *      Reverts on the first inner failure with the failing call index
 *      and the inner revert data so callers can decode which sub-call
 *      broke.
 */
library MultiSendCallOnly {
    error InvalidOperation(uint8 op);
    error CallFailed(uint256 index, bytes returnData);

    /**
     * @notice Iterate the packed batch and invoke each call.
     */
    function multiSend(bytes memory transactions) internal {
        uint256 i;
        uint256 n = transactions.length;
        uint256 callIndex;
        while (i < n) {
            uint8 operation;
            address to;
            uint256 value;
            uint256 dataLength;
            bytes memory data;

            assembly {
                let pos := add(transactions, add(0x20, i))
                operation := shr(248, mload(pos))            // 1 byte
                to := shr(96, mload(add(pos, 0x01)))          // 20 bytes
                value := mload(add(pos, 0x15))                // 32 bytes
                dataLength := mload(add(pos, 0x35))           // 32 bytes
            }

            if (operation != 0) revert InvalidOperation(operation);

            // Slice the data segment into a fresh `bytes`.
            data = new bytes(dataLength);
            assembly {
                let pos := add(transactions, add(0x20, i))
                let dataStart := add(pos, 0x55)
                let dst := add(data, 0x20)
                for { let j := 0 } lt(j, dataLength) { j := add(j, 0x20) } {
                    mstore(add(dst, j), mload(add(dataStart, j)))
                }
            }

            (bool success, bytes memory ret) = to.call{ value: value }(data);
            if (!success) revert CallFailed(callIndex, ret);

            // Advance: 1 + 20 + 32 + 32 + dataLength
            i += 0x55 + dataLength;
            callIndex += 1;
        }
    }
}

/**
 * @title MultiSendCallOnlyHarness
 * @notice Test-only wrapper that exposes `multiSend` as an external
 *         entry point so Foundry can invoke it directly. Production
 *         usage `delegatecall`s the library from an `AgentAccount`.
 */
contract MultiSendCallOnlyHarness {
    function multiSend(bytes calldata transactions) external payable {
        bytes memory copy = transactions;
        MultiSendCallOnly.multiSend(copy);
    }
}
