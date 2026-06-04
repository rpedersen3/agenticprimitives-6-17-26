// Broker operational store (spec 252 Wave 1). The board data — needs / offerings / agreements — is
// the BROKER's (Jane / Switchboard) operational view, and now lives in the Switchboard org's per-agent
// MCP vault (record `gs:broker:store`), NOT localStorage. Cross-browser + delegation-gated.
//
// ONE mechanism (ADR-0013): the vault is the source of truth; `_db` is an in-memory CACHE of it.
// `hydrate()` loads the vault on app start (deploying the Switchboard SA on first run); every mutation
// write-throughs to the vault. The fixtures seed the vault ONLY when it is empty (first run) — they are
// never a fallback when the vault is unreachable (that surfaces as `loadError`, not silent local data).
//
// (Wave 2 splits member-owned records — KC offerings, GCO needs — into each member's OWN vault; for now
// the broker holds the whole operational set.)

import type { Address } from '@agenticprimitives/types';
import type { ExpertOffering, GcoNeedIntent, GsIntentMatch } from '../domain/gs-types';
import {
  type AgreementStatusEvent, type GsAgreement, type GsConnectionStatus, canTransition, isClosed,
} from '../domain/gs-status';
import { SEED_NEEDS, SEED_OFFERINGS } from '../data/fixtures';
import { caip10 } from './personas';
import { vaultRead, vaultWrite } from './vault-client';
import { switchboardVaultOwner } from './onchain';

interface DbShape {
  needs: GcoNeedIntent[];
  offerings: ExpertOffering[];
  agreements: GsAgreement[];
}

const RECORD = 'gs:broker:store';

function seed(): DbShape {
  return { needs: [...SEED_NEEDS], offerings: [...SEED_OFFERINGS], agreements: [] };
}

// In-memory cache of the broker vault. Seeded so the UI renders instantly; replaced by the vault's
// canonical copy once `hydrate()` resolves.
let _db: DbShape = seed();
let _version = 0;
let _hydrated = false;
let _loadError: string | null = null;
const _subs = new Set<() => void>();

function bump(): void {
  _version += 1;
  for (const s of _subs) s();
}

export function subscribe(fn: () => void): () => void {
  _subs.add(fn);
  return () => _subs.delete(fn);
}
export function version(): number {
  return _version;
}
export const isHydrated = (): boolean => _hydrated;
export const loadError = (): string | null => _loadError;

// ── Vault hydrate + write-through (the single mechanism) ──
let _hydrating: Promise<void> | null = null;

/** Load the broker store from the Switchboard vault (deploying the SA on first run). Idempotent. */
export function hydrate(): Promise<void> {
  if (_hydrating) return _hydrating;
  _hydrating = (async () => {
    try {
      const owner = await switchboardVaultOwner();
      const stored = await vaultRead<DbShape>(owner, RECORD);
      if (stored && Array.isArray(stored.needs)) {
        _db = stored;
      } else {
        await vaultWrite(owner, RECORD, _db); // first run — seed the vault from fixtures
      }
      _hydrated = true;
      _loadError = null;
      bump();
    } catch (e) {
      _loadError = e instanceof Error ? e.message : String(e);
      bump();
      throw e;
    }
  })();
  return _hydrating;
}

async function persist(): Promise<void> {
  try {
    const owner = await switchboardVaultOwner();
    await vaultWrite(owner, RECORD, _db);
    if (_loadError) { _loadError = null; bump(); }
  } catch (e) {
    _loadError = e instanceof Error ? e.message : String(e);
    bump();
  }
}

/** Re-render now (cache changed); write the new state through to the vault. */
function commit(): void {
  bump();
  void persist();
}

// ── Reads (sync, from the cache) ──
export const allNeeds = (): GcoNeedIntent[] => _db.needs;
export const allOfferings = (): ExpertOffering[] => _db.offerings;
export const allAgreements = (): GsAgreement[] => _db.agreements;
export const needById = (id: string) => _db.needs.find((n) => n.id === id);
/** Needs imported via the Pattern-A Switchboard read bridge (provenance-tagged). */
export const bridgedNeeds = (): GcoNeedIntent[] => _db.needs.filter((n) => n.provenance?.source === 'switchboard-bridge');
export const offeringById = (id: string) => _db.offerings.find((o) => o.id === id);
export const agreementById = (id: string) => _db.agreements.find((a) => a.id === id);

/** Needs owned by an org agent (the GCO view). */
export const needsForOrg = (org: Address) =>
  _db.needs.filter((n) => n.ownerOrgAgentId === caip10(org) || n.ownerOrgAgentId === org);
/** Offerings owned by a person agent (the KC view). */
export const offeringsForPerson = (person: Address) =>
  _db.offerings.filter((o) => o.ownerPersonAgentId === caip10(person) || o.ownerPersonAgentId === person);

// ── Writes ──
const nowIso = () => new Date().toISOString();

export function upsertNeed(n: GcoNeedIntent): void {
  const i = _db.needs.findIndex((x) => x.id === n.id);
  if (i >= 0) _db.needs[i] = n; else _db.needs.unshift(n);
  commit();
}
export function upsertOffering(o: ExpertOffering): void {
  const i = _db.offerings.findIndex((x) => x.id === o.id);
  if (i >= 0) _db.offerings[i] = o; else _db.offerings.unshift(o);
  commit();
}

function setNeedStatus(needId: string, status: GcoNeedIntent['status']): void {
  const n = needById(needId);
  if (n) { n.status = status; n.updatedAt = nowIso(); }
}

/** GCO requests a connection from a proposed match → creates a 'requested' Agreement. */
export function requestConnection(match: GsIntentMatch, actorPerson: Address): GsAgreement {
  const need = needById(match.needId)!;
  const offering = offeringById(match.offeringId)!;
  const id = `gc:agreement:demo-gs:${match.id.split(':').pop()}`;
  const existing = agreementById(id);
  if (existing) return existing;
  const event: AgreementStatusEvent = {
    id: `${id}:ev:0`, agreementId: id, nextStatus: 'requested',
    actorPersonAgentId: caip10(actorPerson), actingForOrgAgentId: need.ownerOrgAgentId,
    source: 'demo-gs', occurredAt: nowIso(),
    evidence: { needId: need.id, offeringId: offering.id, skillUris: need.requiredSkills.map((s) => s.gcUri), matchId: match.id },
  };
  const agreement: GsAgreement = {
    id, formalizesMatchId: match.id, gcoOrgAgentId: need.ownerOrgAgentId, kcPersonAgentId: offering.ownerPersonAgentId,
    needId: need.id, offeringId: offering.id, status: 'requested', statusEvents: [event],
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  _db.agreements.unshift(agreement);
  setNeedStatus(need.id, 'requested');
  commit();
  return agreement;
}

/** KC accepts → 'confirmed' + contact release; or declines. */
export function respondToRequest(agreementId: string, accept: boolean, actorPerson: Address): void {
  const a = agreementById(agreementId);
  if (!a) return;
  const to: GsConnectionStatus = accept ? 'confirmed' : 'kc_declined';
  transitionAgreement(agreementId, to, actorPerson, accept ? 'KC accepted the connection' : 'KC declined');
  if (accept) {
    const need = needById(a.needId);
    const offering = offeringById(a.offeringId);
    a.releasedGcoContact = need?.confidentialContact ?? '(no contact on file)';
    a.releasedKcContact = offering?.confidentialContact ?? '(no contact on file)';
    a.channelRef = { system: 'switchboard', channelId: `ch_${a.id.split(':').pop()}` };
    setNeedStatus(a.needId, 'agreement_active');
    commit();
  }
}

/** Append a provenance-bearing status transition (validated against the lifecycle). */
export function transitionAgreement(agreementId: string, to: GsConnectionStatus, actorPerson: Address, reason?: string): boolean {
  const a = agreementById(agreementId);
  if (!a || !canTransition(a.status, to)) return false;
  const event: AgreementStatusEvent = {
    id: `${a.id}:ev:${a.statusEvents.length}`, agreementId: a.id, previousStatus: a.status, nextStatus: to,
    actorPersonAgentId: caip10(actorPerson), source: 'demo-gs', occurredAt: nowIso(), reason,
    evidence: { needId: a.needId, offeringId: a.offeringId, skillUris: needById(a.needId)?.requiredSkills.map((s) => s.gcUri) ?? [], matchId: a.formalizesMatchId },
  };
  a.statusEvents.push(event);
  a.status = to;
  a.updatedAt = nowIso();
  if (isClosed(to)) setNeedStatus(a.needId, to === 'fulfilled' ? 'fulfilled' : 'open');
  commit();
  return true;
}

/** Reset the broker store to fixtures (writes through to the vault). */
export function resetStore(): void {
  _db = seed();
  commit();
}
