// Browser orchestration for demo-org (a relying site). Name-first connect (passkey
// or SIWE) → on-chain custody AgentSession; sign-up a new agent; create a named
// organization Smart Agent custodied by the connected credential, linked to the
// person via a HAS_GOVERNANCE_OVER edge (spec 229). Hits demo-org's own broker +
// the deployed demo-a2a worker (via /a2a).
import { buildMessage } from '@agenticprimitives/connect-auth/siwe';
import { buildSubregistryRegisterCall, buildSetPrimaryNameCall } from '@agenticprimitives/agent-naming';
import { buildExecuteCallData, buildExecuteBatchCallData } from '@agenticprimitives/agent-account';
import {
  buildProposeEdgeCall,
  buildConfirmEdgeCall,
  computeEdgeId,
  RELATIONSHIP_TYPE,
  type RelationshipType,
} from '@agenticprimitives/agent-relationships';
import type { Address, Hex } from '@agenticprimitives/types';
import { fromWire, buildRedeemCallData, DELEGATION_MANAGER, type DelegationWire } from './lib/delegation';
import { connectWallet, personalSign } from './lib/wallet';
import { registerPasskey, signWithPasskey, loadPasskey, type DemoPasskey } from './lib/passkey';
import { ensureCsrfToken, csrfHeaders } from './csrf';
import { CONTRACTS } from './lib/chain';

/** A function that signs a 32-byte hash (EOA personal_sign or WebAuthn). */
export type SignHash = (hash: Hex) => Promise<Hex>;

export const AUD = 'demo-org';
const CHAIN_ID = 84532;

/** The person's central auth (spec 229). For now a single configured origin (demo-sso);
 *  later, the per-person `<handle>.agentictrust.io` subdomain resolved from the name. */
export const CENTRAL_AUTH_ORIGIN =
  (import.meta.env?.VITE_CENTRAL_AUTH_ORIGIN as string | undefined) ?? 'https://agenticprimitives-demo-sso.pages.dev';

export type SiweOutcome =
  | { status: 'issued'; token: string; address: Address; agent: Address }
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
    statement: 'Sign in to Agentic Org — proving you control this wallet.',
  });
  const signature = await personalSign(address, message);
  const r = await fetch('/connect/siwe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, signature, aud: AUD }),
  });
  const body = (await r.json()) as { status: string; token?: string; agent?: string; reason?: string };
  if (body.status === 'issued' && body.token) {
    return { status: 'issued', token: body.token, address, agent: (body.agent ?? address) as Address };
  }
  if (body.status === 'bootstrap') return { status: 'bootstrap', address };
  return { status: (body.status as 'disambiguate' | 'rejected') ?? 'rejected', address, reason: body.reason };
}

/** Bootstrap: deploy a person SA (EOA custodian) via demo-a2a. */
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
  return { ok: true, agent: submitted.deployedAddress };
}

/** Execute a call FROM a deployed agent: build userOp -> sign hash -> submit (via /a2a).
 *
 *  The hard part is the nonce. A just-deployed SA consumed nonce 0 in its deploy op, so its
 *  first post-deploy op needs nonce 1 — but the relayer's `getNonce` read can lag and return
 *  0, producing `AA25 invalid account nonce` (the wrong nonce is baked into the signature, so
 *  resubmitting the same op can't fix it). `minNonce` gates this: we poll the BUILD (no
 *  signing — no credential prompt) until the relayer's view reaches the expected nonce, THEN
 *  sign ONCE and submit. So we never sign a stale-nonce op, and the passkey/wallet is prompted
 *  exactly once. If a submit still fails (residual simulation lag, or an unexpected AA25), we
 *  rebuild+resign on the next loop with a fresh nonce. */
async function executeCall(
  sender: Address,
  signHash: SignHash,
  callData: Hex,
  opts: { minNonce?: bigint; attempts?: number } = {},
): Promise<{ ok: true; txHash?: Hex } | { ok: false; error: string }> {
  const { minNonce, attempts = 4 } = opts;
  await ensureCsrfToken();
  let lastErr = 'execute failed';

  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2500));

    // Build (no signing yet → no credential prompt on this step).
    const buildRes = await fetch('/a2a/account/build-call-userop', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({ sender, callData }),
    });
    const b = (await buildRes.json()) as {
      ok?: boolean;
      userOpHash?: Hex;
      userOp?: (Record<string, unknown> & { nonce?: string });
      error?: string;
      detail?: string;
    };
    if (!buildRes.ok || !b.ok || !b.userOpHash || !b.userOp) {
      lastErr = [b.error, b.detail].filter(Boolean).join(' — ') || `build-call failed (HTTP ${buildRes.status})`;
      continue;
    }

    // Nonce gate: don't sign until the relayer's nonce view reflects the deploy.
    if (minNonce !== undefined && BigInt(b.userOp.nonce ?? '0') < minNonce) {
      lastErr = `relayer nonce ${b.userOp.nonce} < ${minNonce} — deploy not yet propagated`;
      continue; // rebuild next loop; still no prompt
    }

    // Sign ONCE for this (correct-nonce) op, then submit.
    const signature = await signHash(b.userOpHash);
    const submitRes = await fetch('/a2a/account/submit-call-userop', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({ userOp: { ...b.userOp, signature } }),
    });
    const submitted = (await submitRes.json()) as { ok?: boolean; transactionHash?: Hex; error?: string; detail?: string };
    if (submitRes.ok && submitted.ok) return { ok: true, txHash: submitted.transactionHash };
    lastErr =
      [submitted.error, submitted.detail].filter(Boolean).join(' — ') || `submit-call failed (HTTP ${submitRes.status})`;
  }
  return { ok: false, error: lastErr };
}

/** Claim a forced-unique `<base>[N].demo.agent` for the agent + set it as primary.
 *  register + setPrimaryName are BATCHED into one execute UserOp (one nonce, one signature):
 *  they must land together, and the batch avoids an inter-userOp race where the second op
 *  sees a stale view of the first's state. `minNonce` rides out the post-deploy nonce lag
 *  (pass the nonce the SA must be at after its deploy, e.g. 1n right after a fresh deploy). */
export async function claimName(
  agent: Address,
  signHash: SignHash,
  base: string,
  onStep?: (s: string) => void,
  minNonce?: bigint,
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
  const setPrimary = buildSetPrimaryNameCall({ registry: CONTRACTS.agentNameRegistry, node: picked.node });
  const batch = buildExecuteBatchCallData([register, setPrimary]);
  const res = await executeCall(agent, signHash, batch, { minNonce, attempts: 10 });
  if (!res.ok) return { ok: false, error: `name claim failed: ${res.error}` };
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
    passkey = await registerPasskey('Agentic Org passkey');
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

/** Bootstrap a passkey-direct person SA (no server custodian ever). */
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
  return { ok: true, agent: submitted.deployedAddress };
}

/** Deploy a Smart Agent via demo-a2a (no facet enroll). Used for the org agent. */
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

// ── Create a named Organization Smart Agent (spec 229 §7 + ADR-0019) ───────────

export interface CreateOrgResult {
  orgAgent: Address;
  orgName: string;
  edgeId: Hex;
  governed: boolean; // true if the person→org HAS_GOVERNANCE_OVER edge was recorded
}

/** A distinct, name-independent salt for the org SA: credential scope + entropy,
 *  NEVER the name (ADR-0010). A fresh random salt per attempt = a fresh address. */
function orgSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n.toString(); // demo-a2a BigInt()s the salt string
}

/** Create an Organization Smart Agent custodied by the connected credential, claim its name,
 *  and record `person --HAS_GOVERNANCE_OVER--> org`. Under ADR-0019, when the session is a
 *  delegation (`via='passkey'` + `delegation` provided), the person→org PROPOSE is executed
 *  AS THE PERSON by REDEEMING the delegation through the site's delegate SA — the site key is
 *  never a custodian of the person. The wallet path (the wallet IS the person's custodian)
 *  signs the propose directly. The org itself is custodied by the connected credential. */
export async function createOrg(
  via: 'wallet' | 'passkey',
  personAgent: Address,
  orgBase: string,
  onStep?: (s: string) => void,
  delegation?: DelegationWire,
): Promise<{ ok: true; result: CreateOrgResult } | { ok: false; error: string }> {
  const salt = orgSalt();
  let signHash: SignHash;
  let deployBody: Record<string, unknown>;
  if (via === 'wallet') {
    const addr = await connectWallet();
    signHash = (h) => personalSign(addr, h);
    deployBody = { initMethod: 'eoa', owner: addr, salt };
  } else {
    const pk = loadPasskey();
    if (!pk) return { ok: false, error: 'no passkey on this device' };
    signHash = passkeySignHash;
    deployBody = {
      initMethod: 'passkey',
      credentialIdDigest: pk.credentialIdDigest,
      pubKeyX: pk.pubKeyX.toString(),
      pubKeyY: pk.pubKeyY.toString(),
      salt,
    };
  }

  onStep?.('Deploying your organization…');
  const dep = await deployAgent(deployBody, signHash);
  if (!dep.ok) return { ok: false, error: `org deploy failed: ${dep.error}` };
  const orgAgent = dep.agent;
  if (orgAgent.toLowerCase() === personAgent.toLowerCase()) {
    return { ok: false, error: 'org collided with your person agent (salt)' };
  }

  // Fresh deploy consumed nonce 0 → the claim batch is nonce 1.
  const claim = await claimName(orgAgent, signHash, orgBase, onStep, 1n);
  if (!claim.ok) return { ok: false, error: claim.error };

  const relationships = CONTRACTS.agentRelationship;
  const relationshipType = RELATIONSHIP_TYPE.HAS_GOVERNANCE_OVER as RelationshipType;
  const edgeId = computeEdgeId(personAgent, orgAgent, relationshipType);
  const propose = buildProposeEdgeCall({ relationships, subject: personAgent, object: orgAgent, relationshipType });

  onStep?.('Recording your control on-chain…');
  let governed = false;
  if (via === 'passkey' && delegation) {
    // AS THE PERSON via the delegation: the site's delegate SA executes
    // DelegationManager.redeemDelegation([delegation], relationships, 0, proposeData) → the
    // proposeEdge runs as the person (the delegator), scoped by caveats.
    const d = fromWire(delegation);
    const redeemData = buildRedeemCallData(d, propose.to, BigInt(propose.value), propose.data);
    const p = await executeCall(
      d.delegate,
      signHash,
      buildExecuteCallData({ to: DELEGATION_MANAGER, value: 0n, data: redeemData }),
      { attempts: 6 },
    );
    governed = p.ok;
    if (!p.ok) onStep?.('(governance edge skipped — you still own the org)');
  } else if (via === 'wallet') {
    // The wallet is the person's own custodian → sign the propose directly on the person SA.
    const p = await executeCall(personAgent, signHash, buildExecuteCallData(propose), { attempts: 6 });
    governed = p.ok;
  }

  if (governed) {
    onStep?.('Confirming the link…');
    const confirm = buildConfirmEdgeCall({ relationships, edgeId });
    // org = object (confirmer); org's 3rd op (deploy 0, claim 1, confirm 2). Best-effort.
    await executeCall(orgAgent, signHash, buildExecuteCallData(confirm), { minNonce: 2n, attempts: 6 });
  }

  return { ok: true, result: { orgAgent, orgName: claim.name, edgeId, governed } };
}

/** First-visit enrollment (spec 229 §3 + ADR-0019): register a LOCAL passkey for THIS
 *  origin and deploy this site's **delegate Smart Account** (custodied by that passkey, a
 *  distinct salt so it's its own account). Returns the central-auth URL — the person will
 *  issue a caveated delegation `person → delegateSA` there. The site is a DELEGATE, never a
 *  custodian of the person SA. */
export async function startSiteEnrollment(
  name: string,
  onStep?: (s: string) => void,
): Promise<{ ok: true; url: string; state: string; delegateSA: Address } | { ok: false; error: string }> {
  onStep?.('Creating your sign-in key on this device…');
  const pk = await registerPasskey(name); // local passkey on THIS origin, stored
  onStep?.('Setting up this site’s account…');
  const saltBytes = crypto.getRandomValues(new Uint8Array(8));
  let salt = 0n;
  for (const b of saltBytes) salt = (salt << 8n) | BigInt(b);
  const dep = await deployAgent(
    {
      initMethod: 'passkey',
      credentialIdDigest: pk.credentialIdDigest,
      pubKeyX: pk.pubKeyX.toString(),
      pubKeyY: pk.pubKeyY.toString(),
      salt: salt.toString(),
    },
    passkeySignHash,
  );
  if (!dep.ok) return { ok: false, error: `site account deploy failed: ${dep.error}` };
  const stateBytes = crypto.getRandomValues(new Uint8Array(16));
  const state = Array.from(stateBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const u = new URL('/', CENTRAL_AUTH_ORIGIN);
  u.searchParams.set('aud', AUD);
  u.searchParams.set('redirect_uri', window.location.origin + '/');
  u.searchParams.set('state', state);
  u.searchParams.set('name', name);
  u.searchParams.set('delegate', dep.agent);
  return { ok: true, url: u.toString(), state, delegateSA: dep.agent };
}

/** Connect to the agent that OWNS `name`, proving control with a custody credential.
 *  Name-first: the agent-service name is the identity; the server resolves name→agent
 *  on-chain and verifies the credential is a custodian of it. */
export async function connectWithName(
  name: string,
  via: 'wallet' | 'passkey',
): Promise<{ ok: true; token: string; name?: string } | { ok: false; error: string }> {
  let proof: Record<string, unknown>;
  if (via === 'wallet') {
    const address = await connectWallet();
    const nonce = await getNonce();
    const message = buildMessage({
      domain: window.location.host,
      address,
      uri: window.location.origin,
      chainId: CHAIN_ID,
      nonce,
      statement: `Connect to ${name} on Agentic Org.`,
    });
    const signature = await personalSign(address, message);
    proof = { kind: 'siwe-eoa', message, signature };
  } else {
    const pk = loadPasskey();
    if (!pk) return { ok: false, error: 'No passkey on this device — sign up here, or connect with your wallet.' };
    const { challenge } = (await (await fetch('/connect/passkey-challenge')).json()) as { challenge: Hex };
    const signature = await signWithPasskey(challenge);
    proof = { kind: 'passkey', credentialIdDigest: pk.credentialIdDigest, challenge, signature };
  }
  const r = await fetch('/connect/with-name', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, aud: AUD, ...proof }),
  });
  const b = (await r.json()) as { status?: string; token?: string; name?: string; error?: string };
  if (r.ok && b.status === 'issued' && b.token) return { ok: true, token: b.token, name: b.name };
  return { ok: false, error: b.error ?? `connect failed (HTTP ${r.status})` };
}

/** Sign in via a DELEGATION (ADR-0019): prove control of this site's delegate SA (the site
 *  passkey asserts) and present the stored delegation; the server verifies the person SA
 *  signed it (ERC-1271), it's unrevoked + in-window, and the delegate matches → a scoped
 *  (login-grade) session whose `sub` is the PERSON. No `isCustodian`. */
export async function connectWithDelegation(
  name: string,
  delegation: DelegationWire,
): Promise<{ ok: true; token: string; name?: string } | { ok: false; error: string }> {
  const pk = loadPasskey();
  if (!pk) return { ok: false, error: 'No site passkey on this device — set up this site first.' };
  const { challenge } = (await (await fetch('/connect/passkey-challenge')).json()) as { challenge: Hex };
  const signature = await signWithPasskey(challenge);
  const r = await fetch('/connect/with-delegation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, aud: AUD, delegation, credentialIdDigest: pk.credentialIdDigest, challenge, signature }),
  });
  const b = (await r.json()) as { status?: string; token?: string; name?: string; error?: string };
  if (r.ok && b.status === 'issued' && b.token) return { ok: true, token: b.token, name: b.name };
  return { ok: false, error: b.error ?? `connect failed (HTTP ${r.status})` };
}

/** Sign up: create a workspace named `<base>.demo.agent` with a custody credential,
 *  and CLAIM the name for THAT credential's agent. Passkey → a FRESH passkey (a new
 *  workspace); wallet → the EOA's deterministic agent. */
export async function signupWithName(
  base: string,
  via: 'wallet' | 'passkey',
  onStep?: (s: string) => void,
): Promise<{ ok: true; token: string; name: string } | { ok: false; error: string }> {
  if (via === 'passkey') {
    onStep?.('Creating your passkey…');
    const pk = await registerPasskey(`${base}.demo.agent`); // FRESH passkey for this workspace
    const dep = await bootstrapWithPasskey(pk, onStep); // deploy passkey-direct
    if (!dep.ok) return { ok: false, error: dep.error };
    // Fresh deploy consumed nonce 0 → the claim op must be nonce ≥ 1 (gate out the lag).
    const claim = await claimName(dep.agent, passkeySignHash, base, onStep, 1n);
    if (!claim.ok) return { ok: false, error: claim.error };
    onStep?.('Signing you in…');
    const login = await passkeyLogin(false);
    return login.status === 'issued'
      ? { ok: true, token: login.token, name: claim.name }
      : { ok: false, error: `created, but sign-in returned ${login.status}` };
  }
  // wallet: the EOA's deterministic agent (reconnect if it exists, else bootstrap).
  onStep?.('Connecting your wallet…');
  const first = await siweLogin(); // connects wallet + signs
  let agent: Address;
  let address: Address;
  let minNonce: bigint | undefined; // set only on a fresh deploy (nonce 0 just consumed)
  if (first.status === 'issued') {
    agent = first.agent;
    address = first.address;
  } else if (first.status === 'bootstrap') {
    address = first.address;
    const dep = await bootstrapWithWallet(address, onStep);
    if (!dep.ok) return { ok: false, error: dep.error };
    agent = dep.agent;
    minNonce = 1n;
  } else {
    return { ok: false, error: first.reason ?? `sign-in ${first.status}` };
  }
  const signHash: SignHash = (h) => personalSign(address, h);
  const claim = await claimName(agent, signHash, base, onStep, minNonce);
  if (!claim.ok) return { ok: false, error: claim.error };
  onStep?.('Signing you in…');
  const login = await siweLogin();
  return login.status === 'issued'
    ? { ok: true, token: login.token, name: claim.name }
    : { ok: false, error: `created, but sign-in returned ${login.status}` };
}
