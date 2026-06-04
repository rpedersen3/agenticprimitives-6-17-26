// Match board + explanation (spec 250 §12.3, §17.1). Pick an open Need; the broker scores every
// Offering and shows a ranked, EXPLAINABLE board. The GCO can request a connection — which creates
// a 'requested' Agreement (the KC accepts it on the Agreements panel). Before acceptance the KC's
// contact stays confidential (spec 250 §10) — only the public-summary headline + skills show.

import { useMemo, useState } from 'react';
import type { Address } from '@agenticprimitives/types';
import { explainMatch, rankMatches } from '../domain/score-match';
import { skillByUri } from '../data/taxonomy';
import { allOfferings, offeringById, requestConnection } from '../lib/store';
import type { GcoNeedIntent } from '../domain/gs-types';
import { Banner, Btn, Card, Pill, ScoreBadge, SectionHead } from './ui';

export function MatchBoard({ needs, requestAsPerson, onChanged }: {
  needs: GcoNeedIntent[];
  /** When set, the viewer (a GCO signatory) can request connections, acting as this person. */
  requestAsPerson?: Address;
  onChanged?: () => void;
}) {
  const openNeeds = needs.filter((n) => n.status === 'open' || n.status === 'matched' || n.status === 'requested');
  const [needId, setNeedId] = useState<string>(openNeeds[0]?.id ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const need = needs.find((n) => n.id === needId);
  const matches = useMemo(() => (need ? rankMatches(need, allOfferings()) : []), [need, needId]);

  if (openNeeds.length === 0) {
    return <Card><SectionHead eyebrow="Switchboard · matching" title="Match board" /><p style={{ color: 'var(--c-g500)', fontSize: '.88rem' }}>No open needs yet. Post one as a GCO Organization.</p></Card>;
  }

  function request(matchId: string) {
    const m = matches.find((x) => x.id === matchId);
    if (!m || !requestAsPerson) return;
    requestConnection(m, requestAsPerson);
    setMsg('Connection requested. Switch to Expert to accept it, or to Jane to track the agreement.');
    onChanged?.();
  }

  return (
    <Card>
      <SectionHead eyebrow="Switchboard · matching" title="Match board" sub="Deterministic, explainable scoring over shared skill / geo / cause / language anchors. Exact-skill ≫ category. The fact that a specific expert matched a specific need is confidential — only aggregate counts are public." />
      <div style={{ marginBottom: '.9rem' }}>
        <select value={needId} onChange={(e) => { setNeedId(e.target.value); setMsg(null); }} style={{ width: '100%', borderRadius: 9, border: '1.5px solid var(--c-g200)', padding: '.55rem .7rem', fontSize: '.9rem' }}>
          {openNeeds.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
        </select>
      </div>
      {need && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.9rem', fontSize: '.82rem', color: 'var(--c-g600)' }}>
          {need.requiredSkills.map((s) => <Pill key={s.gcUri} tone="ok">{s.label}</Pill>)}
          {need.geoFacets.map((g) => <Pill key={g.uri}>{g.label}</Pill>)}
          {(need.causeFacets ?? []).map((c) => <Pill key={c.uri} tone="warn">{c.label}</Pill>)}
        </div>
      )}
      {msg && <div style={{ marginBottom: '.8rem' }}><Banner tone="ok">{msg}</Banner></div>}

      {matches.length === 0 && <p style={{ color: 'var(--c-g500)', fontSize: '.88rem' }}>No offerings overlap this need's skills yet. Publish one as Expert.</p>}
      {matches.map((m) => {
        const off = offeringById(m.offeringId);
        return (
          <div key={m.id} style={{ border: '1px solid var(--c-g200)', borderRadius: 12, padding: '.9rem 1rem', marginBottom: '.7rem', display: 'flex', gap: '.9rem', alignItems: 'flex-start' }}>
            <ScoreBadge score={m.score} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '.95rem' }}>{off?.headline ?? 'Expert offering'}</strong>
                <Pill tone="neutral">confidence {Math.round((m.confidence ?? 0) * 100)}%</Pill>
                {off?.capacity?.availabilityStatus && <Pill tone={off.capacity.availabilityStatus === 'available' ? 'live' : 'warn'}>{off.capacity.availabilityStatus}</Pill>}
              </div>
              <p style={{ fontSize: '.84rem', color: 'var(--c-g600)', marginTop: '.3rem' }}><strong>Why this match:</strong> {explainMatch(m)}</p>
              <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.45rem' }}>
                {m.reasons.filter((r) => r.weight > 0).map((r, i) => <Pill key={i} tone={r.kind === 'skill_exact' ? 'ok' : 'neutral'}>{r.label} +{r.weight}</Pill>)}
                {m.missing.filter((r) => r.weight < 0 || r.kind === 'skill_exact').map((r, i) => <Pill key={`m${i}`} tone="warn">{r.label}</Pill>)}
              </div>
              {m.policyWarnings.length > 0 && <p style={{ fontSize: '.78rem', color: 'var(--c-accent)', marginTop: '.4rem' }}>⚠ {m.policyWarnings.join(' · ')}</p>}
              <div style={{ marginTop: '.5rem' }}>
                {off?.offeredSkills.slice(0, 6).map((s) => <span key={s.gcUri} style={{ fontSize: '.74rem', color: 'var(--c-g400)', marginRight: '.5rem' }}>{skillByUri(s.gcUri)?.label ?? s.label}</span>)}
              </div>
            </div>
            {requestAsPerson && (
              <Btn variant="ghost" style={{ padding: '.4rem .8rem', flex: '0 0 auto' }} onClick={() => request(m.id)}>Request connection</Btn>
            )}
          </div>
        );
      })}
    </Card>
  );
}
