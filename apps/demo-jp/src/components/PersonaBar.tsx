// Persona switcher (Wave 8.13, IA §8). Always visible (D-9). Pete/Jill swap-only
// (D-10); member personas hand off to the existing SSO flow. Rendered as a thin
// sticky strip under the public topbar.

import { PERSONA_META, type Persona, OPERATOR_PERSONAS, MEMBER_PERSONAS } from '../lib/persona-mode';

export function PersonaBar({
  active,
  onSwitch,
}: {
  active: Persona | null;
  onSwitch: (p: Persona | null) => void;
}) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        background: 'rgba(255,255,255,.92)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--c-g200)',
        padding: '.5rem 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '.6rem',
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontSize: '.68rem',
          fontWeight: 800,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: 'var(--c-g400)',
          marginRight: '.2rem',
        }}
      >
        Demo personas
      </span>
      <Group title="Operators" personas={OPERATOR_PERSONAS} active={active} onSwitch={onSwitch} />
      <span style={{ color: 'var(--c-g300)' }}>·</span>
      <Group title="Members" personas={MEMBER_PERSONAS} active={active} onSwitch={onSwitch} />
      {active && (
        <button
          onClick={() => onSwitch(null)}
          style={{
            marginLeft: 'auto',
            fontSize: '.78rem',
            fontWeight: 700,
            color: 'var(--c-g500)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          ← Public site
        </button>
      )}
    </div>
  );
}

function Group({
  personas,
  active,
  onSwitch,
}: {
  title: string;
  personas: Persona[];
  active: Persona | null;
  onSwitch: (p: Persona) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: '.35rem' }}>
      {personas.map((p) => {
        const meta = PERSONA_META[p];
        const on = active === p;
        return (
          <button
            key={p}
            onClick={() => onSwitch(p)}
            title={meta.blurb}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '.35rem',
              fontSize: '.8rem',
              fontWeight: 700,
              borderRadius: 999,
              padding: '.3rem .7rem',
              cursor: 'pointer',
              border: on ? '1.5px solid var(--c-primary)' : '1px solid var(--c-g200)',
              background: on ? 'var(--c-primary-subtle)' : '#fff',
              color: on ? 'var(--c-primary-active)' : 'var(--c-g600)',
            }}
          >
            <span aria-hidden>{meta.glyph}</span>
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
