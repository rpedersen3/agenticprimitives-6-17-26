// Passkey-driven SIWE login flow.
//
// Parallels siwe-flow.ts (the EOA path) but signs via passkey and
// claims the smart account address (not an EOA) as the SIWE
// `address` field.
//
// Steps:
//   1. Derive the smart-account address via factory.getAddressForPasskey.
//   2. Build a SIWE message with that address.
//   3. Have the passkey sign the EIP-191 digest of the message
//      (`navigator.credentials.get` ceremony → WebAuthn assertion →
//      0x01-prefixed wire blob).
//   4. If the smart account is counterfactual (not deployed), wrap
//      the signature in ERC-6492 so the universal validator can
//      deploy it on-chain before verifying.
//   5. POST to /a2a/auth/siwe-verify with `addressIsSmartAccount: true`.
//
// demo-a2a verifies via the on-chain UniversalSignatureValidator —
// never inspects the signature shape (signer-agnostic doctrine).

import { hashMessage, createPublicClient, http, getContract } from 'viem';
import { buildMessage } from '@agenticprimitives/identity-auth/siwe';
import type { Address, Hex } from '@agenticprimitives/types';
import {
  loadPasskey,
  signWithPasskey,
  type DemoPasskey,
} from './passkey-flow';
import { wrap6492ForPasskey } from './erc6492-wrap';

export interface PasskeySiweLoginResponse {
  ok: true;
  smartAccountAddress: Address;
  isDeployed: boolean;
}

export interface PasskeySiweLoginError {
  ok: false;
  error: string;
  reason?: string;
}

interface PasskeySiweInput {
  passkey: DemoPasskey;
  agentAccountFactory: Address;
  rpcUrl: string;
  chainId: number;
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

const factoryAddressAbi = [
  {
    type: 'function',
    name: 'getAddressForPasskey',
    stateMutability: 'view',
    inputs: [
      { name: 'credentialIdDigest', type: 'bytes32' },
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
      { name: 'salt', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

/**
 * Derive the smart-account address for a passkey via factory.getAddressForPasskey.
 * Pure view call — no chain state mutated.
 */
export async function getPasskeySmartAccountAddress(
  input: PasskeySiweInput,
): Promise<Address> {
  const client = createPublicClient({ transport: http(input.rpcUrl) });
  const factory = getContract({
    address: input.agentAccountFactory,
    abi: factoryAddressAbi,
    client,
  });
  return (await factory.read.getAddressForPasskey([
    input.passkey.credentialIdDigest,
    input.passkey.pubKeyX,
    input.passkey.pubKeyY,
    0n,
  ])) as Address;
}

/**
 * Check whether the smart account at `address` is deployed (has code).
 */
async function isAccountDeployed(rpcUrl: string, address: Address): Promise<boolean> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const code = await client.getBytecode({ address });
  return !!code && code !== '0x';
}

export async function signInWithPasskey(
  input: PasskeySiweInput,
): Promise<PasskeySiweLoginResponse | PasskeySiweLoginError> {
  // 1. Smart-account address.
  let smartAccountAddress: Address;
  try {
    smartAccountAddress = await getPasskeySmartAccountAddress(input);
  } catch (e) {
    return {
      ok: false,
      error: 'address-derivation-failed',
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  // 2. Build SIWE message with smartAccount as the address.
  const message = buildMessage({
    domain: window.location.hostname,
    address: smartAccountAddress,
    statement: 'Sign in to the agenticprimitives demo (passkey path).',
    uri: window.location.origin,
    chainId: input.chainId,
    nonce: randomNonce(),
    issuedAt: new Date().toISOString(),
  });

  // 3. Passkey signs the EIP-191 digest of the message.
  const digest = hashMessage(message) as Hex;
  let innerSig: Hex;
  try {
    innerSig = await signWithPasskey(digest);
  } catch (e) {
    return {
      ok: false,
      error: 'passkey-sign-failed',
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  // 4. Counterfactual? If so, wrap in ERC-6492 so the universal
  //    validator can deploy the account during verification.
  const deployed = await isAccountDeployed(input.rpcUrl, smartAccountAddress).catch(
    () => false,
  );
  const signature = deployed
    ? innerSig
    : wrap6492ForPasskey({
        factory: input.agentAccountFactory,
        credentialIdDigest: input.passkey.credentialIdDigest,
        pubKeyX: input.passkey.pubKeyX,
        pubKeyY: input.passkey.pubKeyY,
        salt: 0n,
        innerSig,
      });

  // 5. POST to /auth/siwe-verify with addressIsSmartAccount=true.
  const res = await fetch('/a2a/auth/siwe-verify', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      signature,
      addressIsSmartAccount: true,
      name: input.passkey.label,
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok || body.ok !== true) {
    return {
      ok: false,
      error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}`,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
    };
  }
  return {
    ok: true,
    smartAccountAddress: body.smartAccountAddress as Address,
    isDeployed: Boolean(body.isDeployed),
  };
}

export { loadPasskey };
