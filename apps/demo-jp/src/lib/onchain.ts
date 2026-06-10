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

import type { Address, Hex } from '@agenticprimitives/types';
import { issuerAttestationDigest } from '@agenticprimitives/agreements';

import {
  CONTRACTS,
  CHAIN_ID,
  deployOrgSa,
  deriveOrgSaAddress,
  executeViaSa,
  executeBatchViaSa,
  personaSignHash,
  isContractDeployed,
  encodeRegisterAgreement,
  encodeAssertJointAgreement,
  type ExecuteResult,
} from './chain.js';
import { buildNameClaimCallData, buildNameClaimCalls, reverseName } from './naming.js';
import { loadOrMintOrgPersona, type OrgName, type OrgPersona } from './org-personas.js';
import { vaultRead, vaultWrite, type VaultOwner } from './vault-client.js';
import { issueAgreement } from './agreement-flow.js';
import type { JpAgreementPayload } from './agreement-payload.js';
import { issueAssociation, type JpAssociationBody } from './issuance-flow.js';
import { JP_SHAPES } from './jp-shapes.js';
import { CREDENTIAL_TYPE, jointConsentDigest, associationAttestationDigest, type Hex32 } from '@agenticprimitives/attestations';
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
  /** Reserved `<base>.impact` primary name (spec 247) — claimed at deploy, or for an
   *  already-deployed org on demand. Undefined until the name is claimed/resolved. */
  agentName?: string;
}

/** The `.impact` name base each org reserves on creation. Min 3 chars — the
 *  permissionless subregistry rejects shorter labels (so 'jp' → 'joshua-project'). */
const ORG_NAME_BASE: Record<OrgName, string> = { 'global-church': 'global-church', jp: 'joshua-project' };

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
  if (cached?.deployed && cached.agentName) return cached; // fully provisioned (deployed + named)

  const salt = ORG_SALT[name];
  const base = ORG_NAME_BASE[name];
  const custodian = persona.custodian.address;
  const saAddress = cached?.saAddress ?? (await deriveOrgSaAddress(custodian, salt));

  // Already on chain (e.g. created in a prior session) → adopt it rather than
  // re-deploying (which would revert), and reserve a `.impact` name if it doesn't
  // have one yet ("if these are already created, go get a name for them"). The name
  // claim is best-effort — the org is fully usable without it.
  if (await isContractDeployed(saAddress)) {
    let agentName = cached?.agentName ?? (await reverseName(saAddress)) ?? undefined;
    if (!agentName) {
      try {
        const { calls, name: claimed } = await buildNameClaimCalls(saAddress, base);
        const res = await executeBatchViaSa({ sender: saAddress, signHash: personaSignHash(persona.custodian), calls });
        if (res.ok) agentName = claimed;
      } catch {
        /* name reservation is best-effort for an already-deployed org */
      }
    }
    const adopted: OrgChainState = { name, custodian, saAddress, deployed: true, agentName };
    saveDeployState(adopted);
    return adopted;
  }

  // Fresh deploy → reserve + claim the `.impact` name atomically in the deploy userOp.
  const { callData, name: agentName } = await buildNameClaimCallData(saAddress, base);
  const res = await deployOrgSa({ custodian: persona.custodian, salt, callData });
  if (!res.ok || !res.deployedAddress) {
    // Persist the predicted address so the UI can show it pre-deploy.
    saveDeployState({ name, custodian, saAddress, deployed: false, agentName });
    throw new Error(res.error ?? 'org deploy failed');
  }
  const state: OrgChainState = {
    name,
    custodian,
    saAddress: res.deployedAddress,
    deployed: true,
    deployTxHash: res.txHash,
    agentName,
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

/** The Global Church Org vault owner (Pete custodian). GC is the ISSUER of agreements,
 *  so its issuance index is GC's own record — kept in GC's vault, read/written with
 *  Pete's key. Keeps GC's view strictly to data it owns + on-chain (not JP's vault). */
export function gcVaultOwner(): VaultOwner | null {
  const s = loadDeployState('global-church');
  if (!s?.deployed) return null;
  return { owner: s.saAddress, custodian: loadOrMintOrgPersona('global-church').custodian };
}

// ─── Issuance / registration orchestrations ─────────────────────────────────

export interface OnchainResult extends ExecuteResult {
  /** The deterministic id the registry assigned (commitment or attestation UID). */
  id?: Hex32;
}

/** Jill-as-JP issues a JpAssociationCredential to an org SA OFF-CHAIN: builds + JP-signs
 *  the credential (issuer = JP SA, subject = org SA). NO on-chain assertion — JP stores the
 *  signed credential in its own vault and delivers a copy to the org's vault. This is the
 *  recognition that gates brokering; it never touches the AttestationRegistry. */
export async function issueAssociationCredential(args: {
  subjectOrg: Address;
  body: JpAssociationBody;
  validFrom: string;
  validUntil?: string;
  salt: bigint;
}): Promise<{ credential: ReturnType<typeof issueAssociation>['credential']; credentialHash: Hex; issuerSignature: Hex; issuer: Address }> {
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
  // SC-2: the issuer signs the digest the contract recomputes (binds the subject) — not the raw hash.
  const issuerSignature = await personaSignHash(persona.custodian)(
    associationAttestationDigest({
      subject: issued.request.subject,
      issuer: jp.saAddress,
      schemaId: issued.request.schemaId,
      credentialType: issued.request.credentialType,
      credentialHash: issued.request.credentialHash,
      chainId: BigInt(CHAIN_ID),
      verifyingContract: CONTRACTS.attestationRegistry,
    }),
  );
  return { credential: issued.credential, credentialHash: issued.credentialHash as Hex, issuerSignature, issuer: jp.saAddress };
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
  // SC-1: the issuer signs the digest the contract RECOMPUTES from the agreement contents (+ chain +
  // registry) — not a free-form packed hash. A lifted signature can't back an attacker-chosen commitment.
  const issuerDigest = issuerAttestationDigest({
    agreementCommitment: issued.registryPayload.agreementCommitment,
    schemaHash: issued.registryPayload.schemaHash,
    issuer: gc.saAddress,
    chainId: BigInt(CHAIN_ID),
    verifyingContract: CONTRACTS.agreementRegistry,
  });
  const issuerSignature = await personaSignHash(persona.custodian)(issuerDigest);
  const data = encodeRegisterAgreement({
    ...issued.registryPayload,
    issuerSignature,
  });
  const res = await executeViaSa({
    sender: gc.saAddress,
    signHash: personaSignHash(persona.custodian),
    call: { to: CONTRACTS.agreementRegistry, data },
  });
  // Persist the issued credential (GC vault) so the two-party consent ceremony + the publish
  // step can recompute the JOINT_CONSENT digest and re-sign the issuer hash AFTER the page
  // reloads across each party's home redirect — the in-memory credential does not survive it.
  if (res.ok) {
    const gcOwner = gcVaultOwner();
    if (gcOwner) {
      await vaultWrite(gcOwner, agreementCredRecord(issued.registryPayload.agreementCommitment), issued.credential).catch(() => {});
    }
  }
  return { ...res, id: issued.registryPayload.agreementCommitment, issued };
}

// ─── Two-party consent (RW1-1 / ADR-0027) ────────────────────────────────────

/** GC-vault record key for a registered agreement's credential — needed to recompute the
 *  JOINT_CONSENT digest + re-sign the issuer hash at consent + publish time (survives reloads). */
export const agreementCredRecord = (commitment: Hex32): string =>
  `gc:agreement-cred:${commitment.toLowerCase()}`;

/** Load the persisted AgreementCredential for a registered commitment (GC vault). */
export async function loadAgreementCredential(
  commitment: Hex32,
): Promise<ReturnType<typeof issueAgreement>['credential'] | null> {
  const gcOwner = gcVaultOwner();
  if (!gcOwner) return null;
  return (
    (await vaultRead<ReturnType<typeof issueAgreement>['credential']>(gcOwner, agreementCredRecord(commitment))) ?? null
  );
}

/** The canonical consent digest each party signs (RW1-1). adopter = party1, facilitator = party2 —
 *  the exact order the AttestationRegistry recomputes + verifies against the two party signatures. */
export function consentDigestFor(args: {
  adopterParty: Address;
  facilitatorParty: Address;
  agreementCommitment: Hex32;
  credential: ReturnType<typeof issueAgreement>['credential'];
}): Hex32 {
  return jointConsentDigest({
    party1: args.adopterParty,
    party2: args.facilitatorParty,
    agreementCommitment: args.agreementCommitment,
    credentialHash: credentialHash(args.credential) as Hex32,
    // ATT-3 (audit 2026-06-10): the consent digest now binds chainId + the registry; must match what
    // AttestationRegistry.assertJointAgreement recomputes (block.chainid + address(this)).
    chainId: BigInt(CHAIN_ID),
    verifyingContract: CONTRACTS.attestationRegistry,
  }) as Hex32;
}

/** Pete-as-Global-Church publishes the bilateral joint-agreement assertion that
 *  back-points to the registered commitment row. RW1-1 (ADR-0027): the contract
 *  VERIFIES both party consent signatures over the JOINT_CONSENT digest
 *  (`jointConsentDigest(party1, party2, agreementCommitment, credentialHash)`);
 *  the two signatures are produced by each party at their home and supplied here. */
export async function submitJointAssertionOnChain(args: {
  credential: ReturnType<typeof issueAgreement>['credential'];
  party1: Address;
  party2: Address;
  agreementCommitment: Hex32;
  party1Signature: Hex;
  party2Signature: Hex;
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
    offchainCredentialStatusList: ZERO32,
    party1: args.party1,
    party2: args.party2,
    issuer: gc.saAddress,
    issuerSignature,
    party1Signature: args.party1Signature,
    party2Signature: args.party2Signature,
    salt: args.salt,
  });
  const res = await executeViaSa({
    sender: gc.saAddress,
    signHash: personaSignHash(persona.custodian),
    call: { to: CONTRACTS.attestationRegistry, data },
  });
  return { ...res };
}
