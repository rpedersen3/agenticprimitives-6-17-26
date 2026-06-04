// App-local store (spec 250 Phase 0/1). localStorage-backed with vault-shaped seams: each
// accessor is the spot a real org-vault / person-vault / GC-graph adapter slots in later
// (Phase 2/3). Seeds from fixtures on first load so the broker board is never empty.
//
// Reactivity: a tiny version counter + subscribe(); App bumps + re-reads on every action.

import type { Address } from '@agenticprimitives/types';
import type { ExpertOffering, GcoNeedIntent, GsIntentMatch } from '../domain/gs-types';
import {
  type AgreementStatusEvent, type GsAgreement, type GsConnectionStatus, canTransition, isClosed,
} from '../domain/gs-status';
import { SEED_NEEDS, SEED_OFFERINGS } from '../data/fixtures';
import { caip10 } from './personas';

interface DbShape {
  needs: GcoNeedIntent[];
  offerings: ExpertOffering[];
  agreements: GsAgreement[];
  seeded: boolean;
}

const KEY = 'agenticprimitives:demo-gs:db:v1';

function load(): DbShape {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try { return JSON.parse(raw) as DbShape; } catch { /* fall through to seed */ }
    }
  }
  const seeded: DbShape = { needs: [...SEED_NEEDS], offerings: [...SEED_OFFERINGS], agreements: [], seeded: true };
  save(seeded);
  return seeded;
}

function save(db: DbShape): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(db));
}

let _db: DbShape = load();
let _version = 0;
const _subs = new Set<() => void>();

function commit(): void {
  save(_db);
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

// ── Reads ──
export const allNeeds = (): GcoNeedIntent[] => _db.needs;
export const allOfferings = (): ExpertOffering[] => _db.offerings;
export const allAgreements = (): GsAgreement[] => _db.agreements;
export const needById = (id: string) => _db.needs.find((n) => n.id === id);
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

/** Reset the demo data to fixtures (dev convenience). */
export function resetStore(): void {
  _db = { needs: [...SEED_NEEDS], offerings: [...SEED_OFFERINGS], agreements: [], seeded: true };
  commit();
}
