/**
 * Person Smart Agent deploy — passkey, SIWE, or both. Gasless via demo-a2a.
 *
 * The worker accepts a mixed `{ externalCustodians?, passkey? }` payload
 * (phase 6f.4+). The signer of the userOpHash is whichever owner
 * authority the freshly-deployed account will accept:
 *   - passkey-only spec  → WebAuthn assertion  → `0x01 || ABI(Assertion)` blob
 *   - SIWE-only spec     → ECDSA over userOpHash via wagmi.signMessage({raw}) → 65 bytes
 *   - mixed              → prefer passkey (gasless, no wallet popup)
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

export interface DeployPersonAgentArgs {
  /** Optional — when present, the passkey is registered + its PIA becomes a custodian. */
  passkey?: DemoPasskey;
  /** Optional — when non-empty, each EOA is added to externalCustodians at init. */
  externalCustodians?: Address[];
}

export async function deployPersonAgent(
  args: DeployPersonAgentArgs,
): Promise<DeployResult | DeployError> {
  const { passkey, externalCustodians = [] } = args;
  if (!passkey && externalCustodians.length === 0) {
    return { ok: false, error: 'no_signers', reason: 'at least one of passkey or externalCustodians required' };
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

  // SIWE-only path: bypass ERC-4337 + signed userOp; let the worker
  // directly invoke `factory.createPersonAgent(externalCustodians, ...)`.
  // The factory call is permissionless; no user signature needed.
  if (!passkey) {
    const directRes = await fetch(`${baseTrimmed}/session/direct-deploy`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({ externalCustodians }),
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

  // 1. Ask demo-a2a for the unsigned userOp.
  const buildRes = await fetch(`${baseTrimmed}/session/deploy`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({
      externalCustodians,
      passkey: passkey
        ? {
            credentialIdDigest: passkey.credentialIdDigest,
            pubKeyX: passkey.pubKeyX.toString(),
            pubKeyY: passkey.pubKeyY.toString(),
          }
        : undefined,
    }),
  });
  if (buildRes.status === 409) {
    return {
      ok: false,
      error: 'paymaster_unavailable',
      reason: 'demo-a2a has no paymaster configured.',
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

  // 2. Sign the userOpHash. Passkey path is preferred (gasless UX); the
  //    SIWE path requires the user's wallet to sign the 32-byte hash.
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
