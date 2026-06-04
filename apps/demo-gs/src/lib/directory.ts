// Directory / search projections (spec 250 §16 "public read surface", pilot doc "directory").
//
// The PUBLIC read projection of Needs + Offerings: a browsable, searchable list other apps (and any
// viewer) can join on. Privacy tiers are ENFORCED in the projection, not the UI:
//   • public / public-summary → shown (public anchor only — never confidential contact).
//   • confidential            → shown as a COARSENED anchor (skills kept, region coarsened, contact
//                               withheld, flagged "details on connection").
//   • sensitive               → ABSENCE: excluded from the directory entirely (aggregate-only).
// Sensitive geo (creative-access / closed) is collapsed to one coarse bucket — no specific geo leak.
//
// Pure functions over the store's arrays; no identity/contact is ever surfaced beyond the public tier.

import { categoryLabel, regionByUri } from '../data/taxonomy';
import { agentName } from './names';
import type { ExpertOffering, GcoNeedIntent, NeedKind, Uri } from '../domain/gs-types';

export interface DirSkill { uri: Uri; label: string; categoryUri: Uri }
export interface DirRegion { uri: Uri; label: string; coarsened: boolean }

interface DirBase {
  id: Uri;
  skills: DirSkill[];
  categoryUris: Uri[];
  regions: DirRegion[];
  causes: string[];
  languages: string[];
  ownerLabel: string;
}
export interface DirNeed extends DirBase {
  kind: 'need';
  title: string;
  needKind: NeedKind;
  confidential: boolean; // confidential-tier anchor (coarsened)
  bridged: boolean;
  commitmentLabel?: string;
}
export interface DirOffering extends DirBase {
  kind: 'offering';
  headline?: string;
  availability?: string;
}
export type DirEntry = DirNeed | DirOffering;

const SENSITIVE: DirRegion = { uri: 'sensitive', label: 'Sensitive region', coarsened: true };

/** Project a region facet, collapsing creative-access / closed regions to one coarse bucket. */
function projectRegion(uri: Uri, fallbackLabel: string): DirRegion {
  const reg = regionByUri(uri);
  const sens = reg?.sensitivity;
  if (sens === 'creative_access' || sens === 'closed') return SENSITIVE;
  return { uri, label: reg?.label ?? fallbackLabel, coarsened: false };
}

function dedupeRegions(rs: DirRegion[]): DirRegion[] {
  const seen = new Map<string, DirRegion>();
  for (const r of rs) if (!seen.has(r.uri)) seen.set(r.uri, r);
  return [...seen.values()];
}

function commitmentLabel(n: GcoNeedIntent): string | undefined {
  const c = n.commitment;
  if (!c) return undefined;
  const parts: string[] = [];
  if (c.hours) parts.push(`${c.hours}h${c.cadence === 'weekly' ? '/wk' : ''}`);
  if (c.durationWeeks) parts.push(`${c.durationWeeks} wks`);
  if (!parts.length && c.cadence) parts.push(c.cadence);
  if (!parts.length && c.notes) parts.push(c.notes);
  return parts.join(' · ') || undefined;
}

function needOwnerLabel(n: GcoNeedIntent): string {
  if (n.provenance?.source === 'switchboard-bridge') return n.provenance.sourceLabel ?? 'Global Switchboard (bridged)';
  const addr = String(n.ownerOrgAgentId).split(':').pop();
  return agentName(addr) ?? 'A GCO Organization';
}

/** Project a Need to its public directory entry, or null if it's sensitive (absence). */
export function projectNeed(n: GcoNeedIntent): DirNeed | null {
  if (n.visibility === 'sensitive') return null;
  const confidential = n.visibility === 'confidential';
  const skills = n.requiredSkills.map((s) => ({ uri: s.gcUri, label: s.label, categoryUri: s.categoryUri }));
  // A confidential anchor always coarsens geo; otherwise coarsen only the sensitive regions.
  const regions = dedupeRegions(n.geoFacets.map((g) => (confidential ? SENSITIVE : projectRegion(g.uri, g.label))));
  return {
    kind: 'need',
    id: n.id,
    title: n.title,
    needKind: n.needKind,
    skills,
    categoryUris: [...new Set(skills.map((s) => s.categoryUri))],
    regions,
    causes: (n.causeFacets ?? []).map((c) => c.label),
    languages: (n.languages ?? []).map((l) => l.label),
    ownerLabel: needOwnerLabel(n),
    confidential,
    bridged: n.provenance?.source === 'switchboard-bridge',
    commitmentLabel: commitmentLabel(n),
  };
}

/** Project an Offering to its public directory entry (public-summary: skills WITHOUT identity/contact). */
export function projectOffering(o: ExpertOffering): DirOffering | null {
  if (o.visibility === 'sensitive') return null;
  const skills = o.offeredSkills.map((s) => ({ uri: s.gcUri, label: s.label, categoryUri: s.categoryUri }));
  const regions = dedupeRegions((o.geoFacets ?? []).map((g) => projectRegion(g.uri, g.label)));
  return {
    kind: 'offering',
    id: o.id,
    headline: o.headline,
    skills,
    categoryUris: [...new Set(skills.map((s) => s.categoryUri))],
    regions,
    causes: (o.causeFacets ?? []).map((c) => c.label),
    languages: (o.languages ?? []).map((l) => l.label),
    // public-summary = discoverable WITHOUT identity; displayName is a public handle, never the SA/contact.
    ownerLabel: o.displayName ?? 'A Kingdom Consultant',
    availability: o.capacity?.availabilityStatus,
  };
}

/** Only OPEN needs + ACTIVE offerings are public (closed/draft drop out of the directory). */
const OPEN_NEED: GcoNeedIntent['status'][] = ['open', 'matched', 'requested'];

export function buildDirectory(needs: GcoNeedIntent[], offerings: ExpertOffering[]): DirEntry[] {
  const ns = needs.filter((n) => OPEN_NEED.includes(n.status)).map(projectNeed).filter((x): x is DirNeed => x !== null);
  const os = offerings.filter((o) => o.status === 'active').map(projectOffering).filter((x): x is DirOffering => x !== null);
  return [...ns, ...os];
}

export interface DirFilter {
  text?: string;
  kind?: 'all' | 'need' | 'offering';
  categoryUri?: Uri;
  regionUri?: Uri;
  cause?: string;
}

function entryText(e: DirEntry): string {
  const head = e.kind === 'need' ? e.title : (e.headline ?? '');
  return [head, e.ownerLabel, ...e.skills.map((s) => s.label), ...e.causes, ...e.regions.map((r) => r.label)]
    .join(' ').toLowerCase();
}

export function searchDirectory(entries: DirEntry[], f: DirFilter): DirEntry[] {
  const q = f.text?.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.kind && f.kind !== 'all' && e.kind !== f.kind) return false;
    if (f.categoryUri && !e.categoryUris.includes(f.categoryUri)) return false;
    if (f.regionUri && !e.regions.some((r) => r.uri === f.regionUri)) return false;
    if (f.cause && !e.causes.includes(f.cause)) return false;
    if (q && !entryText(e).includes(q)) return false;
    return true;
  });
}

export interface DirFacets {
  categories: { uri: Uri; label: string; n: number }[];
  regions: { uri: Uri; label: string; n: number }[];
  causes: { label: string; n: number }[];
}

/** Available facet values (with counts) across a set of entries — drives the filter chips. */
export function directoryFacets(entries: DirEntry[]): DirFacets {
  const cat = new Map<string, number>();
  const reg = new Map<string, { label: string; n: number }>();
  const cau = new Map<string, number>();
  for (const e of entries) {
    for (const c of e.categoryUris) cat.set(c, (cat.get(c) ?? 0) + 1);
    for (const r of e.regions) reg.set(r.uri, { label: r.label, n: (reg.get(r.uri)?.n ?? 0) + 1 });
    for (const c of e.causes) cau.set(c, (cau.get(c) ?? 0) + 1);
  }
  return {
    categories: [...cat.entries()].map(([uri, n]) => ({ uri, label: categoryLabel(uri), n })).sort((a, b) => b.n - a.n),
    regions: [...reg.entries()].map(([uri, v]) => ({ uri, label: v.label, n: v.n })).sort((a, b) => b.n - a.n),
    causes: [...cau.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
  };
}
