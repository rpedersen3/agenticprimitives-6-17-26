// Browser orchestration for the real wallet (SIWE) connect → resolve → bootstrap
// → PII, all against the live broker + the deployed demo-a2a worker (via /a2a).
import { buildMessage } from '@agenticprimitives/connect-auth/siwe';
import type { Address, Hex } from '@agenticprimitives/types';
import { connectWallet, personalSign } from './lib/wallet';
import { ensureCsrfToken, csrfHeaders } from './csrf';

export const AUD = 'demo-sso';
const CHAIN_ID = 84532;

export type SiweOutcome =
  | { status: 'issued'; token: string; address: Address }
  | { status: 'bootstrap'; address: Address }
  | { status: 'disambiguate' | 'rejected'; address?: Address; reason?: string };

async function getNonce(): Promise<string> {
  const r = await fetch('/connect/nonce');
  if (!r.ok) throw new Error('nonce fetch failed');
  return ((await r.json()) as { nonce: string }).nonce;
}

/** Connect a wallet, sign SIWE, resolve to an AgentSession (or signal bootstrap). */
export async function siweLogin(): Promise<SiweOutcome> {
  const address = await connectWallet();
  const nonce = await getNonce();
  const message = buildMessage({
    domain: window.location.host,
    address,
    uri: window.location.origin,
    chainId: CHAIN_ID,
    nonce,
    statement: 'Sign in to Agentic Connect — proving you control this wallet.',
  });
  const signature = await personalSign(address, message);
  const r = await fetch('/connect/siwe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, signature, aud: AUD }),
  });
  const body = (await r.json()) as { status: string; token?: string; address?: string; reason?: string };
  if (body.status === 'issued' && body.token) return { status: 'issued', token: body.token, address };
  if (body.status === 'bootstrap') return { status: 'bootstrap', address };
  return { status: (body.status as 'disambiguate' | 'rejected') ?? 'rejected', address, reason: body.reason };
}

/** Bootstrap: deploy a person SA (EOA custodian) via demo-a2a, then enroll the facet. */
export async function bootstrapWithWallet(
  address: Address,
  onStep?: (s: string) => void,
): Promise<{ ok: true; agent: Address } | { ok: false; error: string }> {
  await ensureCsrfToken();
  onStep?.('Preparing your workspace…');
  const buildRes = await fetch('/a2a/session/deploy', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ initMethod: 'eoa', owner: address }),
  });
  if (buildRes.status === 409) {
    return { ok: false, error: 'Gas sponsorship is not enabled on the backend (paymaster).' };
  }
  const built = (await buildRes.json()) as {
    ok?: boolean;
    sender?: Address;
    userOpHash?: Hex;
    userOp?: Record<string, unknown>;
    error?: string;
  };
  if (!buildRes.ok || !built.ok || !built.userOpHash || !built.userOp) {
    return { ok: false, error: built.error ?? `deploy build failed (HTTP ${buildRes.status})` };
  }
  onStep?.('Confirm in your wallet…');
  const signature = await personalSign(address, built.userOpHash);
  onStep?.('Securing on the network…');
  const submitRes = await fetch('/a2a/session/deploy/submit', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ userOp: { ...built.userOp, signature } }),
  });
  const submitted = (await submitRes.json()) as { ok?: boolean; deployedAddress?: Address; error?: string };
  if (!submitRes.ok || !submitted.ok || !submitted.deployedAddress) {
    return { ok: false, error: submitted.error ?? `deploy submit failed (HTTP ${submitRes.status})` };
  }
  const agent = submitted.deployedAddress;
  onStep?.('Linking your wallet…');
  const enrollRes = await fetch('/connect/enroll', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'siwe-eoa', id: address, agent }),
  });
  if (!enrollRes.ok) {
    return { ok: false, error: ((await enrollRes.json()) as { error?: string }).error ?? 'enroll failed' };
  }
  return { ok: true, agent };
}

export interface BasicProfile {
  agent: string;
  name: string | null;
  credential: string;
  access: string;
}

export async function fetchProfile(token: string): Promise<BasicProfile | null> {
  const r = await fetch('/me/profile', { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return ((await r.json()) as { profile: BasicProfile }).profile;
}

export async function fetchSensitive(
  token: string,
): Promise<{ ok: true; email: string; phone: string } | { ok: false; reason: string }> {
  const r = await fetch('/me/sensitive', { headers: { authorization: `Bearer ${token}` } });
  const body = (await r.json()) as Record<string, unknown>;
  if (r.ok && body.sensitive) {
    const s = body.sensitive as { email: string; phone: string };
    return { ok: true, email: s.email, phone: s.phone };
  }
  return { ok: false, reason: (body.reason as string) ?? 'Sensitive details need a custody-grade sign-in.' };
}
