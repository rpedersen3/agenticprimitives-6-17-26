// Persona-aware ENTITLED store (spec 252 Wave 2). STRICT least-privilege: each view holds ONLY what
// the active identity is entitled to. There is NO shared operational blob anymore — member-owned data
// (KC offerings, GCO needs) lives in each MEMBER's own vault (`member-vault.ts`), the broker holds only
// agreements + the bridged public demand, and a member browsing the marketplace sees only a COARSENED
// public projection of the other side.
//
// Source of truth is the MCP vault, NOT the browser (Wave 2; ADR-0013, one mechanism). `_view` is a
// transient in-memory CACHE — it is NEVER written to localStorage, and nothing here reads operational
// data back from the browser. `hydrate()` loads the active context's entitled datasets from the
// vault(s); `setActiveContext` re-hydrates when the persona (or its session) changes; agreement
// mutations write through to Jane's broker vault and re-hydrate. On reload the view is rebuilt from the
// vault, never from a stored blob.
//
//   jane : full broker view — every member's needs/offerings via their grants (UNCOARSENED, she's
//          entitled) ∪ bridged public demand; agreements from Jane's vault.
//   kc   : OWN offering (full, via its grant) + COARSENED public demand to browse; OWN agreements.
//   gco  : OWN needs (full, via its grant) + COARSENED public supply to browse; OWN agreements.
//   pete : agreements ONLY (issuance lifecycle) — NO member needs/offerings.

import type { Address } from '@agenticprimitives/types';
import type { ExpertOffering, GcoNeedIntent, GsIntentMatch } from '../domain/gs-types';
import {
  type AgreementStatusEvent, type GsAgreement, type GsConnectionStatus, canTransition,
} from '../domain/gs-status';
import type { Persona } from './personas';
import { caip10 } from './personas';
import type { MemberSession } from './session';
import { projectNeed, projectOffering, type DirNeed, type DirOffering } from './directory';
import { loadBrokerView, loadKcOffering, loadGcoNeeds, loadMembers } from './member-vault';
import { setKnownNames } from './names';
import { vaultRead, vaultWrite } from './vault-client';
import { switchboardVaultOwner } from './onchain';

// ── Vault record keys (Jane's broker vault) ──
const REC_AGREEMENTS = 'gs:broker:agreements'; // GsAgreement[]
const REC_BRIDGE = 'gs:broker:bridge'; // bridged GcoNeedIntent[] (the published public demand)

/** What the ACTIVE identity is entitled to see. `needs`/`offerings` are FULL only for the owner +
 *  Jane; members browsing the other side get `publicNeeds`/`publicOfferings` (coarsened projections). */
interface EntitledView {
  /** FULL needs the active identity owns or brokers (gco: own; jane: all members ∪ bridged). */
  needs: GcoNeedIntent[];
  /** FULL offerings the active identity owns or brokers (kc: own; jane: all members). */
  offerings: ExpertOffering[];
  /** Coarsened public demand a member browses (kc/gco). */
  publicNeeds: DirNeed[];
  /** Coarsened public supply a member browses (gco). */
  publicOfferings: DirOffering[];
  agreements: GsAgreement[];
}

const EMPTY: EntitledView = { needs: [], offerings: [], publicNeeds: [], publicOfferings: [], agreements: [] };

let _view: EntitledView = EMPTY;
let _ctx: { persona: Persona; session?: MemberSession | null } = { persona: 'jane' };
let _version = 0;
let _hydrated = false;
let _loadError: string | null = null;
const _subs = new Set<() => void>();

function bump(): void { _version += 1; for (const s of _subs) s(); }

export function subscribe(fn: () => void): () => void { _subs.add(fn); return () => _subs.delete(fn); }
export function version(): number { return _version; }
export const isHydrated = (): boolean => _hydrated;
export const loadError = (): string | null => _loadError;

// ── Active context + hydrate ──
let _hydrating: Promise<void> | null = null;

/** Switch the active identity (persona + its session) and re-hydrate the entitled view. */
export function setActiveContext(ctx: { persona: Persona; session?: MemberSession | null }): Promise<void> {
  _ctx = ctx;
  _hydrated = false;
  return hydrate(true);
}

/** Load the ACTIVE context's entitled datasets from the vault(s). Idempotent per context. */
export function hydrate(force = false): Promise<void> {
  if (_hydrating && !force) return _hydrating;
  _hydrating = (async () => {
    try {
      _view = await loadEntitledView(_ctx);
      _hydrated = true;
      _loadError = null;
      bump();
    } catch (e) {
      _loadError = e instanceof Error ? e.message : String(e);
      bump();
      throw e;
    } finally {
      _hydrating = null;
    }
  })();
  return _hydrating;
}

/** Jane's broker-vault agreements (the canonical agreement store). */
async function loadAgreements(): Promise<GsAgreement[]> {
  const owner = await switchboardVaultOwner();
  return (await vaultRead<GsAgreement[]>(owner, REC_AGREEMENTS)) ?? [];
}
async function saveAgreements(next: GsAgreement[]): Promise<void> {
  const owner = await switchboardVaultOwner();
  await vaultWrite(owner, REC_AGREEMENTS, next);
}

/** The bridged public demand (Switchboard's published feed), in Jane's vault. */
export async function loadBridgedNeeds(): Promise<GcoNeedIntent[]> {
  const owner = await switchboardVaultOwner();
  return (await vaultRead<GcoNeedIntent[]>(owner, REC_BRIDGE)) ?? [];
}
export async function saveBridgedNeeds(next: GcoNeedIntent[]): Promise<void> {
  const owner = await switchboardVaultOwner();
  await vaultWrite(owner, REC_BRIDGE, next);
}

/** Seed the sync name cache from Jane's member registry (display only). Jane-key, app-held. */
async function refreshKnownNames(): Promise<void> {
  try {
    const members = await loadMembers();
    setKnownNames(members.map((m) => ({
      sa: m.sa,
      label: m.kind === 'gco' ? `${m.orgName ?? m.name} (GCO)` : `${m.name} (KC)`,
    })));
  } catch { /* names are display-only; empty is fine */ }
}

const coarsenNeed = (n: GcoNeedIntent): DirNeed | null => projectNeed(n);
/** A browsing member never sees raw contact — strip it before projecting supply. */
const coarsenOffering = (o: ExpertOffering): DirOffering | null =>
  projectOffering({ ...o, confidentialContact: undefined });

async function loadEntitledView(ctx: { persona: Persona; session?: MemberSession | null }): Promise<EntitledView> {
  const { persona, session } = ctx;

  if (persona === 'pete') {
    // Issuer: agreements ONLY (no member needs/offerings).
    return { ...EMPTY, agreements: await loadAgreements() };
  }

  if (persona === 'jane') {
    // Broker: entitled to the FULL member view (via grants) ∪ the bridged public demand.
    await refreshKnownNames();
    const [broker, bridged, agreements] = await Promise.all([loadBrokerView(), loadBridgedNeeds(), loadAgreements()]);
    return {
      needs: [...broker.needs, ...bridged],
      offerings: broker.offerings,
      publicNeeds: [],
      publicOfferings: [],
      agreements,
    };
  }

  // A member (kc / gco) with no session yet → empty (the OnboardPanel shows).
  if (!session) return EMPTY;

  // The coarsened public feed a member browses is computed with Jane's anchor key (the app holds it):
  // load the broker view + bridged demand, then COARSEN — the member only ever SEES public data.
  const [broker, bridged, agreements] = await Promise.all([loadBrokerView(), loadBridgedNeeds(), loadAgreements()]);
  const publicNeeds = [...broker.needs, ...bridged].map(coarsenNeed).filter((x): x is DirNeed => x !== null);
  const publicOfferings = broker.offerings.map(coarsenOffering).filter((x): x is DirOffering => x !== null);

  if (persona === 'kc') {
    const offering = await loadKcOffering(session.grant);
    const mine = agreements.filter((a) => a.kcPersonAgentId.toLowerCase().includes(session.sa.toLowerCase()));
    return { needs: [], offerings: offering ? [offering] : [], publicNeeds, publicOfferings, agreements: mine };
  }

  // gco
  const needs = await loadGcoNeeds(session.grant);
  const mine = agreements.filter((a) => a.gcoOrgAgentId.toLowerCase().includes(session.sa.toLowerCase()));
  return { needs, offerings: [], publicNeeds, publicOfferings, agreements: mine };
}

// ── Reads (sync, from the entitled cache) ──
export const allNeeds = (): GcoNeedIntent[] => _view.needs;
export const allOfferings = (): ExpertOffering[] => _view.offerings;
export const allAgreements = (): GsAgreement[] => _view.agreements;
/** The COARSENED public demand a member browses (kc/gco directory). */
export const publicNeedEntries = (): DirNeed[] => _view.publicNeeds;
/** The COARSENED public supply a member browses (gco directory). */
export const publicOfferingEntries = (): DirOffering[] => _view.publicOfferings;
export const needById = (id: string) => _view.needs.find((n) => n.id === id);
export const offeringById = (id: string) => _view.offerings.find((o) => o.id === id);
export const agreementById = (id: string) => _view.agreements.find((a) => a.id === id);

// ── Agreement writes (Jane's broker vault; write-through + re-hydrate) ──
const nowIso = () => new Date().toISOString();

async function withAgreements(mut: (list: GsAgreement[]) => GsAgreement[] | null): Promise<void> {
  const list = await loadAgreements();
  const next = mut(list);
  if (next === null) return;
  await saveAgreements(next);
  await hydrate(true);
}

/** GCO requests a connection from a proposed match → creates a 'requested' Agreement.
 *  Needs `need` + `offering` from the entitled view (Jane brokers; she has both). */
export async function requestConnection(match: GsIntentMatch, actorPerson: Address): Promise<GsAgreement | null> {
  const need = needById(match.needId);
  const offering = offeringById(match.offeringId);
  if (!need || !offering) return null;
  const id = `gc:agreement:demo-gs:${match.id.split(':').pop()}`;
  let result: GsAgreement | null = null;
  await withAgreements((list) => {
    const existing = list.find((a) => a.id === id);
    if (existing) { result = existing; return null; }
    const event: AgreementStatusEvent = {
      id: `${id}:ev:0`, agreementId: id, nextStatus: 'requested',
      actorPersonAgentId: caip10(actorPerson), actingForOrgAgentId: need.ownerOrgAgentId,
      source: 'demo-gs', occurredAt: nowIso(),
      evidence: { needId: need.id, offeringId: offering.id, skillUris: need.requiredSkills.map((s) => s.gcUri), matchId: match.id },
    };
    result = {
      id, formalizesMatchId: match.id, gcoOrgAgentId: need.ownerOrgAgentId, kcPersonAgentId: offering.ownerPersonAgentId,
      needId: need.id, offeringId: offering.id, status: 'requested', statusEvents: [event],
      createdAt: nowIso(), updatedAt: nowIso(),
    };
    return [result, ...list];
  });
  return result;
}

/** KC accepts → 'confirmed' + contact release; or declines. */
export async function respondToRequest(agreementId: string, accept: boolean, actorPerson: Address): Promise<void> {
  // Resolve both parties' contacts from the BROKER view (Jane's app-held key) — the accepting KC's own
  // entitled view does NOT contain the GCO's need, so we can't read the GCO contact from `_view`. The
  // connection reveals each side's contact to the other only now, on accept.
  let contacts: { gco: string; kc: string } | null = null;
  if (accept) {
    const existing = (await loadAgreements()).find((x) => x.id === agreementId);
    if (existing) {
      const [broker, bridged] = await Promise.all([loadBrokerView(), loadBridgedNeeds()]);
      const need = [...broker.needs, ...bridged].find((n) => n.id === existing.needId);
      const offering = broker.offerings.find((o) => o.id === existing.offeringId);
      contacts = {
        gco: need?.confidentialContact ?? '(no contact on file)',
        kc: offering?.confidentialContact ?? '(no contact on file)',
      };
    }
  }
  await withAgreements((list) => {
    const a = list.find((x) => x.id === agreementId);
    if (!a || !canTransition(a.status, accept ? 'confirmed' : 'kc_declined')) return null;
    appendEvent(a, accept ? 'confirmed' : 'kc_declined', actorPerson, accept ? 'KC accepted the connection' : 'KC declined');
    if (accept && contacts) {
      a.releasedGcoContact = contacts.gco;
      a.releasedKcContact = contacts.kc;
      a.channelRef = { system: 'switchboard', channelId: `ch_${a.id.split(':').pop()}` };
    }
    return [...list];
  });
}

/** Append a provenance-bearing status transition (validated against the lifecycle). */
export async function transitionAgreement(agreementId: string, to: GsConnectionStatus, actorPerson: Address, reason?: string): Promise<boolean> {
  let ok = false;
  await withAgreements((list) => {
    const a = list.find((x) => x.id === agreementId);
    if (!a || !canTransition(a.status, to)) return null;
    appendEvent(a, to, actorPerson, reason);
    ok = true;
    return [...list];
  });
  return ok;
}

function appendEvent(a: GsAgreement, to: GsConnectionStatus, actorPerson: Address, reason?: string): void {
  const event: AgreementStatusEvent = {
    id: `${a.id}:ev:${a.statusEvents.length}`, agreementId: a.id, previousStatus: a.status, nextStatus: to,
    actorPersonAgentId: caip10(actorPerson), source: 'demo-gs', occurredAt: nowIso(), reason,
    evidence: { needId: a.needId, offeringId: a.offeringId, skillUris: needById(a.needId)?.requiredSkills.map((s) => s.gcUri) ?? [], matchId: a.formalizesMatchId },
  };
  a.statusEvents.push(event);
  a.status = to;
  a.updatedAt = nowIso();
  // Note: a need's open/closed status now lives on the MEMBER's own need record (their vault), not on
  // the broker. The broker tracks only the agreement lifecycle here.
}
