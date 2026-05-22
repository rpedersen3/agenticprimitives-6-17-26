/**
 * Person Smart Agent deploy — passkey-only, gasless.
 *
 * Talks to demo-a2a's session/deploy endpoints. Spec 211 § 4 + Act 1.
 * The connected visitor has NO ETH; the smartAgentPaymaster sponsors
 * the userOp. The user only proves possession of their passkey.
 *
 * Round-trip:
 *   1. POST {demoA2aUrl}/session/deploy
 *        { initMethod: 'passkey', credentialIdDigest, pubKeyX, pubKeyY }
 *      → { userOp, userOpHash, sender }
 *   2. WebAuthn assertion over userOpHash via signWithPasskeyB64
 *   3. POST {demoA2aUrl}/session/deploy/submit
 *        { userOp: { ...userOp, signature } }
 *      → { ok, deployedAddress, transactionHash }
 *
 * Path note: demo-web uses `/a2a/session/deploy` because a Pages
 * Function strips the `/a2a` prefix before forwarding to the worker.
 * demo-web-pro hits the worker URL directly (cross-origin via
 * VITE_DEMO_A2A_URL), so the prefix-free path applies.
 *
 * Mirrors apps/demo-web/src/deploy-flow.ts at a simpler surface
 * (no SIWE, no session wallet — passkey is the only signer).
 */

import { encodeWebAuthnSignature } from '@agenticprimitives/agent-account';
import type { Address, Hex } from 'viem';
import { config } from '../config';
import { assertWithPasskey, type DemoPasskey } from './passkey';
import { csrfHeaders, ensureCsrfToken, CsrfError } from './csrf';

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

type DeployUserOpBuilt = {
  ok: true;
  sender: Address;
  userOpHash: Hex;
  userOp: {
    sender: Address;
    nonce: string;
    initCode: Hex;
    callData: Hex;
    accountGasLimits: Hex;
    preVerificationGas: string;
    gasFees: Hex;
    paymasterAndData: Hex;
    signature: Hex;
  };
};

export async function deployPersonAgent(
  passkey: DemoPasskey,
): Promise<DeployResult | DeployError> {
  const base = config.demoA2aUrl;
  if (!base) {
    return {
      ok: false,
      error: 'demo_a2a_url_unset',
      reason: 'VITE_DEMO_A2A_URL is not configured; the Person Smart Agent deploy needs the relayer to sponsor the userOp.',
    };
  }

  // 0. Acquire CSRF token + cookie. demo-a2a's middleware fail-closes
  //    every POST without a matching header+cookie pair. The token is
  //    bound to the demo-web-pro origin via HMAC; cookie roundtrips
  //    cross-origin because the worker sets it `SameSite=None; Secure`.
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

  // 1. Ask demo-a2a for the unsigned userOp.
  const buildRes = await fetch(`${baseTrimmed}/session/deploy`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({
      initMethod: 'passkey',
      credentialIdDigest: passkey.credentialIdDigest,
      pubKeyX: passkey.pubKeyX.toString(),
      pubKeyY: passkey.pubKeyY.toString(),
    }),
  });
  if (buildRes.status === 409) {
    return {
      ok: false,
      error: 'paymaster_unavailable',
      reason: 'demo-a2a has no paymaster configured. Run a deployment with VITE_DEMO_A2A_URL pointing at a paymaster-enabled relay.',
    };
  }
  const buildBody = (await buildRes.json()) as Record<string, unknown>;
  if (!buildRes.ok || buildBody.ok !== true) {
    return {
      ok: false,
      error: typeof buildBody.error === 'string' ? buildBody.error : `HTTP ${buildRes.status}`,
      reason: typeof buildBody.detail === 'string' ? buildBody.detail : undefined,
    };
  }
  const built = buildBody as unknown as DeployUserOpBuilt;

  // 2. Passkey-sign the userOpHash via WebAuthn. The result is an
  //    0x01-prefixed blob that AgentAccount._validateSig routes to
  //    _verifyWebAuthn.
  let signature: Hex;
  try {
    const assertion = await assertWithPasskey(passkey, built.userOpHash);
    signature = encodeWebAuthnSignature(assertion);
  } catch (e) {
    return {
      ok: false,
      error: 'sign_failed',
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  // 3. Submit the signed userOp.
  const submitRes = await fetch(`${baseTrimmed}/session/deploy/submit`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ userOp: { ...built.userOp, signature } }),
  });
  const submitBody = (await submitRes.json()) as Record<string, unknown>;
  if (!submitRes.ok || submitBody.ok !== true) {
    return {
      ok: false,
      error: typeof submitBody.error === 'string' ? submitBody.error : `HTTP ${submitRes.status}`,
      reason: typeof submitBody.detail === 'string' ? submitBody.detail : undefined,
    };
  }
  return {
    ok: true,
    deployedAddress: submitBody.deployedAddress as Address,
    transactionHash: submitBody.transactionHash as Hex,
  };
}
