// Real Base Sepolia chain glue for the demo-jp substrate spine (Wave 8).
//
// The spine flows (intent-flow / agreement-flow / assertion-flow) produce
// commitment + credential + request payloads off-chain. THIS module is the
// single bridge to the live registries: it predicts + deploys org Smart
// Agents through the demo-a2a relayer, and routes every registry WRITE
// through the issuer org SA's `execute()` so msg.sender == the agent
// (ADR-0010) and the embedded issuer signature validates via the SA's
// ERC-1271 path (`AgentAccount._verifyEcdsa` tries the raw digest, then the
// eth-signed-message wrap — so a custodian `signMessage({ raw })` is accepted).
//
// Verified against packages/contracts/test/{Agreement,Attestation}Registry.t.sol:
//   - register / assertAssociation / assertJointAgreement are PERMISSIONLESS;
//     authorization is the issuer signature carried inside the payload.
//   - the issuer signs the RAW credentialHash (assoc/joint) or the RAW
//     attestationStructHash (agreement), NOT the VC EIP-712 digest.
//
// All relayer traffic goes through the `/a2a/*` Pages proxy → demo-a2a.

import {
  createPublicClient,
  http,
  encodeFunctionData,
  type Abi,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from '@agenticprimitives/types';
import { CONTRACTS as DEPLOYED } from '@agenticprimitives/contracts/deployments/base-sepolia';
import {
  AgreementRegistry as AGREEMENT_REGISTRY_JSON,
  AttestationRegistry as ATTESTATION_REGISTRY_JSON,
} from '@agenticprimitives/contracts/abi';
import { buildExecuteCallData } from '@agenticprimitives/agent-account';
import type {
  AgreementIssuancePayload,
} from '@agenticprimitives/agreements';
import type {
  AssociationAttestationRequest,
  JointAgreementAttestationRequest,
} from '@agenticprimitives/attestations';
import { ensureCsrfToken, csrfHeaders } from '../csrf.js';
import type { PersonaState } from './personas.js';

export const CHAIN_ID = 84532;

/** Public Base Sepolia RPC for reads. Override with VITE_RPC_URL. */
export const RPC_URL =
  (import.meta.env?.VITE_RPC_URL as string | undefined) ?? 'https://sepolia.base.org';

/** Deployed Base Sepolia contracts — single source is the contracts package's
 *  generated deployments module (a redeploy auto-propagates, R7.3). */
export const CONTRACTS = {
  agreementRegistry: DEPLOYED.agreementRegistry as Address,
  attestationRegistry: DEPLOYED.attestationRegistry as Address,
  shapeRegistry: DEPLOYED.shapeRegistry as Address,
  agentAccountFactory: DEPLOYED.agentAccountFactory as Address,
  entryPoint: DEPLOYED.entryPoint as Address,
  permissionlessSubregistry: DEPLOYED.permissionlessSubregistry as Address,
  agentNameRegistry: DEPLOYED.agentNameRegistry as Address,
  agentNameUniversalResolver: DEPLOYED.agentNameUniversalResolver as Address,
  // Delegation manager + enforcers — used to build the owner-issued vault
  // delegation (spec 247). The enforcers gate the off-chain MCP token, not an
  // on-chain redemption, so the vault delegation carries only timestamp + value.
  delegationManager: DEPLOYED.delegationManager as Address,
  timestampEnforcer: DEPLOYED.timestampEnforcer as Address,
  valueEnforcer: DEPLOYED.valueEnforcer as Address,
} as const;

export const AGREEMENT_REGISTRY_ABI = AGREEMENT_REGISTRY_JSON as Abi;
export const ATTESTATION_REGISTRY_ABI = ATTESTATION_REGISTRY_JSON as Abi;

let _client: ReturnType<typeof createPublicClient> | null = null;
/** Lazily-built viem public client (reads only). */
export function publicClient(): ReturnType<typeof createPublicClient> {
  if (!_client) {
    _client = createPublicClient({ transport: http(RPC_URL) });
  }
  return _client;
}

// ─── Signing ──────────────────────────────────────────────────────────────

export type SignHash = (hash: Hex) => Promise<Hex>;

/** A SignHash bound to a persona's stored EOA key. Produces an eth-signed-message
 *  ECDSA signature; the org SA's `_verifyEcdsa` eth-signed fallback recovers the
 *  custodian, and bare 65-byte sigs hit AgentAccount's legacy fast path. */
export function personaSignHash(persona: PersonaState): SignHash {
  const account = privateKeyToAccount(persona.privateKey);
  return (hash: Hex) => account.signMessage({ message: { raw: hash } }) as Promise<Hex>;
}

/** Sign an arbitrary STRING message (EIP-191 personal_sign) with a persona's key.
 *  Used for the spec-247 SIWE handoff (the SIWE message is a string, not a raw hash). */
export function personaSignMessage(persona: PersonaState): (message: string) => Promise<Hex> {
  const account = privateKeyToAccount(persona.privateKey);
  return (message: string) => account.signMessage({ message }) as Promise<Hex>;
}

// ─── Org SA deploy (via demo-a2a relayer) ───────────────────────────────────

/** Predict the factory CREATE2 address for an EOA-custodied (Mode-0) org SA. */
export async function deriveOrgSaAddress(custodian: Address, salt: bigint): Promise<Address> {
  await ensureCsrfToken();
  const res = await fetch('/a2a/account/derive-address', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ initMethod: 'eoa', owner: custodian, salt: salt.toString() }),
  });
  const j = (await res.json().catch(() => null)) as { smartAccountAddress?: Address; address?: Address; error?: string } | null;
  const addr = j?.smartAccountAddress ?? j?.address;
  if (!res.ok || !addr) throw new Error(j?.error ?? `derive-address failed (HTTP ${res.status})`);
  return addr;
}

export interface DeployResult {
  ok: boolean;
  deployedAddress?: Address;
  txHash?: Hex;
  error?: string;
}

/** Deploy a Mode-0 EOA-custodied org SA, optionally executing `callData` (e.g. a
 *  name-claim executeBatch) atomically in the same userOp. */
export async function deployOrgSa(args: {
  custodian: PersonaState;
  salt: bigint;
  callData?: Hex;
}): Promise<DeployResult> {
  await ensureCsrfToken();
  const buildRes = await fetch('/a2a/session/deploy', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({
      custodians: [args.custodian.address],
      salt: args.salt.toString(),
      ...(args.callData ? { callData: args.callData } : {}),
    }),
  });
  if (buildRes.status === 409) {
    return { ok: false, error: 'Gas sponsorship is not enabled on the relayer (paymaster).' };
  }
  const built = (await buildRes.json().catch(() => null)) as {
    ok?: boolean; sender?: Address; userOpHash?: Hex; userOp?: Record<string, unknown>; error?: string;
  } | null;
  if (!buildRes.ok || !built?.ok || !built.userOpHash || !built.userOp) {
    return { ok: false, error: built?.error ?? `deploy build failed (HTTP ${buildRes.status})` };
  }
  const signature = await personaSignHash(args.custodian)(built.userOpHash);
  const submitRes = await fetch('/a2a/session/deploy/submit', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ userOp: { ...built.userOp, signature } }),
  });
  const submitted = (await submitRes.json().catch(() => null)) as {
    ok?: boolean; deployedAddress?: Address; transactionHash?: Hex; error?: string; detail?: string;
  } | null;
  if (!submitRes.ok || !submitted?.ok || !submitted.deployedAddress) {
    return {
      ok: false,
      error: [submitted?.error, submitted?.detail].filter(Boolean).join(' — ') || `deploy submit failed (HTTP ${submitRes.status})`,
    };
  }
  return { ok: true, deployedAddress: submitted.deployedAddress, txHash: submitted.transactionHash };
}

// ─── Execute an arbitrary call FROM an org SA ───────────────────────────────

export interface ExecuteResult {
  ok: boolean;
  txHash?: Hex;
  error?: string;
}

/** Build → nonce-gate → sign once → submit a `sender.execute(to, value, data)`
 *  userOp through the relayer. Mirrors demo-org's executeCall (the post-deploy
 *  nonce-lag dance: poll the build until the relayer's nonce view reaches
 *  `minNonce`, then sign exactly once). */
export async function executeViaSa(args: {
  sender: Address;
  signHash: SignHash;
  call: { to: Address; value?: bigint; data: Hex };
  minNonce?: bigint;
  attempts?: number;
}): Promise<ExecuteResult> {
  const callData = buildExecuteCallData({ to: args.call.to, value: args.call.value ?? 0n, data: args.call.data });
  const attempts = args.attempts ?? 4;
  await ensureCsrfToken();
  let lastErr = 'execute failed';

  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2500));
    const buildRes = await fetch('/a2a/account/build-call-userop', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({ sender: args.sender, callData }),
    });
    const b = (await buildRes.json().catch(() => null)) as {
      ok?: boolean; userOpHash?: Hex; userOp?: Record<string, unknown> & { nonce?: string }; error?: string; detail?: string;
    } | null;
    if (!buildRes.ok || !b?.ok || !b.userOpHash || !b.userOp) {
      lastErr = [b?.error, b?.detail].filter(Boolean).join(' — ') || `build-call failed (HTTP ${buildRes.status})`;
      continue;
    }
    if (args.minNonce !== undefined && BigInt(b.userOp.nonce ?? '0') < args.minNonce) {
      lastErr = `relayer nonce ${b.userOp.nonce} < ${args.minNonce} — prior op not yet propagated`;
      continue;
    }
    const signature = await args.signHash(b.userOpHash);
    const submitRes = await fetch('/a2a/account/submit-call-userop', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({ userOp: { ...b.userOp, signature } }),
    });
    const submitted = (await submitRes.json().catch(() => null)) as { ok?: boolean; transactionHash?: Hex; error?: string; detail?: string } | null;
    if (submitRes.ok && submitted?.ok) return { ok: true, txHash: submitted.transactionHash };
    lastErr = [submitted?.error, submitted?.detail].filter(Boolean).join(' — ') || `submit-call failed (HTTP ${submitRes.status})`;
  }
  return { ok: false, error: lastErr };
}

// ─── Registry WRITES (issuer SA executes the permissionless registry call) ──

/** Encode AgreementRegistry.register(payload) calldata. */
export function encodeRegisterAgreement(p: AgreementIssuancePayload): Hex {
  return encodeFunctionData({
    abi: AGREEMENT_REGISTRY_ABI,
    functionName: 'register',
    args: [{
      schemaHash: p.schemaHash,
      issuer: p.issuer,
      attestationStructHash: p.attestationStructHash,
      issuerSignature: p.issuerSignature,
      agreementCommitment: p.agreementCommitment,
      partySetCommitment: p.partySetCommitment,
      issuerCommitment: p.issuerCommitment,
      termsCommitment: p.termsCommitment,
      scheduleCommitment: p.scheduleCommitment,
      salt: p.salt,
    }],
  });
}

/** Encode AttestationRegistry.assertAssociation(req) calldata. */
export function encodeAssertAssociation(req: AssociationAttestationRequest): Hex {
  return encodeFunctionData({
    abi: ATTESTATION_REGISTRY_ABI,
    functionName: 'assertAssociation',
    args: [{
      schemaId: req.schemaId,
      credentialType: req.credentialType,
      credentialHash: req.credentialHash,
      offchainCredentialStatusList: req.offchainCredentialStatusList,
      subject: req.subject,
      issuer: req.issuer,
      issuerSignature: req.issuerSignature,
      salt: req.salt,
    }],
  });
}

/** Encode AttestationRegistry.assertJointAgreement(req) calldata. */
export function encodeAssertJointAgreement(req: JointAgreementAttestationRequest): Hex {
  return encodeFunctionData({
    abi: ATTESTATION_REGISTRY_ABI,
    functionName: 'assertJointAgreement',
    args: [{
      schemaId: req.schemaId,
      credentialType: req.credentialType,
      credentialHash: req.credentialHash,
      refUID: req.refUID,
      bilateralConsentRef: req.bilateralConsentRef,
      offchainCredentialStatusList: req.offchainCredentialStatusList,
      party1: req.party1,
      party2: req.party2,
      issuer: req.issuer,
      issuerSignature: req.issuerSignature,
      salt: req.salt,
    }],
  });
}

// ─── Registry READS ─────────────────────────────────────────────────────────

export interface AgreementRow {
  agreementCommitment: Hex;
  schemaHash: Hex;
  issuer: Address;
  status: number;
  createdEpochBucket: bigint;
  lastTransitionEpochBucket: bigint;
}

/** Read an agreement row by commitment (status 0 == not registered). */
export async function getAgreementRecord(commitment: Hex): Promise<AgreementRow | null> {
  try {
    const r = (await publicClient().readContract({
      address: CONTRACTS.agreementRegistry,
      abi: AGREEMENT_REGISTRY_ABI,
      functionName: 'getRecord',
      args: [commitment],
    })) as AgreementRow;
    if (!r || Number(r.status) === 0) return null;
    return r;
  } catch {
    return null;
  }
}

/** Does an address already have contract code on chain? Used to skip a redundant
 *  (and reverting) deploy when the org SA exists but local state was cleared. */
export async function isContractDeployed(addr: Address): Promise<boolean> {
  try {
    const code = await publicClient().getCode({ address: addr });
    return !!code && code !== '0x';
  } catch {
    return false;
  }
}

/** Is an attestation UID currently valid (exists + not revoked)? */
export async function isAttestationValid(uid: Hex): Promise<boolean> {
  try {
    return (await publicClient().readContract({
      address: CONTRACTS.attestationRegistry,
      abi: ATTESTATION_REGISTRY_ABI,
      functionName: 'isValid',
      args: [uid],
    })) as boolean;
  } catch {
    return false;
  }
}

/** Base Sepolia explorer link for a tx / address. */
export function explorerTx(txHash: string): string {
  return `https://sepolia.basescan.org/tx/${txHash}`;
}
export function explorerAddress(addr: string): string {
  return `https://sepolia.basescan.org/address/${addr}`;
}
