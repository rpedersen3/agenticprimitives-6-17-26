// A reusable next-best-action card (production UX Wave C, design spec §3b "next-best-action cards" +
// the §10 right rail). GENERIC: the caller computes the single most useful next step (title + body +
// optional CTA) from its lifecycle position and passes it in; this is pure presentation, so Wave D
// (the KC workspace) reuses it with KC actions. No GCO/KC-specific copy lives here.

import { Card } from './ui';

export interface NextAction {
  /** A short eyebrow, e.g. "Next best action". */
  eyebrow?: string;
  title: string;
  body: string;
  /** Optional call-to-action; omit for a purely informational nudge (e.g. "awaiting response"). */
  cta?: { label: string; onClick: () => void };
  /** `wait` renders an informational (non-action) tone. */
  tone?: 'action' | 'wait';
}

export function NextBestAction({ action }: { action: NextAction }) {
  const wait = action.tone === 'wait';
  return (
    <Card style={{ background: wait ? 'var(--c-g50)' : 'var(--c-primary-subtle)', borderColor: 'var(--c-primary-border)' }}>
      <div className="eyebrow">{action.eyebrow ?? 'Next best action'}</div>
      <h3 style={{ fontSize: '1.05rem', fontWeight: 800, marginTop: '.4rem', color: 'var(--c-g900, #0f172a)' }}>{action.title}</h3>
      <p style={{ fontSize: '.85rem', color: 'var(--c-g600)', marginTop: '.4rem', lineHeight: 1.5 }}>{action.body}</p>
      {action.cta && (
        <button
          className="btn-primary"
          onClick={action.cta.onClick}
          style={{ marginTop: '.9rem', borderRadius: 10, padding: '.55rem 1.1rem', fontWeight: 700, fontSize: '.85rem', border: 'none', cursor: 'pointer' }}
        >
          {action.cta.label}
        </button>
      )}
    </Card>
  );
}
