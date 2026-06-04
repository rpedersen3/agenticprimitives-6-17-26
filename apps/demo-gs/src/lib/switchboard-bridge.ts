// Pattern-A Switchboard read bridge (spec 250 §"Deferred", Global Switchboard × Global.Church pilot).
//
// READ-ONLY ETL: external Switchboard "Role" postings → our gc:Need (`GcoNeedIntent`), joined on the
// shared 22-cat/193-skill SKOS taxonomy. Switchboard stays the system of record; we never write back.
// The payoff: cross-app demand shows up on the broker's match board + public signal and scores against
// KC Offerings by CONCEPT identity, not string overlap.
//
// App-layer by design (ADR-0021): the bridge knows Switchboard's external vocabulary; the generic
// packages do not. Three mapping outcomes, all explicit: exact-slug, alias (Switchboard vocab drift),
// and UNMAPPED — surfaced on the Need's provenance, never silently dropped (ADR-0013 spirit).

import { keccak256, toBytes } from 'viem';
import type { Address } from '@agenticprimitives/types';
import type { CauseRef, Commitment, GcoNeedIntent, GeoFacet, LanguageRef, NeedKind, SkillRef, Uri } from '../domain/gs-types';
import { CAUSES, LANGUAGES, REGIONS, SKILLS, skillByUri } from '../data/taxonomy';
import type { SwitchboardRole } from '../data/switchboard-roles';
import { caip10 } from './personas';
import { hydrate, loadBridgedNeeds, saveBridgedNeeds } from './store';

const SKILL_BASE = 'https://registry.global.church/skills/switchboard/';
const REGION_BASE = 'https://registry.global.church/regions/';
const CAUSE_BASE = 'https://registry.global.church/causes/';

// ── Vocabulary alignment (Switchboard slug → our canonical slug) ──
// Where Switchboard's taxonomy uses a different label for the same concept. Identity-mapped slugs
// need no entry — the lookup falls back to the slug itself.
const SKILL_ALIASES: Record<string, string> = {
  videography: 'video-production',
  translation: 'document-translation',
  webdev: 'web-development',
  coaching: 'executive-coaching',
  fundraising: 'major-gifts-strategy',
  gis: 'gis-mapping',
};
const REGION_ALIASES: Record<string, string> = {
  ssa: 'sub-saharan-africa',
  mena: 'middle-east',
  'north-africa': 'north-africa',
  remote: 'global',
  worldwide: 'global',
};

const skillByGcUri = new Map(SKILLS.map((s) => [s.gcUri, s] as const));

/** Map one Switchboard skill slug → a canonical SkillRef (exact slug, then alias). null = unmapped. */
function mapSkill(slug: string): SkillRef | null {
  const canonical = SKILL_ALIASES[slug] ?? slug;
  return skillByGcUri.get(`${SKILL_BASE}${canonical}`) ?? null;
}

function mapRegion(slug?: string): GeoFacet | null {
  if (!slug) return null;
  const canonical = REGION_ALIASES[slug] ?? slug;
  return REGIONS.find((r) => r.uri === `${REGION_BASE}${canonical}`) ?? null;
}

function mapCause(slug?: string): CauseRef | null {
  if (!slug) return null;
  return CAUSES.find((c) => c.uri === `${CAUSE_BASE}${slug}`) ?? null;
}

function mapLanguages(codes?: string[]): LanguageRef[] {
  if (!codes) return [];
  const out: LanguageRef[] = [];
  for (const c of codes) {
    const lc = c.toLowerCase();
    const hit = LANGUAGES.find((l) => l.code === lc || l.label.toLowerCase() === lc);
    if (hit) out.push(hit);
  }
  return out;
}

const KINDS: NeedKind[] = ['discussion', 'project', 'role', 'inquiry'];
function mapKind(engagementType: string): NeedKind {
  return (KINDS as string[]).includes(engagementType) ? (engagementType as NeedKind) : 'role';
}

/** A deterministic pseudo-agent for an imported Switchboard organization (no real SA — bridge-scoped). */
export function bridgeOrgAgent(orgName: string): Address {
  return `0x${keccak256(toBytes(`demo-gs/switchboard-bridge-org/v1|${orgName}`)).slice(-40)}` as Address;
}
/** The system importer identity that "creates" bridged Needs. */
export const SWITCHBOARD_BRIDGE_IMPORTER: Address = `0x${keccak256(toBytes('demo-gs/switchboard-bridge-importer/v1')).slice(-40)}` as Address;

/** Stable Need id for a Switchboard role (idempotent re-import). */
export const bridgedNeedId = (roleId: string): Uri => `gc:need:switchboard:${roleId}`;

export interface RoleMapResult {
  need: GcoNeedIntent;
  mappedSkills: SkillRef[];
  unmappedSkills: string[];
  region: GeoFacet | null;
  unmappedRegion?: string;
}

/** Pure: translate one Switchboard Role → a gc:Need + a record of what mapped vs. didn't. */
export function roleToNeed(role: SwitchboardRole, importedAt: string): RoleMapResult {
  const mappedSkills: SkillRef[] = [];
  const unmappedSkills: string[] = [];
  for (const slug of role.skills) {
    const s = mapSkill(slug);
    if (s) mappedSkills.push(s); else unmappedSkills.push(slug);
  }
  const region = mapRegion(role.region);
  const unmappedRegion = role.region && !region ? role.region : undefined;
  const cause = mapCause(role.cause);

  // Privacy tier: Switchboard roles are public postings, but a creative-access / closed region
  // coarsens the public anchor to confidential (matches the fixtures' sensitive-region behavior).
  const sensitive = region?.sensitivity === 'creative_access' || region?.sensitivity === 'closed';

  const need: GcoNeedIntent = {
    id: bridgedNeedId(role.id),
    ownerOrgAgentId: caip10(bridgeOrgAgent(role.organization.name)),
    createdByPersonAgentId: caip10(SWITCHBOARD_BRIDGE_IMPORTER),
    title: role.title,
    description: `${role.summary}\n\nImported from Global Switchboard · ${role.organization.name}.`,
    needKind: mapKind(role.engagementType),
    requiredSkills: mappedSkills,
    geoFacets: region ? [region] : [],
    causeFacets: cause ? [cause] : [],
    languages: mapLanguages(role.languages),
    commitment: role.commitment
      ? { hours: role.commitment.hoursPerWeek, durationWeeks: role.commitment.weeks, cadence: role.commitment.cadence as Commitment['cadence'] }
      : undefined,
    visibility: sensitive ? 'confidential' : 'public',
    confidentialContact: role.contactEmail ? `${role.contactEmail} (confidential)` : undefined,
    status: 'open',
    provenance: {
      source: 'switchboard-bridge',
      sourceUri: role.url ?? `switchboard:role:${role.id}`,
      sourceLabel: `Global Switchboard · ${role.organization.name}`,
      importedAt,
      unmapped: (unmappedSkills.length || unmappedRegion) ? { skills: unmappedSkills.length ? unmappedSkills : undefined, region: unmappedRegion } : undefined,
    },
    createdAt: role.postedAt,
    updatedAt: importedAt,
  };
  return { need, mappedSkills, unmappedSkills, region, unmappedRegion };
}

export interface BridgeImportResult {
  results: RoleMapResult[];
  imported: number;
  totalUnmappedSkills: number;
  totalUnmappedRegions: number;
}

/** Pure: map a batch of roles (no store writes) — testable + previewable. */
export function mapRoles(roles: SwitchboardRole[], importedAt: string): BridgeImportResult {
  const results = roles.map((r) => roleToNeed(r, importedAt));
  return {
    results,
    imported: results.length,
    totalUnmappedSkills: results.reduce((n, r) => n + r.unmappedSkills.length, 0),
    totalUnmappedRegions: results.reduce((n, r) => n + (r.unmappedRegion ? 1 : 0), 0),
  };
}

/** Import: map each Role → a Need and persist the bridged set to Jane's broker vault
 *  (`gs:broker:bridge`), idempotent by id. Switchboard stays read-only — we never write back. */
export async function importSwitchboardRoles(roles: SwitchboardRole[], importedAt = new Date().toISOString()): Promise<BridgeImportResult> {
  const res = mapRoles(roles, importedAt);
  const existing = await loadBridgedNeeds();
  const byId = new Map(existing.map((n) => [n.id, n] as const));
  for (const r of res.results) byId.set(r.need.id, r.need);
  await saveBridgedNeeds([...byId.values()]);
  await hydrate(true); // re-render the broker view with the imported demand
  return res;
}

/** Resolve a bridged Need's mapped-skill labels for display (re-derives from the stored gcUris). */
export function skillLabels(skills: SkillRef[]): string[] {
  return skills.map((s) => skillByUri(s.gcUri)?.label ?? s.label);
}
