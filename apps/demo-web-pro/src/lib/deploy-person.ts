/**
 * Person Smart Agent deploy — passkey, SIWE, or both. Gasless via demo-a2a.
 *
 * Wave R0 — Person PSAs deploy as `mode=1` (CustodyPolicy installed
 * at birth) so they're recovery-capable from day one. There's a
 * chicken-and-egg at first-Person deploy: nobody else exists to be a
 * trustee yet. We bootstrap with a SELF-TRUSTEE (the deploying
 * passkey's own PIA), which is honest about the fact that solo Alice
 * has no real recovery story. When the second Person joins (Act 3),
 * both PSAs add each other as trustees via T6 admin and either keep or
 * drop the self-trustee. SIWE-only Persons can't bootstrap a passkey
 * PIA, so they fall back to mode=0 (simple, no recovery).
 *
 * The worker accepts the unified `AgentAccountInitParams`-shaped
 * payload at `/session/direct-deploy`. For the gasless passkey path,
 * `/session/deploy` builds a userOp and the passkey signs.
 */

import { keccak256, encodeAbiParameters, type Address, type Hex } from 'viem';
import { config } from '../config';
import type { DemoPasskey } from './passkey';
import { csrfHeaders, ensureCsrfToken, CsrfError } from './csrf';

/** Derive a passkey's PIA — keccak256(abi.encode(x, y))[12:32]. */
function passkeyIdentity(x: bigint, y: bigint): Address {
  const h = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [x, y]));
  return ('0x' + h.slice(-40)) as Address;
}

export interface DeployResult {
  ok: true;
  deployedAddress: Address;
  transactionHash: Hex;
}

export interface DeployError {
  ok: false;
  error: string;
  reason?: string;
}

export interface DeployPersonAgentArgs {
  /** Optional — when present, the passkey is registered + its PIA becomes a custodian. */
  passkey?: DemoPasskey;
  /** Optional — when non-empty, each EOA is added to custodians at init. */
  custodians?: Address[];
}

export async function deployPersonAgent(
  args: DeployPersonAgentArgs,
): Promise<DeployResult | DeployError> {
  const { passkey, custodians = [] } = args;
  if (!passkey && custodians.length === 0) {
    return { ok: false, error: 'no_signers', reason: 'at least one of passkey or custodians required' };
  }

  const base = config.demoA2aUrl;
  if (!base) {
    return {
      ok: false,
      error: 'demo_a2a_url_unset',
      reason: 'VITE_DEMO_A2A_URL is not configured.',
    };
  }
  try {
    await ensureCsrfToken();
  } catch (e) {
    if (e instanceof CsrfError) {
      return { ok: false, error: 'csrf_unavailable', reason: e.message };
    }
    return {
      ok: false,
      error: 'csrf_unavailable',
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  const baseTrimmed = base.replace(/\/$/, '');

  // SIWE-only path: mode=0 (no recovery — SIWE-only Persons have no
  // passkey PIA to bootstrap a self-trustee). The worker direct-deploys
  // via the factory; the call is permissionless, no user signature.
  if (!passkey) {
    const directRes = await fetch(`${baseTrimmed}/session/direct-deploy`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({
        mode: 0,
        custodians,
        trustees: [],
        initialPasskeyCredentialIdDigest: `0x${'00'.repeat(32)}`,
        initialPasskeyX: '0',
        initialPasskeyY: '0',
        timelockOverrides: [],
        // Time-bucketed salt: each fresh Act-1 claim attempt gets a
        // distinct CREATE2 address even when re-using the same EOA.
        // Without this, after Reset the user's same EOA → same SA →
        // already-claimed name → AlreadyClaimed on the auto-claim
        // batch. Salt is throwaway: we only need to ensure uniqueness
        // per-session, not reproducibility across sessions (the SA's
        // address is persisted in the SeatClaim after deploy).
        salt: Date.now().toString(),
      }),
    });
    const raw = await directRes.text();
    let directBody: Record<string, unknown> = {};
    try {
      directBody = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, error: 'direct_deploy_http', reason: `HTTP ${directRes.status}: ${raw.slice(0, 80)}` };
    }
    if (!directRes.ok || directBody.ok !== true) {
      return {
        ok: false,
        error: typeof directBody.error === 'string' ? directBody.error : `HTTP ${directRes.status}`,
        reason: typeof directBody.detail === 'string' ? directBody.detail : undefined,
      };
    }
    return {
      ok: true,
      deployedAddress: directBody.deployedAddress as Address,
      transactionHash: directBody.transactionHash as Hex,
    };
  }

  // Passkey path: mode=1 (recovery-capable) with self-trustee bootstrap.
  // The passkey's PIA goes in trustees[] so the factory's mode>0
  // invariant is satisfied. Real trustees (other Persons) are added by
  // T6 admin rotation in later acts when the second Person joins.
  const piaForTrustee = passkeyIdentity(passkey.pubKeyX, passkey.pubKeyY);

  // /session/deploy currently builds mode=0 deploys. For mode=1 we go
  // direct-deploy (factory call from worker EOA) since the userOpHash
  // signing flow + mode=1 paymaster gas budget is a separate concern
  // (Wave R1 native multi-signer ceremony will refactor this).
  const directRes = await fetch(`${baseTrimmed}/session/direct-deploy`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({
      mode: 1,
      custodians,
      trustees: [piaForTrustee],
      initialPasskeyCredentialIdDigest: passkey.credentialIdDigest,
      initialPasskeyX: passkey.pubKeyX.toString(),
      initialPasskeyY: passkey.pubKeyY.toString(),
      timelockOverrides: [],
      salt: Date.now().toString(),
    }),
  });
  const directRaw = await directRes.text();
  let directBody: Record<string, unknown> = {};
  try {
    directBody = JSON.parse(directRaw) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'direct_deploy_http', reason: `HTTP ${directRes.status}: ${directRaw.slice(0, 80)}` };
  }
  if (!directRes.ok || directBody.ok !== true) {
    return {
      ok: false,
      error: typeof directBody.error === 'string' ? directBody.error : `HTTP ${directRes.status}`,
      reason: typeof directBody.detail === 'string' ? directBody.detail : undefined,
    };
  }
  return {
    ok: true,
    deployedAddress: directBody.deployedAddress as Address,
    transactionHash: directBody.transactionHash as Hex,
  };
}
