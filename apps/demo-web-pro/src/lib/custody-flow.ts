/**
 * Custody-flow helpers — compose schedule / apply call data for the
 * CustodyPolicy contract.
 *
 * The flow for any custody change is:
 *   1. Read scheduledChangeCount(account) → N. Next changeId = N + 1.
 *   2. Compute EIP-712 hash of ScheduleCustodyChangeRequest.
 *   3. Each custodian\'s Person Smart Agent signs the hash via passkey
 *      (WebAuthn assertion → 0x01-prefixed sig blob).
 *   4. Pack quorum sigs (v=0 ERC-1271 slots).
 *   5. Call CustodyPolicy.scheduleCustodyChange(account, action, args,
 *      quorumSigs) — typically dispatched via someone\'s PSA.execute(...).
 *
 *   6. Wait safetyDelay (configurable per-tier).
 *   7. Read the scheduled change\'s eta from getScheduledChange(account, id).
 *   8. Compute EIP-712 hash of ApplyCustodyChangeRequest (includes eta).
 *   9. Same signing + packing dance.
 *  10. Call CustodyPolicy.applyCustodyChange(account, changeId, quorumSigs).
 */

import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  type Address,
  type Hex,
} from 'viem';
import {
  CustodyAction,
  custodyPolicyAbi,
  custodyDomain,
  type ApplyCustodyChangeMessage,
  type ScheduleCustodyChangeMessage,
} from '@agenticprimitives/custody';

// EIP-712 typehashes — must hash to the exact same bytes the contract uses.
const EIP712_DOMAIN_TYPEHASH = keccak256(
  new TextEncoder().encode(
    'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
  ),
);
const SCHEDULE_TYPEHASH = keccak256(
  new TextEncoder().encode(
    'ScheduleCustodyChangeRequest(address account,uint8 action,bytes32 argsHash,uint256 changeId)',
  ),
);
const APPLY_TYPEHASH = keccak256(
  new TextEncoder().encode(
    'ApplyCustodyChangeRequest(address account,uint8 action,bytes32 argsHash,uint256 changeId,uint64 eta)',
  ),
);

function eip712Hash(domainSeparator: Hex, structHash: Hex): Hex {
  // keccak256(abi.encodePacked(bytes2(0x1901), domainSep, structHash))
  return keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}` as Hex);
}

export function computeDomainSeparator(args: {
  custodyPolicy: Address;
  chainId: number;
}): Hex {
  const nameHash = keccak256(new TextEncoder().encode('agenticprimitives.CustodyPolicy'));
  const versionHash = keccak256(new TextEncoder().encode('1'));
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'address' },
      ],
      [EIP712_DOMAIN_TYPEHASH, nameHash, versionHash, BigInt(args.chainId), args.custodyPolicy],
    ),
  );
}

export function hashScheduleCustodyChange(args: {
  domainSeparator: Hex;
  message: ScheduleCustodyChangeMessage;
}): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'uint8' },
        { type: 'bytes32' },
        { type: 'uint256' },
      ],
      [
        SCHEDULE_TYPEHASH,
        args.message.account,
        args.message.action,
        args.message.argsHash,
        args.message.changeId,
      ],
    ),
  );
  return eip712Hash(args.domainSeparator, structHash);
}

export function hashApplyCustodyChange(args: {
  domainSeparator: Hex;
  message: ApplyCustodyChangeMessage;
}): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'uint8' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'uint64' },
      ],
      [
        APPLY_TYPEHASH,
        args.message.account,
        args.message.action,
        args.message.argsHash,
        args.message.changeId,
        args.message.eta,
      ],
    ),
  );
  return eip712Hash(args.domainSeparator, structHash);
}

/** Encode the callData for CustodyPolicy.scheduleCustodyChange(...). */
export function encodeScheduleCall(args: {
  account: Address;
  action: CustodyAction;
  innerArgs: Hex;
  quorumSigs: Hex;
}): Hex {
  return encodeFunctionData({
    abi: custodyPolicyAbi,
    functionName: 'scheduleCustodyChange',
    args: [args.account, args.action, args.innerArgs, args.quorumSigs],
  });
}

/** Encode the callData for CustodyPolicy.applyCustodyChange(...). */
export function encodeApplyCall(args: {
  account: Address;
  changeId: bigint;
  quorumSigs: Hex;
}): Hex {
  return encodeFunctionData({
    abi: custodyPolicyAbi,
    functionName: 'applyCustodyChange',
    args: [args.account, args.changeId, args.quorumSigs],
  });
}
