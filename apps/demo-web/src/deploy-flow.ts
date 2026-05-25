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
import type { SessionWallet } from './session-wallet';
import type { DemoPasskey } from './passkey-flow';
import { signWithPasskey } from './passkey-flow';
import { csrfHeaders } from './csrf';

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
 * Build → sign → submit (EOA path).
 *
 * Calls /session/deploy with the wallet's address as `owner`. The factory
 * embeds `createAccount(owner, salt)` in initCode. The wallet signs the
 * userOpHash via its SessionWallet adapter:
 *   - test wallet → raw 65-byte ECDSA (no EIP-191 prefix)
 *   - injected / walletconnect → personal_sign EIP-191-wrapped signature
 * Either format validates: AgentAccount._verifyEcdsa tries raw then
 * EIP-191 recovery (apps/contracts/src/AgentAccount.sol around line 956).
 */
export async function deploySmartAccount(
  wallet: SessionWallet,
  owner: Address,
): Promise<DeployResult | DeployFlowError> {
  return deployWithSigner({
    // `initMethod: 'eoa'` is REQUIRED: the worker only maps `owner` →
    // an EOA custodian when it's present (index.ts normalization).
    // Without it `custodians` stays empty and /session/deploy rejects
    // with "at least one of custodians[] or passkey must be supplied".
    // Mirrors the passkey path's `initMethod: 'passkey'`.
    body: { initMethod: 'eoa', owner },
    signUserOpHash: async (hash) => wallet.signHash({ hash }),
  });
}

/**
 * Build → sign → submit (passkey path — spec 130).
 *
 * Calls /session/deploy with `initMethod: 'passkey'` so the factory
 * embeds `createAccountWithPasskey(credentialIdDigest, x, y, salt)` in
 * initCode. The user signs the userOpHash via WebAuthn; the resulting
 * 0x01-prefixed blob is dispatched by AgentAccount._validateSig to
 * `_verifyWebAuthn`, which reads the freshly-initialized (x, y) from
 * PasskeyStorage and verifies the P-256 signature.
 */
export async function deploySmartAccountWithPasskey(
  passkey: DemoPasskey,
): Promise<DeployResult | DeployFlowError> {
  return deployWithSigner({
    body: {
      initMethod: 'passkey',
      credentialIdDigest: passkey.credentialIdDigest,
      pubKeyX: passkey.pubKeyX.toString(),
      pubKeyY: passkey.pubKeyY.toString(),
    },
    signUserOpHash: (hash) => signWithPasskey(hash),
  });
}

// ─── Shared deploy machinery ─────────────────────────────────────────

interface DeployArgs {
  body: Record<string, string | undefined>;
  signUserOpHash: (hash: Hex) => Promise<Hex>;
}

async function deployWithSigner(args: DeployArgs): Promise<DeployResult | DeployFlowError> {
  // 1. Ask backend for the unsigned UserOp + hash to sign.
  const buildRes = await fetch('/a2a/session/deploy', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(args.body),
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

  // 2. Sign the userOpHash. Signature wire format is signer-dependent
  //    (raw 65-byte ECDSA for EOA, 0x01-prefixed WebAuthn assertion
  //    for passkey) — the caller's signUserOpHash returns whatever the
  //    AgentAccount on-chain validation path expects.
  let signature: Hex;
  try {
    signature = await args.signUserOpHash(built.userOpHash);
  } catch (e) {
    return { ok: false, error: 'sign_failed', reason: e instanceof Error ? e.message : String(e) };
  }

  // 3. Submit the signed UserOp.
  const submitRes = await fetch('/a2a/session/deploy/submit', {
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
