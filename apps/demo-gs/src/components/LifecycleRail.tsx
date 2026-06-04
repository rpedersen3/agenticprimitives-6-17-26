// A reusable horizontal lifecycle rail (production UX Wave C, design spec §10 progress rail; the
// mockup `demo-gs-gco-dashboard.svg`). GENERIC: it renders any ordered list of
// `{ key, label, done, current }` steps with done / current / upcoming visuals, so Wave D (the KC
// workspace) can reuse it with its own steps. No GCO/KC-specific copy lives here.

import type { CSSProperties } from 'react';
import { Card } from './ui';

export interface RailStep {
  key: string;
  label: string;
  done: boolean;
  current: boolean;
}

export function LifecycleRail({ steps, eyebrow }: { steps: RailStep[]; eyebrow?: string }) {
  return (
    <Card style={{ padding: '1rem 1.25rem' }}>
      {eyebrow && <div className="eyebrow" style={{ marginBottom: '.6rem' }}>{eyebrow}</div>}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: '.6rem' }}>
        {steps.map((s, i) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', flex: '1 1 auto', minWidth: 0 }}>
            <Dot done={s.done} current={s.current} />
            <span style={labelStyle(s)}>{s.label}</span>
            {i < steps.length - 1 && <span style={connector} aria-hidden="true" />}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Dot({ done, current }: { done: boolean; current: boolean }) {
  const bg = done || current ? 'var(--c-primary)' : '#fff';
  const border = done || current ? 'var(--c-primary)' : 'var(--c-g300)';
  return (
    <span
      aria-hidden="true"
      style={{
        width: 14, height: 14, borderRadius: 999, flex: '0 0 auto', background: bg,
        border: `2px solid ${border}`, boxShadow: current ? '0 0 0 3px var(--c-primary-subtle)' : 'none',
      }}
    />
  );
}

function labelStyle(s: RailStep): CSSProperties {
  return {
    marginLeft: '.5rem', whiteSpace: 'nowrap', fontSize: '.78rem',
    fontWeight: s.done || s.current ? 700 : 400,
    color: s.done || s.current ? 'var(--c-g800)' : 'var(--c-g400)',
  };
}

const connector: CSSProperties = {
  flex: '1 1 16px', minWidth: 16, height: 2, margin: '0 .6rem', background: 'var(--c-g200)',
};
