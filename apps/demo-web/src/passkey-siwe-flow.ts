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

import { hashMessage } from 'viem';
import { buildMessage } from '@agenticprimitives/connect-auth/siwe';
import type { Address, Hex } from '@agenticprimitives/types';
import {
  loadPasskey,
  signWithPasskey,
  type DemoPasskey,
} from './passkey-flow';
import { wrap6492ForPasskey } from './erc6492-wrap';
import { csrfHeaders } from './csrf';

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
  chainId: number;
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Derive the smart-account address for a passkey via demo-a2a's
 * `/account/derive-address` endpoint. The Worker does the
 * factory.getAddressForPasskey view call server-side using its
 * configured RPC — so the browser stays RPC-agnostic and any API key
 * embedded in the RPC URL never reaches the client.
 */
export async function getPasskeySmartAccountAddress(
  input: PasskeySiweInput,
): Promise<Address> {
  const res = await fetch('/a2a/account/derive-address', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({
      initMethod: 'passkey',
      credentialIdDigest: input.passkey.credentialIdDigest,
      pubKeyX: input.passkey.pubKeyX.toString(),
      pubKeyY: input.passkey.pubKeyY.toString(),
      salt: '0',
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok || body.ok !== true) {
    throw new Error(
      typeof body.error === 'string' ? `${body.error}: ${body.detail ?? ''}` : `HTTP ${res.status}`,
    );
  }
  return body.smartAccountAddress as Address;
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

  // 4. Always wrap in ERC-6492. The universal validator strips the
  //    wrapper for already-deployed accounts (then plain ERC-1271)
  //    and counterfactually deploys for undeployed ones. Wrapping
  //    unconditionally avoids a "is account deployed?" RPC call from
  //    the browser — the validator handles both cases on-chain.
  const signature = wrap6492ForPasskey({
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
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
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
