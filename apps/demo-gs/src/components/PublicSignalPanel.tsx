// Public read surface (spec 250 §16). Aggregate open needs by skill / category / region — the
// cross-ecosystem signal other apps (engage, JP) can join. Counts only; never a specific
// expert↔need match. Sensitive regions collapse to a coarse bucket. Fulfilled/closed needs drop
// out of "open". In v1 this computes from the local store; Phase 4 serves it from the GC graph/API.

import { useMemo } from 'react';
import type { GcoNeedIntent, ExpertOffering } from '../domain/gs-types';
import { computeSignal } from '../lib/signal';
import { Card, Pill, SectionHead } from './ui';

export function PublicSignalPanel({ needs, offerings }: { needs: GcoNeedIntent[]; offerings: ExpertOffering[] }) {
  const agg = useMemo(() => computeSignal(needs, offerings), [needs, offerings]);

  return (
    <Card>
      <SectionHead eyebrow="Public read surface" title="Open needs signal" sub="Aggregate skill-gap signal for the ecosystem — counts only, no confidential match. This is what engage / JP / other apps can join on. Source: demo-gs store; updated live." />
      <p style={{ fontSize: '.85rem', color: 'var(--c-g600)', marginBottom: '1rem' }}><strong>{agg.openCount}</strong> open need{agg.openCount === 1 ? '' : 's'} right now.</p>

      <Group title="Open needs by skill">
        {agg.bySkill.map((s) => <Row key={s.label} label={s.label} n={s.n} />)}
      </Group>
      <Group title="Open needs by category">
        {agg.byCategory.map((s) => <Row key={s.label} label={s.label} n={s.n} />)}
      </Group>
      <Group title="Open needs by region">
        {agg.byRegion.map((s) => <Row key={s.uri} label={s.label} n={s.n} sensitive={s.sensitive} />)}
      </Group>
      <Group title="Unmet skill categories (needs > active offerings)">
        {agg.unmet.length === 0 && <p style={{ fontSize: '.82rem', color: 'var(--c-g400)' }}>Supply currently covers demand.</p>}
        {agg.unmet.map((c) => (
          <div key={c.uri} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.25rem 0', fontSize: '.85rem' }}>
            <span style={{ flex: 1 }}>{c.label}</span>
            <Pill tone="warn">{c.needs} need{c.needs === 1 ? '' : 's'}</Pill>
            <Pill tone="neutral">{c.offerings} offering{c.offerings === 1 ? '' : 's'}</Pill>
          </div>
        ))}
      </Group>
    </Card>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1.1rem' }}>
      <h4 style={{ fontSize: '.74rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--c-g500)', marginBottom: '.4rem' }}>{title}</h4>
      {children}
    </div>
  );
}

function Row({ label, n, sensitive }: { label: string; n: number; sensitive?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.2rem 0' }}>
      <span style={{ flex: 1, fontSize: '.85rem', color: sensitive ? 'var(--c-accent)' : 'var(--c-g700)' }}>{label}</span>
      <div style={{ width: `${Math.min(100, n * 28)}px`, height: 8, borderRadius: 999, background: 'var(--c-primary)', opacity: 0.8 }} />
      <strong style={{ fontSize: '.85rem', minWidth: 18, textAlign: 'right' }}>{n}</strong>
    </div>
  );
}
