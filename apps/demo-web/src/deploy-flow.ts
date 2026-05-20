// Smart-account deploy flow.
//
// After SIWE, if isDeployed=false AND the demo-a2a Worker has PAYMASTER
// configured, present a "Deploy your smart account" step. The user signs
// the userOpHash with their owner EOA (the same EOA used for SIWE +
// delegation). demo-a2a's KMS-backed bundler submits handleOps via the
// paymaster. The user never pays gas.
//
// Round-trip:
//   1. POST /a2a/session/deploy { owner }  → { userOp, userOpHash, sender }
//   2. user.account.sign({ hash: userOpHash })  → signature
//   3. POST /a2a/session/deploy/submit { userOp: { ...userOp, signature } }
//      → { ok, deployedAddress, transactionHash }
//
// On 409 from /session/deploy we silently skip — paymaster not configured
// in this deploy. The frontend falls back to counterfactual mode.

import type { Address, Hex } from '@agenticprimitives/types';
import type { DemoUser } from './test-user';

export interface DeployUserOpResponse {
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
}

export interface DeployResult {
  ok: true;
  deployedAddress: Address;
  transactionHash: Hex;
}

export interface DeployFlowError {
  ok: false;
  error: string;
  reason?: string;
  /** True when the backend has no paymaster configured — caller should fall back to counterfactual mode. */
  paymasterUnavailable?: boolean;
}

/**
 * Build → sign → submit. Returns deployedAddress on success, or a clean
 * error envelope. Caller chooses what to render.
 */
export async function deploySmartAccount(
  user: DemoUser,
  owner: Address,
): Promise<DeployResult | DeployFlowError> {
  // 1. Ask backend for the unsigned UserOp + hash to sign.
  const buildRes = await fetch('/a2a/session/deploy', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner }),
  });
  if (buildRes.status === 409) {
    return { ok: false, error: 'paymaster_unavailable', paymasterUnavailable: true };
  }
  const buildBody = (await buildRes.json()) as Record<string, unknown>;
  if (!buildRes.ok || buildBody.ok !== true) {
    return {
      ok: false,
      error: typeof buildBody.error === 'string' ? buildBody.error : `HTTP ${buildRes.status}`,
      reason: typeof buildBody.detail === 'string' ? buildBody.detail : undefined,
    };
  }
  const built = buildBody as unknown as DeployUserOpResponse;

  // 2. Sign the userOpHash with the user's owner EOA.
  let signature: Hex;
  try {
    signature = (await user.account.sign({ hash: built.userOpHash })) as Hex;
  } catch (e) {
    return { ok: false, error: 'sign_failed', reason: e instanceof Error ? e.message : String(e) };
  }

  // 3. Submit the signed UserOp.
  const submitRes = await fetch('/a2a/session/deploy/submit', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
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
