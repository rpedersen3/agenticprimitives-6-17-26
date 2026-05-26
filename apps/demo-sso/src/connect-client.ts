// Browser orchestration for the real wallet (SIWE) connect → resolve → bootstrap
// → PII, all against the live broker + the deployed demo-a2a worker (via /a2a).
import { buildMessage } from '@agenticprimitives/connect-auth/siwe';
import { buildSubregistryRegisterCall, buildSetPrimaryNameCall } from '@agenticprimitives/agent-naming';
import { buildExecuteCallData } from '@agenticprimitives/agent-account';
import {
  buildProposeEdgeCall,
  buildConfirmEdgeCall,
  computeEdgeId,
  RELATIONSHIP_TYPE,
  type RelationshipType,
} from '@agenticprimitives/agent-relationships';
import type { Address, Hex } from '@agenticprimitives/types';
import { connectWallet, personalSign } from './lib/wallet';
import { registerPasskey, signWithPasskey, loadPasskey, type DemoPasskey } from './lib/passkey';
import { ensureCsrfToken, csrfHeaders } from './csrf';
import { CONTRACTS } from './lib/chain';

/** A function that signs a 32-byte hash (EOA personal_sign or WebAuthn). */
export type SignHash = (hash: Hex) => Promise<Hex>;

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
  const submitted = (await submitRes.json()) as {
    ok?: boolean;
    deployedAddress?: Address;
    error?: string;
    detail?: string;
  };
  if (!submitRes.ok || !submitted.ok || !submitted.deployedAddress) {
    return {
      ok: false,
      error: [submitted.error, submitted.detail].filter(Boolean).join(' — ') || `deploy submit failed (HTTP ${submitRes.status})`,
    };
  }
  const agent = submitted.deployedAddress;
  // No separate enroll step: /connect/siwe derives the SA + records the facet on
  // the reconnect (with a post-deploy poll for RPC lag), so this is just the deploy.
  return { ok: true, agent };
}

/** Execute a call FROM a deployed agent: build userOp -> sign hash -> submit (via /a2a). */
async function executeCall(
  sender: Address,
  signHash: SignHash,
  callData: Hex,
): Promise<{ ok: true; txHash?: Hex } | { ok: false; error: string }> {
  await ensureCsrfToken();
  const buildRes = await fetch('/a2a/account/build-call-userop', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ sender, callData }),
  });
  const built = (await buildRes.json()) as {
    ok?: boolean;
    userOpHash?: Hex;
    userOp?: Record<string, unknown>;
    error?: string;
  };
  if (!buildRes.ok || !built.ok || !built.userOpHash || !built.userOp) {
    return { ok: false, error: built.error ?? `build-call failed (HTTP ${buildRes.status})` };
  }
  const signature = await signHash(built.userOpHash);
  const submitRes = await fetch('/a2a/account/submit-call-userop', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ userOp: { ...built.userOp, signature } }),
  });
  const submitted = (await submitRes.json()) as { ok?: boolean; transactionHash?: Hex; error?: string };
  if (!submitRes.ok || !submitted.ok) {
    return { ok: false, error: submitted.error ?? `submit-call failed (HTTP ${submitRes.status})` };
  }
  return { ok: true, txHash: submitted.transactionHash };
}

/** Claim a forced-unique `<base>[N].demo.agent` for the agent + set it as primary.
 *  Two gasless execute UserOps signed by the EOA custodian. Best-effort: a failed
 *  setPrimaryName still returns ok (the name is owned; reverse can be re-set later). */
export async function claimName(
  agent: Address,
  signHash: SignHash,
  base: string,
  onStep?: (s: string) => void,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  onStep?.('Finding a free name…');
  const nameRes = await fetch(`/connect/name?base=${encodeURIComponent(base)}`);
  const picked = (await nameRes.json()) as { label?: string; name?: string; node?: Hex; error?: string };
  if (!nameRes.ok || !picked.name || !picked.node || !picked.label) {
    return { ok: false, error: picked.error ?? 'no free name' };
  }

  onStep?.(`Claiming ${picked.name}…`);
  const register = buildSubregistryRegisterCall({
    subregistry: CONTRACTS.permissionlessSubregistry,
    label: picked.label,
    newOwner: agent,
  });
  const reg = await executeCall(agent, signHash, buildExecuteCallData(register));
  if (!reg.ok) return { ok: false, error: `name register failed: ${reg.error}` };

  onStep?.('Setting it as your primary name…');
  const setPrimary = buildSetPrimaryNameCall({ registry: CONTRACTS.agentNameRegistry, node: picked.node });
  await executeCall(agent, signHash, buildExecuteCallData(setPrimary)); // best-effort
  return { ok: true, name: picked.name };
}

// ── Passkey (WebAuthn) ──────────────────────────────────────────────
export type { DemoPasskey };
export type PasskeyOutcome =
  | { status: 'issued'; token: string; passkey: DemoPasskey }
  | { status: 'bootstrap'; passkey: DemoPasskey }
  | { status: 'disambiguate' | 'rejected'; passkey?: DemoPasskey; reason?: string };

/** A signHash backed by the registered passkey (WebAuthn). */
export const passkeySignHash: SignHash = (hash) => signWithPasskey(hash);

/** Sign in with a passkey (registering one first if none on this device), then resolve. */
export async function passkeyLogin(registerIfMissing = true): Promise<PasskeyOutcome> {
  let passkey = loadPasskey();
  if (!passkey) {
    if (!registerIfMissing) return { status: 'rejected', reason: 'no passkey on this device' };
    passkey = await registerPasskey('Agentic Connect passkey');
  }
  const { challenge } = (await (await fetch('/connect/passkey-challenge')).json()) as { challenge: Hex };
  const signature = await signWithPasskey(challenge);
  const r = await fetch('/connect/passkey', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      credentialIdDigest: passkey.credentialIdDigest,
      pubKeyX: passkey.pubKeyX.toString(),
      pubKeyY: passkey.pubKeyY.toString(),
      challenge,
      signature,
      aud: AUD,
    }),
  });
  const body = (await r.json()) as { status: string; token?: string };
  if (body.status === 'issued' && body.token) return { status: 'issued', token: body.token, passkey };
  if (body.status === 'bootstrap') return { status: 'bootstrap', passkey };
  return { status: (body.status as 'disambiguate' | 'rejected') ?? 'rejected', passkey };
}

/** Bootstrap a passkey-direct person SA (no server custodian ever, P0-A) + enroll the facet. */
export async function bootstrapWithPasskey(
  passkey: DemoPasskey,
  onStep?: (s: string) => void,
): Promise<{ ok: true; agent: Address } | { ok: false; error: string }> {
  await ensureCsrfToken();
  onStep?.('Preparing your workspace…');
  const buildRes = await fetch('/a2a/session/deploy', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({
      initMethod: 'passkey',
      credentialIdDigest: passkey.credentialIdDigest,
      pubKeyX: passkey.pubKeyX.toString(),
      pubKeyY: passkey.pubKeyY.toString(),
    }),
  });
  if (buildRes.status === 409) return { ok: false, error: 'Gas sponsorship is not enabled on the backend (paymaster).' };
  const built = (await buildRes.json()) as { ok?: boolean; userOpHash?: Hex; userOp?: Record<string, unknown>; error?: string };
  if (!buildRes.ok || !built.ok || !built.userOpHash || !built.userOp) {
    return { ok: false, error: built.error ?? `deploy build failed (HTTP ${buildRes.status})` };
  }
  onStep?.('Confirm with your device…');
  const signature = await signWithPasskey(built.userOpHash);
  onStep?.('Securing on the network…');
  const submitRes = await fetch('/a2a/session/deploy/submit', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ userOp: { ...built.userOp, signature } }),
  });
  const submitted = (await submitRes.json()) as {
    ok?: boolean;
    deployedAddress?: Address;
    error?: string;
    detail?: string;
  };
  if (!submitRes.ok || !submitted.ok || !submitted.deployedAddress) {
    return {
      ok: false,
      error: [submitted.error, submitted.detail].filter(Boolean).join(' — ') || `deploy submit failed (HTTP ${submitRes.status})`,
    };
  }
  const agent = submitted.deployedAddress;
  // No separate enroll step: /connect/passkey derives the SA + records the facet on
  // the reconnect (with a post-deploy poll for RPC lag), so this is just the deploy.
  return { ok: true, agent };
}

// ── A2A service agent + relationship edge (spec 227 §6 / M5) ────────

/** Deploy a Smart Agent via demo-a2a (no facet enroll). Used for the A2A agent. */
async function deployAgent(
  deployBody: Record<string, unknown>,
  signHash: SignHash,
): Promise<{ ok: true; agent: Address } | { ok: false; error: string }> {
  await ensureCsrfToken();
  const buildRes = await fetch('/a2a/session/deploy', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(deployBody),
  });
  if (buildRes.status === 409) return { ok: false, error: 'paymaster not enabled' };
  const built = (await buildRes.json()) as { ok?: boolean; userOpHash?: Hex; userOp?: Record<string, unknown>; error?: string };
  if (!buildRes.ok || !built.ok || !built.userOpHash || !built.userOp) {
    return { ok: false, error: built.error ?? `deploy build failed (HTTP ${buildRes.status})` };
  }
  const signature = await signHash(built.userOpHash);
  const submitRes = await fetch('/a2a/session/deploy/submit', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ userOp: { ...built.userOp, signature } }),
  });
  const submitted = (await submitRes.json()) as {
    ok?: boolean;
    deployedAddress?: Address;
    error?: string;
    detail?: string;
  };
  if (!submitRes.ok || !submitted.ok || !submitted.deployedAddress) {
    return {
      ok: false,
      error: [submitted.error, submitted.detail].filter(Boolean).join(' — ') || `deploy submit failed (HTTP ${submitRes.status})`,
    };
  }
  return { ok: true, agent: submitted.deployedAddress };
}

export interface ProvisionResult {
  a2aAgent: Address;
  edgeId: Hex;
}

/** Provision a 2nd SA (the A2A service agent) custodied by the same credential, and
 *  link `a2a --OPERATES_ON_BEHALF_OF--> person` (a2a proposes as subject; person
 *  confirms as object — architect F1). Both txs signed by the user's one credential. */
export async function provisionA2aAgent(
  via: 'wallet' | 'passkey',
  personAgent: Address,
  onStep?: (s: string) => void,
): Promise<{ ok: true; result: ProvisionResult } | { ok: false; error: string }> {
  const A2A_SALT = '1'; // distinct from the person SA (salt 0) -> distinct address
  let signHash: SignHash;
  let deployBody: Record<string, unknown>;
  if (via === 'wallet') {
    const addr = await connectWallet();
    signHash = (h) => personalSign(addr, h);
    deployBody = { initMethod: 'eoa', owner: addr, salt: A2A_SALT };
  } else {
    const pk = loadPasskey();
    if (!pk) return { ok: false, error: 'no passkey on this device' };
    signHash = passkeySignHash;
    deployBody = {
      initMethod: 'passkey',
      credentialIdDigest: pk.credentialIdDigest,
      pubKeyX: pk.pubKeyX.toString(),
      pubKeyY: pk.pubKeyY.toString(),
      salt: A2A_SALT,
    };
  }

  onStep?.('Deploying your agent service…');
  const dep = await deployAgent(deployBody, signHash);
  if (!dep.ok) return { ok: false, error: `agent deploy failed: ${dep.error}` };
  const a2aAgent = dep.agent;
  if (a2aAgent.toLowerCase() === personAgent.toLowerCase()) {
    return { ok: false, error: 'agent service collided with the person agent (salt)' };
  }

  const relationships = CONTRACTS.agentRelationship;
  const relationshipType = RELATIONSHIP_TYPE.OPERATES_ON_BEHALF_OF as RelationshipType;

  onStep?.('Linking it to operate on your behalf…');
  const propose = buildProposeEdgeCall({ relationships, subject: a2aAgent, object: personAgent, relationshipType });
  const p = await executeCall(a2aAgent, signHash, buildExecuteCallData(propose)); // a2a = subject (proposer)
  if (!p.ok) return { ok: false, error: `propose edge failed: ${p.error}` };

  onStep?.('Confirming the link…');
  const edgeId = computeEdgeId(a2aAgent, personAgent, relationshipType);
  const confirm = buildConfirmEdgeCall({ relationships, edgeId });
  await executeCall(personAgent, signHash, buildExecuteCallData(confirm)); // person = object (confirmer); best-effort

  return { ok: true, result: { a2aAgent, edgeId } };
}

/** Step a Google (login-grade) session UP to custody-grade for the SAME bound agent.
 *  The target agent is the googleToken's sub (server-enforced) — so a Google login can
 *  only ever step up into its one bound workspace; the credential must be a custodian of it. */
export async function stepUpToAgent(
  via: 'wallet' | 'passkey',
  googleToken: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (via === 'wallet') {
    const address = await connectWallet();
    const nonce = await getNonce();
    const message = buildMessage({
      domain: window.location.host,
      address,
      uri: window.location.origin,
      chainId: CHAIN_ID,
      nonce,
      statement: 'Confirm custody of your Agentic Connect workspace.',
    });
    const signature = await personalSign(address, message);
    const r = await fetch('/connect/stepup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ googleToken, kind: 'siwe-eoa', aud: AUD, message, signature }),
    });
    const b = (await r.json()) as { status?: string; token?: string; error?: string };
    if (r.ok && b.status === 'issued' && b.token) return { ok: true, token: b.token };
    return { ok: false, error: b.error ?? `step-up failed (HTTP ${r.status})` };
  }
  const pk = loadPasskey();
  if (!pk) return { ok: false, error: 'no passkey on this device' };
  const { challenge } = (await (await fetch('/connect/passkey-challenge')).json()) as { challenge: Hex };
  const signature = await signWithPasskey(challenge);
  const r = await fetch('/connect/stepup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ googleToken, kind: 'passkey', aud: AUD, credentialIdDigest: pk.credentialIdDigest, challenge, signature }),
  });
  const b = (await r.json()) as { status?: string; token?: string; error?: string };
  if (r.ok && b.status === 'issued' && b.token) return { ok: true, token: b.token };
  return { ok: false, error: b.error ?? `step-up failed (HTTP ${r.status})` };
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
