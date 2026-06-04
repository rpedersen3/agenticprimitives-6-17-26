// Persona switcher (spec 250 §17.1 "Connect / role selector"). Mirrors demo-jp's PersonaBar.
// In v1 this stands in for demo-sso's role selection; Phase 1 swaps in real agent/delegation claims.

import { MEMBER_PERSONAS, OPERATOR_PERSONAS, PERSONA_META, type Persona } from '../lib/personas';

export function RoleSwitcher({ active, onSelect }: { active: Persona; onSelect: (p: Persona) => void }) {
  const order: Persona[] = [...MEMBER_PERSONAS, ...OPERATOR_PERSONAS];
  return (
    <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
      {order.map((p) => {
        const meta = PERSONA_META[p];
        const on = active === p;
        return (
          <button
            key={p}
            onClick={() => onSelect(p)}
            title={meta.blurb}
            style={{
              display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer',
              border: on ? '1.5px solid var(--c-primary)' : '1.5px solid var(--c-g200)',
              background: on ? 'var(--c-primary-subtle)' : '#fff',
              borderRadius: 999, padding: '.4rem .8rem', fontSize: '.84rem', fontWeight: 700,
              color: on ? 'var(--c-primary-active)' : 'var(--c-g700)',
            }}
          >
            <span aria-hidden="true">{meta.glyph}</span>
            <span>{meta.label}</span>
            <span style={{ fontWeight: 600, fontSize: '.74rem', color: on ? 'var(--c-primary)' : 'var(--c-g400)' }}>· {meta.org}</span>
          </button>
        );
      })}
    </div>
  );
}
