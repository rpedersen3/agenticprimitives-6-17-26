// ERC-6492 counterfactual signature wrapping.
//
// When a smart account isn't deployed yet but the user needs to sign
// something the server will verify via ERC-1271, the signature is
// wrapped per ERC-6492:
//
//   wrapped = abi.encode(factory, factoryCalldata, innerSig) || 0x6492…6492
//
// On the server side, our `UniversalSignatureValidator.isValidSig`
// detects the magic suffix, deploys the smart account via
// `factory.call(factoryCalldata)`, then verifies `innerSig` via
// ERC-1271 against the (now-deployed) account.
//
// Doctrine: demo-a2a never inspects the wrapped sig — passes it
// straight to the universal validator. See feedback memory
// `feedback-demo-a2a-is-signer-agnostic`.

import { encodeAbiParameters, encodeFunctionData, concat } from 'viem';
import type { Address, Hex } from '@agenticprimitives/types';

const CREATE_PERSON_AGENT_ABI = [
  {
    type: 'function',
    name: 'createPersonAgent',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'externalCustodians', type: 'address[]' },
      { name: 'passkeyCredentialIdDigest', type: 'bytes32' },
      { name: 'passkeyX', type: 'uint256' },
      { name: 'passkeyY', type: 'uint256' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const ZERO_BYTES32: Hex = `0x${'00'.repeat(32)}`;

/** ERC-6492 32-byte magic suffix. */
export const ERC6492_MAGIC: Hex =
  '0x6492649264926492649264926492649264926492649264926492649264926492';

/**
 * Wrap an inner signature with the ERC-6492 envelope for an EOA / SIWE /
 * third-party-smart-wallet Person.PSA factory path. The init binds the
 * external custodian into the CREATE2 address, so the wrapper recreates
 * the same calldata the actual deploy will use.
 */
export function wrap6492ForExternal(args: {
  factory: Address;
  externalCustodian: Address;
  salt: bigint;
  innerSig: Hex;
}): Hex {
  const factoryCalldata = encodeFunctionData({
    abi: CREATE_PERSON_AGENT_ABI,
    functionName: 'createPersonAgent',
    args: [[args.externalCustodian], ZERO_BYTES32, 0n, 0n, args.salt],
  });
  return wrap6492({ factory: args.factory, factoryCalldata, innerSig: args.innerSig });
}

/**
 * Wrap an inner signature with the ERC-6492 envelope for a passkey-only
 * Person.PSA factory path.
 */
export function wrap6492ForPasskey(args: {
  factory: Address;
  credentialIdDigest: Hex;
  pubKeyX: bigint;
  pubKeyY: bigint;
  salt: bigint;
  innerSig: Hex;
}): Hex {
  const factoryCalldata = encodeFunctionData({
    abi: CREATE_PERSON_AGENT_ABI,
    functionName: 'createPersonAgent',
    args: [[], args.credentialIdDigest, args.pubKeyX, args.pubKeyY, args.salt],
  });
  return wrap6492({ factory: args.factory, factoryCalldata, innerSig: args.innerSig });
}

/**
 * Low-level wrapper: encode any (factory, calldata, innerSig) tuple
 * as an ERC-6492 signature.
 */
export function wrap6492(args: {
  factory: Address;
  factoryCalldata: Hex;
  innerSig: Hex;
}): Hex {
  const prefix = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'bytes' },
      { type: 'bytes' },
    ],
    [args.factory, args.factoryCalldata, args.innerSig],
  );
  return concat([prefix, ERC6492_MAGIC]);
}
