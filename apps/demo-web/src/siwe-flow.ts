// SIWE login flow for the demo web app. Composes:
//   - @agenticprimitives/connect-auth/siwe.buildMessage
//   - SessionWallet.signMessage (mnemonic test wallet or external connected wallet)
//   - POST to /a2a/auth/siwe-verify
// On success: smart account address is rendered.

import { buildMessage } from '@agenticprimitives/connect-auth/siwe';
import type { Address, Hex } from '@agenticprimitives/types';
import type { SessionWallet } from './session-wallet';
import { csrfHeaders } from './csrf';

export interface SiweLoginResponse {
  ok: true;
  walletAddress: Address;
  smartAccountAddress: Address;
  isDeployed: boolean;
}

export interface SiweLoginError {
  ok: false;
  error: string;
  reason?: string;
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export async function signInWithSiwe(
  wallet: SessionWallet,
  chainId: number,
): Promise<SiweLoginResponse | SiweLoginError> {
  const message = buildMessage({
    domain: window.location.hostname,
    address: wallet.address,
    statement: 'Sign in to the agenticprimitives demo.',
    uri: window.location.origin,
    chainId,
    nonce: randomNonce(),
    issuedAt: new Date().toISOString(),
  });

  let signature: Hex;
  try {
    signature = await wallet.signMessage({ message });
  } catch (e) {
    return { ok: false, error: 'sign failed', reason: e instanceof Error ? e.message : String(e) };
  }

  const res = await fetch('/a2a/auth/siwe-verify', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ message, signature }),
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
    walletAddress: body.walletAddress as Address,
    smartAccountAddress: body.smartAccountAddress as Address,
    isDeployed: Boolean(body.isDeployed),
  };
}
