/**
 * Execute an arbitrary call from an already-deployed AgentAccount.
 *
 * The signer is a passkey bound to the AgentAccount (via its custodian
 * set). The paymaster sponsors gas. demo-a2a builds the userOp, the
 * caller signs the userOpHash via WebAuthn, demo-a2a submits.
 *
 * Mirrors the deploy-person.ts shape but uses the
 * /account/build-call-userop + /account/submit-call-userop endpoints
 * (existing PSA dispatching) instead of /session/deploy (new account
 * bootstrap).
 *
 * The `callData` arg is what the AgentAccount.execute(...) layer should
 * dispatch. Callers compose it via encodeFunctionData for the outer
 * `execute(target, value, data)` shape; this lib doesn\'t inspect it.
 */

import { encodeWebAuthnSignature } from '@agenticprimitives/agent-account';
import { encodeFunctionData, type Abi, type Address, type Hex, type WalletClient } from 'viem';
import { config } from '../config';
import { assertWithPasskey, type DemoPasskey } from './passkey';
import { csrfHeaders, ensureCsrfToken, CsrfError } from './csrf';

export interface ExecuteCallResult {
  ok: true;
  transactionHash: Hex;
  /** Block-explorer-friendly receipt; mirrors demo-a2a\'s response. */
  status?: string;
  /** The userOp\'s receipt logs if demo-a2a returned them. */
  logs?: { topics: Hex[]; data: Hex; address: Address }[];
}

export interface ExecuteCallError {
  ok: false;
  error: string;
  reason?: string;
}

type BuildCallResp = {
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

/**
 * Minimal AgentAccount.execute(target, value, data) ABI for callData
 * composition. The full ABI lives in @agenticprimitives/agent-account
 * but importing this fragment keeps the call-shape explicit at the
 * call site.
 */
const EXECUTE_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const satisfies Abi;

export function encodeExecuteCall(args: {
  target: Address;
  value: bigint;
  innerData: Hex;
}): Hex {
  return encodeFunctionData({
    abi: EXECUTE_ABI,
    functionName: 'execute',
    args: [args.target, args.value, args.innerData],
  });
}

export async function executeCallFromAgent(args: {
  /** The AgentAccount that signs + sends the call. */
  sender: Address;
  /** The passkey bound to `sender` via its custodian set. */
  passkey: DemoPasskey;
  /** Pre-composed AgentAccount.execute(...) calldata. */
  callData: Hex;
}): Promise<ExecuteCallResult | ExecuteCallError> {
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

  // 1. Build the userOp (sender + callData).
  const buildRes = await fetch(`${baseTrimmed}/account/build-call-userop`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ sender: args.sender, callData: args.callData }),
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
  const built = buildBody as unknown as BuildCallResp;

  // 2. Passkey-sign the userOpHash.
  let signature: Hex;
  try {
    const assertion = await assertWithPasskey(args.passkey, built.userOpHash);
    signature = encodeWebAuthnSignature(assertion);
  } catch (e) {
    return {
      ok: false,
      error: 'sign_failed',
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  // 3. Submit.
  const submitRes = await fetch(`${baseTrimmed}/account/submit-call-userop`, {
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
    transactionHash: submitBody.transactionHash as Hex,
    status: submitBody.status as string | undefined,
    logs: submitBody.logs as ExecuteCallResult['logs'],
  };
}

/**
 * EOA-signer variant of {@link executeCallFromAgent}. The AgentAccount is
 * custodied by an EOA (SIWE seat); the wallet signs the userOpHash via
 * `personal_sign`. demo-a2a's submit path verifies the raw-ECDSA branch
 * against the account's external-custodian set. Mirrors demo-web-pro.
 */
export async function executeCallFromAgentEoa(args: {
  sender: Address;
  walletClient: WalletClient;
  /** The EOA custodian of `sender`. */
  account: Address;
  callData: Hex;
}): Promise<ExecuteCallResult | ExecuteCallError> {
  const base = config.demoA2aUrl;
  if (!base) {
    return { ok: false, error: 'demo_a2a_url_unset', reason: 'VITE_DEMO_A2A_URL is not configured.' };
  }
  try {
    await ensureCsrfToken();
  } catch (e) {
    if (e instanceof CsrfError) return { ok: false, error: 'csrf_unavailable', reason: e.message };
    return { ok: false, error: 'csrf_unavailable', reason: e instanceof Error ? e.message : String(e) };
  }
  const baseTrimmed = base.replace(/\/$/, '');

  const buildRes = await fetch(`${baseTrimmed}/account/build-call-userop`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ sender: args.sender, callData: args.callData }),
  });
  if (buildRes.status === 409) {
    return { ok: false, error: 'paymaster_unavailable', reason: 'demo-a2a has no paymaster configured.' };
  }
  const buildBody = (await buildRes.json()) as Record<string, unknown>;
  if (!buildRes.ok || buildBody.ok !== true) {
    return {
      ok: false,
      error: typeof buildBody.error === 'string' ? buildBody.error : `HTTP ${buildRes.status}`,
      reason: typeof buildBody.detail === 'string' ? buildBody.detail : undefined,
    };
  }
  const built = buildBody as unknown as BuildCallResp;

  let signature: Hex;
  try {
    signature = await args.walletClient.signMessage({
      account: args.account,
      message: { raw: built.userOpHash },
    });
  } catch (e) {
    return { ok: false, error: 'sign_failed', reason: e instanceof Error ? e.message : String(e) };
  }

  const submitRes = await fetch(`${baseTrimmed}/account/submit-call-userop`, {
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
    transactionHash: submitBody.transactionHash as Hex,
    status: submitBody.status as string | undefined,
    logs: submitBody.logs as ExecuteCallResult['logs'],
  };
}
