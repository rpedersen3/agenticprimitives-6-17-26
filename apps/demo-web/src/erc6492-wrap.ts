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

/** ERC-6492 32-byte magic suffix. */
export const ERC6492_MAGIC: Hex =
  '0x6492649264926492649264926492649264926492649264926492649264926492';

/**
 * Wrap an inner signature with the ERC-6492 envelope for the EOA
 * factory path (`createAccount(owner, salt)`).
 */
export function wrap6492ForEoa(args: {
  factory: Address;
  owner: Address;
  salt: bigint;
  innerSig: Hex;
}): Hex {
  const factoryCalldata = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'createAccount',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'owner', type: 'address' },
          { name: 'salt', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'address' }],
      },
    ] as const,
    functionName: 'createAccount',
    args: [args.owner, args.salt],
  });
  return wrap6492({
    factory: args.factory,
    factoryCalldata,
    innerSig: args.innerSig,
  });
}

/**
 * Wrap an inner signature with the ERC-6492 envelope for the passkey
 * factory path (`createAccountWithPasskey(credentialIdDigest, x, y, salt)`).
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
    abi: [
      {
        type: 'function',
        name: 'createAccountWithPasskey',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'credentialIdDigest', type: 'bytes32' },
          { name: 'x', type: 'uint256' },
          { name: 'y', type: 'uint256' },
          { name: 'salt', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'address' }],
      },
    ] as const,
    functionName: 'createAccountWithPasskey',
    args: [args.credentialIdDigest, args.pubKeyX, args.pubKeyY, args.salt],
  });
  return wrap6492({
    factory: args.factory,
    factoryCalldata,
    innerSig: args.innerSig,
  });
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
