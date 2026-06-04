// Aggregate public skill-gap signal (spec 250 §16) — pure, so the in-app PublicSignalPanel AND the
// public read API (functions/api/signal) compute it identically. Counts only; never a specific
// expert↔need match. Sensitive regions collapse to one coarse bucket. Closed/fulfilled needs drop out.

import { categoryLabel, regionByUri } from '../data/taxonomy';
import type { ExpertOffering, GcoNeedIntent, Uri } from '../domain/gs-types';

const OPEN: GcoNeedIntent['status'][] = ['open', 'matched', 'requested'];

export interface SignalRow { uri: string; label: string; n: number }
export interface RegionRow extends SignalRow { sensitive: boolean }
export interface UnmetRow { uri: Uri; label: string; needs: number; offerings: number }
export interface SignalResult {
  openCount: number;
  bySkill: SignalRow[];
  byCategory: SignalRow[];
  byRegion: RegionRow[];
  unmet: UnmetRow[];
}

export function computeSignal(needs: GcoNeedIntent[], offerings: ExpertOffering[]): SignalResult {
  const open = needs.filter((n) => OPEN.includes(n.status));
  const bySkill = new Map<string, SignalRow>();
  const byCategory = new Map<string, SignalRow>();
  const byRegion = new Map<string, RegionRow>();
  const offeringByCategory = new Map<string, number>();

  for (const o of offerings.filter((x) => x.status === 'active')) {
    for (const s of o.offeredSkills) offeringByCategory.set(s.categoryUri, (offeringByCategory.get(s.categoryUri) ?? 0) + 1);
  }
  for (const need of open) {
    for (const s of need.requiredSkills) {
      bySkill.set(s.gcUri, { uri: s.gcUri, label: s.label, n: (bySkill.get(s.gcUri)?.n ?? 0) + 1 });
      byCategory.set(s.categoryUri, { uri: s.categoryUri, label: categoryLabel(s.categoryUri), n: (byCategory.get(s.categoryUri)?.n ?? 0) + 1 });
    }
    for (const g of need.geoFacets) {
      const sens = regionByUri(g.uri)?.sensitivity ?? g.sensitivity;
      const sensitive = sens === 'creative_access' || sens === 'closed';
      const key = sensitive ? 'sensitive' : g.uri;
      const label = sensitive ? 'Sensitive region (coarsened)' : g.label;
      byRegion.set(key, { uri: key, label, n: (byRegion.get(key)?.n ?? 0) + 1, sensitive });
    }
  }
  const unmet = [...byCategory.values()]
    .map((c) => ({ uri: c.uri, label: c.label, needs: c.n, offerings: offeringByCategory.get(c.uri) ?? 0 }))
    .filter((c) => c.needs > c.offerings)
    .sort((a, b) => b.needs - a.needs);

  const sort = <T extends { n: number }>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.n - a.n);
  return { openCount: open.length, bySkill: sort(bySkill), byCategory: sort(byCategory), byRegion: sort(byRegion), unmet };
}
