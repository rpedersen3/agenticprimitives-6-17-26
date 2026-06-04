// Deterministic, EXPLAINABLE match scoring (spec 250 §14). No ML, no opaque ranking — every
// score carries reason codes + a human "why this match". Exact-skill ≫ category. Reproducible
// at query time from a Need + an Offering. Weights are tunable in MATCH_WEIGHTS.

import type {
  ExpertOffering, GcoNeedIntent, GsIntentMatch, MatchReason, Uri,
} from './gs-types';
import { categoryLabel, regionByUri, skillByUri } from '../data/taxonomy';

export const MATCH_WEIGHTS = {
  skillExact: 50, // distributed across required skills
  skillCategory: 10,
  geoExact: 15,
  geoRelated: 8,
  cause: 8,
  peopleGroup: 10,
  language: 5,
  availability: 5,
  trustEvidence: 5,
} as const;

const nowIso = (clock: () => string) => clock();

/** Stable, non-time-based match id (spec uses gc:match:demo-gs:<…>). */
export function createMatchId(needId: Uri, offeringId: Uri): Uri {
  const key = `${needId}|${offeringId}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return `gc:match:demo-gs:${(h >>> 0).toString(16).padStart(8, '0')}`;
}

function uriSet(items: { gcUri: Uri }[] | undefined): Set<Uri> {
  return new Set((items ?? []).map((i) => i.gcUri));
}

/**
 * Score one Need against one Offering. `clock` is injected so the result is fully deterministic
 * in tests (no Date.now in the scoring path). Returns a proposed, explainable IntentMatch.
 */
export function scoreMatch(
  need: GcoNeedIntent,
  offering: ExpertOffering,
  clock: () => string = () => new Date().toISOString(),
): GsIntentMatch {
  const reasons: MatchReason[] = [];
  const missing: MatchReason[] = [];
  const policyWarnings: string[] = [];

  // ── Skills: exact overlap (primary) then category coverage ──
  const offeredUris = uriSet(offering.offeredSkills);
  const required = need.requiredSkills;
  const requiredCount = Math.max(1, required.length);
  const perSkill = MATCH_WEIGHTS.skillExact / requiredCount;
  const offeredCategories = new Set(offering.offeredSkills.map((s) => s.categoryUri));
  let exactCount = 0;

  for (const rs of required) {
    if (offeredUris.has(rs.gcUri)) {
      exactCount += 1;
      reasons.push({ kind: 'skill_exact', label: `Matched skill: ${rs.label}`, weight: Math.round(perSkill), publicExplanation: `Both cite ${rs.gcUri}` });
    } else if (offeredCategories.has(rs.categoryUri)) {
      reasons.push({ kind: 'skill_category', label: `Related category: ${categoryLabel(rs.categoryUri)} (for ${rs.label})`, weight: Math.round(MATCH_WEIGHTS.skillCategory / requiredCount) });
    } else {
      missing.push({ kind: 'skill_exact', label: `Required skill not offered: ${rs.label}`, weight: 0 });
    }
  }
  // Cap category contribution so it never rivals an exact-skill match.
  const categoryTotal = reasons.filter((r) => r.kind === 'skill_category').reduce((s, r) => s + r.weight, 0);
  if (categoryTotal > MATCH_WEIGHTS.skillCategory) {
    const scale = MATCH_WEIGHTS.skillCategory / categoryTotal;
    for (const r of reasons) if (r.kind === 'skill_category') r.weight = Math.round(r.weight * scale);
  }

  // ── Geo: exact, then related (parent rollup) ──
  const needGeo = need.geoFacets ?? [];
  const offGeoUris = new Set((offering.geoFacets ?? []).map((g) => g.uri));
  const offGeoParents = new Set((offering.geoFacets ?? []).map((g) => g.parentUri).filter(Boolean) as Uri[]);
  let geoScored = false;
  for (const g of needGeo) {
    if (offGeoUris.has(g.uri)) {
      reasons.push({ kind: 'geo_exact', label: `Region fit: ${g.label}`, weight: MATCH_WEIGHTS.geoExact });
      geoScored = true;
      break;
    }
  }
  if (!geoScored) {
    for (const g of needGeo) {
      const parent = regionByUri(g.uri)?.parentUri ?? g.parentUri;
      if ((parent && offGeoUris.has(parent)) || offGeoParents.has(g.uri)) {
        reasons.push({ kind: 'geo_related', label: `Nearby region: ${g.label}`, weight: MATCH_WEIGHTS.geoRelated });
        geoScored = true;
        break;
      }
    }
  }
  if (needGeo.length && !geoScored) missing.push({ kind: 'geo_related', label: 'No regional experience overlap', weight: 0 });

  // ── Cause ──
  const offCauses = new Set((offering.causeFacets ?? []).map((c) => c.uri));
  for (const c of need.causeFacets ?? []) {
    if (offCauses.has(c.uri)) { reasons.push({ kind: 'cause', label: `Cause fit: ${c.label}`, weight: MATCH_WEIGHTS.cause }); break; }
  }

  // ── People group (optional bridge to JP/engage) ──
  const offPg = new Set((offering.peopleGroupFacets ?? []).map((p) => p.uri));
  for (const p of need.peopleGroupFacets ?? []) {
    if (offPg.has(p.uri)) { reasons.push({ kind: 'people_group', label: `People-group context: ${p.label ?? p.uri}`, weight: MATCH_WEIGHTS.peopleGroup }); break; }
  }

  // ── Language ──
  const offLangs = new Set((offering.languages ?? []).map((l) => l.code));
  const needLangs = need.languages ?? [];
  const sharedLangs = needLangs.filter((l) => offLangs.has(l.code));
  if (needLangs.length) {
    if (sharedLangs.length) reasons.push({ kind: 'language', label: `Language fit: ${sharedLangs.map((l) => l.label).join(', ')}`, weight: MATCH_WEIGHTS.language });
    else missing.push({ kind: 'language', label: `No shared language (${needLangs.map((l) => l.label).join(', ')} needed)`, weight: 0 });
  }

  // ── Availability ──
  const avail = offering.capacity?.availabilityStatus;
  if (avail === 'available') reasons.push({ kind: 'availability', label: 'Available now', weight: MATCH_WEIGHTS.availability });
  else if (avail === 'limited') { reasons.push({ kind: 'availability', label: 'Limited availability', weight: Math.round(MATCH_WEIGHTS.availability / 2) }); }
  else if (avail === 'paused' || avail === 'unavailable') { policyWarnings.push('Expert is not currently available'); missing.push({ kind: 'policy', label: 'Expert unavailable', weight: -5 }); }

  // ── Trust evidence ──
  const strongEvidence = (offering.evidence ?? []).some((e) => e.kind !== 'self_claim');
  if (strongEvidence) reasons.push({ kind: 'trust_evidence', label: 'Verified evidence (endorsement / case study / prior agreement)', weight: MATCH_WEIGHTS.trustEvidence });
  else if ((offering.evidence ?? []).length) missing.push({ kind: 'trust_evidence', label: 'Only self-claimed evidence', weight: 0 });

  // ── Policy: a sensitive region in the need is a suppression warning, never an inference ──
  for (const g of needGeo) {
    const sens = regionByUri(g.uri)?.sensitivity ?? g.sensitivity;
    if (sens === 'creative_access' || sens === 'closed') { policyWarnings.push(`Sensitive region (${g.label}) — detail suppressed in public views`); break; }
  }

  const raw = reasons.reduce((s, r) => s + r.weight, 0);
  const penalties = missing.filter((m) => m.kind === 'policy').reduce((s, m) => s + Math.abs(m.weight), 0);
  const score = Math.max(0, Math.min(100, raw - penalties));
  // Confidence dips when the need under-specifies (sparse fields → less to score on).
  const specified = (required.length ? 1 : 0) + (needGeo.length ? 1 : 0) + ((need.causeFacets ?? []).length ? 1 : 0) + (needLangs.length ? 1 : 0);
  const confidence = Math.min(1, 0.4 + 0.15 * specified);

  return {
    id: createMatchId(need.id, offering.id),
    needId: need.id,
    offeringId: offering.id,
    score,
    confidence,
    reasons,
    missing,
    policyWarnings,
    status: 'proposed',
    createdAt: nowIso(clock),
    computedBy: 'demo-gs',
  };
}

/** Score a Need against many Offerings, ranked high→low, dropping zero-skill-overlap noise. */
export function rankMatches(
  need: GcoNeedIntent,
  offerings: ExpertOffering[],
  clock: () => string = () => new Date().toISOString(),
): GsIntentMatch[] {
  return offerings
    .map((o) => scoreMatch(need, o, clock))
    .filter((m) => m.reasons.some((r) => r.kind === 'skill_exact' || r.kind === 'skill_category'))
    .sort((a, b) => b.score - a.score || (b.confidence ?? 0) - (a.confidence ?? 0));
}

/** A short human sentence summarising why a match scored (spec 250 §14.3). */
export function explainMatch(match: GsIntentMatch): string {
  const top = match.reasons.filter((r) => r.weight > 0).slice(0, 4).map((r) => r.label);
  if (!top.length) return 'No strong signals.';
  return top.join(' · ');
}

/** A skill label list for a need/offering (display helper). */
export function skillLabels(uris: Uri[]): string[] {
  return uris.map((u) => skillByUri(u)?.label ?? u);
}
