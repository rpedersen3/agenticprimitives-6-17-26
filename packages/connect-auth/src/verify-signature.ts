/**
 * Universal signature verification for app servers.
 *
 * Consumers (e.g. demo-a2a's `/auth/siwe-verify`) call `verifyUserSignature`
 * with `{ signer, hash, signature, universalValidator, publicClient }` and
 * get back a single boolean — they do NOT branch on signer method (EOA,
 * passkey, etc.). The on-chain `UniversalSignatureValidator` contract
 * dispatches: ECDSA for code-less signers, ERC-1271 for deployed smart
 * accounts, ERC-6492 for counterfactual smart accounts (deploys via
 * factoryCalldata embedded in the signature, then ERC-1271).
 *
 * Doctrine — see [[feedback-demo-a2a-is-signer-agnostic]] memory and
 * spec 130 §7: connect-auth ships the verifier helper; demo-a2a calls
 * it; passkey internals stay out of demo-a2a entirely.
 *
 * Two modes:
 *   - `verifyUserSignature` (state-changing): calls `isValidSig` on the
 *     validator. The 6492 path may DEPLOY the user's smart account
 *     before verifying. Suitable for relayer pre-flight where the
 *     submitter is OK paying for deploy gas if verification succeeds.
 *   - `verifyUserSignatureView` (read-only): calls `isValidSigView`. 6492
 *     wrappers without already-deployed accounts will return false.
 *     Suitable for cheap pre-checks.
 *
 * The function signature intentionally takes the validator address as a
 * parameter — connect-auth is transport- and deployment-agnostic; the
 * caller wires in the deployed contract address from its config.
 */

import type { Address, Hex } from './types';

/** ERC-1271 magic value. */
export const ERC1271_MAGIC: Hex = '0x1626ba7e';

/** ERC-6492 32-byte magic suffix (`0x6492…6492` repeated). */
export const ERC6492_MAGIC: Hex =
  '0x6492649264926492649264926492649264926492649264926492649264926492';

/**
 * Minimal viem-like public-client shape — accepts any client with
 * `readContract` (view-only) and `simulateContract` (state-changing
 * dry-run) supporting the universal-validator ABI. Kept loose so this
 * works with viem, ethers-via-shim, or test mocks.
 */
export interface UniversalValidatorClient {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: 'isValidSigView';
    args: readonly [Address, Hex, Hex];
  }): Promise<boolean>;
  simulateContract?(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: 'isValidSig';
    args: readonly [Address, Hex, Hex];
  }): Promise<{ result: boolean }>;
}

export const universalSignatureValidatorAbi = [
  {
    type: 'function',
    name: 'isValidSig',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'signer', type: 'address' },
      { name: 'hash', type: 'bytes32' },
      { name: 'sig', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'isValidSigView',
    stateMutability: 'view',
    inputs: [
      { name: 'signer', type: 'address' },
      { name: 'hash', type: 'bytes32' },
      { name: 'sig', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export interface VerifyUserSignatureArgs {
  /** The on-chain UniversalSignatureValidator contract address. */
  universalValidator: Address;
  /** The claimed signer — for passkey-owned accounts, this is the
   *  smart-account address derived from the passkey's pubkey. */
  signer: Address;
  /** The 32-byte digest the user signed. */
  hash: Hex;
  /** The signature blob — EOA 65-byte sig, ERC-1271 1271-compliant blob,
   *  or ERC-6492-wrapped counterfactual blob. */
  signature: Hex;
  client: UniversalValidatorClient;
}

/**
 * Read-only verification. Counterfactual signatures (6492-wrapped) for
 * not-yet-deployed accounts will return false here — use
 * `verifyUserSignature` (which performs the 6492 deploy via
 * `simulateContract`) instead.
 */
export async function verifyUserSignatureView(
  args: VerifyUserSignatureArgs,
): Promise<boolean> {
  try {
    return await args.client.readContract({
      address: args.universalValidator,
      abi: universalSignatureValidatorAbi,
      functionName: 'isValidSigView',
      args: [args.signer, args.hash, args.signature],
    });
  } catch {
    return false;
  }
}

/**
 * State-tolerant verification. Uses `simulateContract` (eth_call) against
 * the `isValidSig` entry, which will counterfactually deploy the account
 * in the simulated state if the signature is a 6492 wrapper for a
 * not-yet-deployed signer. The on-chain state is NOT mutated (it's a
 * simulation), so this is safe to call from read-only HTTP handlers.
 *
 * Falls back to the view path if the client doesn't expose
 * `simulateContract`.
 */
export async function verifyUserSignature(
  args: VerifyUserSignatureArgs,
): Promise<boolean> {
  if (!args.client.simulateContract) {
    return verifyUserSignatureView(args);
  }
  try {
    const { result } = await args.client.simulateContract({
      address: args.universalValidator,
      abi: universalSignatureValidatorAbi,
      functionName: 'isValidSig',
      args: [args.signer, args.hash, args.signature],
    });
    return result;
  } catch {
    return false;
  }
}

/**
 * Check whether a signature blob is ERC-6492-wrapped (last 32 bytes are
 * the magic suffix). Useful for callers that want to log "user signed
 * counterfactually" without inspecting deeper.
 */
export function isErc6492Wrapped(signature: Hex): boolean {
  if (signature.length < 2 + 64) return false; // '0x' + 32 bytes hex
  return (
    signature.slice(-64).toLowerCase() ===
    ERC6492_MAGIC.slice(2).toLowerCase()
  );
}
