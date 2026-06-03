// Browser orchestration for the live spine (Wave 8) — the layer the operator
// dashboards (Pete / Jill) call. Composes the pure flow libs (issuance-flow,
// agreement-flow, assertion-flow + the @agenticprimitives commitment math)
// with the real-chain glue (chain.ts → demo-a2a relayer → Base Sepolia).
//
// Invariants honoured:
//   - The ISSUER org SA must be deployed before it can issue (its ERC-1271
//     validates the embedded issuer signature). `ensureOrgDeployed` gates this.
//   - Each registry write is the issuer SA executing the permissionless
//     registry call (msg.sender == the agent, ADR-0010).
//   - The issuer signs the RAW credentialHash / attestationStructHash with its
//     custodian EOA (chain.ts personaSignHash); the SA's _verifyEcdsa validates.

import { keccak256, encodePacked } from 'viem';
import type { Address, Hex } from '@agenticprimitives/types';

import {
  CONTRACTS,
  deployOrgSa,
  deriveOrgSaAddress,
  executeViaSa,
  personaSignHash,
  isContractDeployed,
  encodeRegisterAgreement,
  encodeAssertAssociation,
  encodeAssertJointAgreement,
  type ExecuteResult,
} from './chain.js';
import { loadOrMintOrgPersona, type OrgName, type OrgPersona } from './org-personas.js';
import type { VaultOwner } from './vault-client.js';
import { issueAgreement } from './agreement-flow.js';
import type { JpAgreementPayload } from './agreement-payload.js';
import { issueAssociation, type JpAssociationBody } from './issuance-flow.js';
import { JP_SHAPES } from './jp-shapes.js';
import { CREDENTIAL_TYPE, type Hex32 } from '@agenticprimitives/attestations';
import { credentialHash } from '@agenticprimitives/verifiable-credentials';

const ZERO32 = ('0x' + '00'.repeat(32)) as Hex32;

// ─── Org SA deploy state (the canonical factory address, cached) ────────────

export interface OrgChainState {
  name: OrgName;
  custodian: Address;
  /** Factory CREATE2 address (canonical org SA address). */
  saAddress: Address;
  deployed: boolean;
  deployTxHash?: Hex;
}

/** Stable per-org salt (D-5: address reproduces across reloads). Salt 0 under each
 *  custodian EOA is RESERVED for that operator's own PERSON SA (spec 247 — it matches
 *  demo-sso's SIWE derivation `{mode:0, custodians:[eoa], salt:0}`), so the org SAs sit
 *  at salt 1. GC + JP are under different custodians (Pete / Jill), so both can be 1n. */
const ORG_SALT: Record<OrgName, bigint> = { 'global-church': 1n, jp: 1n };

// Org-deploy state is DERIVED FROM CHAIN (spec 247): the SA address is the
// deterministic CREATE2 prediction, and "deployed" is `isContractDeployed` (a
// chain read) — not persisted in localStorage. This module-level map is a pure
// per-session transient hint so the sync `orgChainState`/`jpVaultOwner` accessors
// have an answer after `ensureOrgDeployed` has run; it's rebuilt from chain on
// reload (the deploy card + panels call `ensureOrgDeployed` on mount).
const _deployCache = new Map<OrgName, OrgChainState>();

function loadDeployState(name: OrgName): OrgChainState | null {
  return _deployCache.get(name) ?? null;
}

function saveDeployState(s: OrgChainState): void {
  _deployCache.set(s.name, s);
}

/** Resolve the canonical (factory-derived) org SA address, deploying if needed.
 *  Idempotent: a cached deployed state short-circuits. Concurrent callers (the
 *  deploy card + each broker panel on mount) share ONE in-flight deploy via the
 *  promise cache below — otherwise they'd each pass the not-yet-deployed check and
 *  race two deploys (nonce conflict / duplicate). Returns the chain state. */
const _inflight = new Map<OrgName, Promise<OrgChainState>>();
export function ensureOrgDeployed(name: OrgName): Promise<OrgChainState> {
  const existing = _inflight.get(name);
  if (existing) return existing;
  const p = _ensureOrgDeployed(name).finally(() => _inflight.delete(name));
  _inflight.set(name, p);
  return p;
}

async function _ensureOrgDeployed(name: OrgName): Promise<OrgChainState> {
  const persona: OrgPersona = loadOrMintOrgPersona(name);
  const cached = loadDeployState(name);
  if (cached?.deployed) return cached;

  const salt = ORG_SALT[name];
  const saAddress = cached?.saAddress ?? (await deriveOrgSaAddress(persona.custodian.address, salt));

  // If the SA already has code on chain (e.g. local state was cleared), adopt it
  // rather than re-deploying (which would revert). One canonical check, no fallback.
  if (await isContractDeployed(saAddress)) {
    const adopted: OrgChainState = { name, custodian: persona.custodian.address, saAddress, deployed: true };
    saveDeployState(adopted);
    return adopted;
  }

  const res = await deployOrgSa({ custodian: persona.custodian, salt });
  if (!res.ok || !res.deployedAddress) {
    // Persist the predicted address so the UI can show it pre-deploy.
    const pending: OrgChainState = { name, custodian: persona.custodian.address, saAddress, deployed: false };
    saveDeployState(pending);
    throw new Error(res.error ?? 'org deploy failed');
  }
  const state: OrgChainState = {
    name,
    custodian: persona.custodian.address,
    saAddress: res.deployedAddress,
    deployed: true,
    deployTxHash: res.txHash,
  };
  saveDeployState(state);
  return state;
}

/** Predicted (not-yet-deployed) address for display, without a deploy. */
export async function predictOrgAddress(name: OrgName): Promise<Address> {
  const cached = loadDeployState(name);
  if (cached?.saAddress) return cached.saAddress;
  const persona = loadOrMintOrgPersona(name);
  const addr = await deriveOrgSaAddress(persona.custodian.address, ORG_SALT[name]);
  saveDeployState({ name, custodian: persona.custodian.address, saAddress: addr, deployed: false });
  return addr;
}

export function orgChainState(name: OrgName): OrgChainState | null {
  return loadDeployState(name);
}

/** The JP Org vault owner (Jill custodian) for spec-247 vault reads/writes — null
 *  until JP is deployed + cached. JP is the data custodian (spec 236), so all
 *  JP-program records (broker state + member records) live in JP's vault, keyed by
 *  record_type and written/read with Jill's custodian key (held in the demo browser). */
export function jpVaultOwner(): VaultOwner | null {
  const s = loadDeployState('jp');
  if (!s?.deployed) return null;
  return { owner: s.saAddress, custodian: loadOrMintOrgPersona('jp').custodian };
}

// ─── Issuance / registration orchestrations ─────────────────────────────────

export interface OnchainResult extends ExecuteResult {
  /** The deterministic id the registry assigned (commitment or attestation UID). */
  id?: Hex32;
}

/** Jill-as-JP issues a JpAssociationCredential to an org SA + publishes the
 *  on-chain Association assertion (subject = org SA, issuer = JP SA). */
export async function issueAssociationOnChain(args: {
  subjectOrg: Address;
  body: JpAssociationBody;
  validFrom: string;
  validUntil?: string;
  salt: bigint;
}): Promise<OnchainResult & { credential: ReturnType<typeof issueAssociation>['credential'] }> {
  const jp = await ensureOrgDeployed('jp');
  const persona = loadOrMintOrgPersona('jp');
  const issued = issueAssociation({
    issuerCaip10: `eip155:84532:${jp.saAddress}`,
    issuer: jp.saAddress,
    subjectOrg: args.subjectOrg,
    body: args.body,
    validFrom: args.validFrom,
    validUntil: args.validUntil,
    salt: args.salt,
  });
  const issuerSignature = await personaSignHash(persona.custodian)(issued.credentialHash);
  const data = encodeAssertAssociation({ ...issued.request, issuerSignature });
  const res = await executeViaSa({
    sender: jp.saAddress,
    signHash: personaSignHash(persona.custodian),
    call: { to: CONTRACTS.attestationRegistry, data },
  });
  return { ...res, id: issued.predictedUid, credential: issued.credential };
}

/** Pete-as-Global-Church registers a two-party agreement commitment. */
export async function registerAgreementOnChain(args: {
  party1: Address;
  party2: Address;
  payload: JpAgreementPayload;
  salt: bigint;
}): Promise<OnchainResult & { issued: ReturnType<typeof issueAgreement> }> {
  const gc = await ensureOrgDeployed('global-church');
  const persona = loadOrMintOrgPersona('global-church');
  const issued = issueAgreement({
    party1: args.party1,
    party2: args.party2,
    issuer: gc.saAddress,
    issuerCaip10: `eip155:84532:${gc.saAddress}`,
    payload: args.payload,
    salt: args.salt,
  });
  // attestationStructHash = keccak256(abi.encodePacked(agreementCommitment, schemaHash))
  const attestationStructHash = keccak256(
    encodePacked(['bytes32', 'bytes32'], [issued.registryPayload.agreementCommitment, issued.registryPayload.schemaHash]),
  ) as Hex32;
  const issuerSignature = await personaSignHash(persona.custodian)(attestationStructHash);
  const data = encodeRegisterAgreement({
    ...issued.registryPayload,
    attestationStructHash,
    issuerSignature,
  });
  const res = await executeViaSa({
    sender: gc.saAddress,
    signHash: personaSignHash(persona.custodian),
    call: { to: CONTRACTS.agreementRegistry, data },
  });
  return { ...res, id: issued.registryPayload.agreementCommitment, issued };
}

/** Pete-as-Global-Church publishes the bilateral joint-agreement assertion that
 *  back-points to the registered commitment row. */
export async function submitJointAssertionOnChain(args: {
  credential: ReturnType<typeof issueAgreement>['credential'];
  party1: Address;
  party2: Address;
  agreementCommitment: Hex32;
  bilateralConsentRef: Hex32;
  salt: bigint;
}): Promise<OnchainResult> {
  const gc = await ensureOrgDeployed('global-church');
  const persona = loadOrMintOrgPersona('global-church');
  // Sign the credential body hash (raw) — same path the registry verifies.
  const ch = credentialHash(args.credential) as Hex32;
  const issuerSignature = await personaSignHash(persona.custodian)(ch);
  const data = encodeAssertJointAgreement({
    schemaId: JP_SHAPES.agreement.hash,
    credentialType: CREDENTIAL_TYPE.JointAgreement,
    credentialHash: ch,
    refUID: args.agreementCommitment,
    bilateralConsentRef: args.bilateralConsentRef,
    offchainCredentialStatusList: ZERO32,
    party1: args.party1,
    party2: args.party2,
    issuer: gc.saAddress,
    issuerSignature,
    salt: args.salt,
  });
  const res = await executeViaSa({
    sender: gc.saAddress,
    signHash: personaSignHash(persona.custodian),
    call: { to: CONTRACTS.attestationRegistry, data },
  });
  return { ...res };
}
