// Canonical skill multi-select (spec 250 §17.1). Picks SkillRefs from the taxonomy by category —
// the selected values are URIs (identity), never free text. Shared by both wizards.

import { useMemo, useState } from 'react';
import type { SkillRef, Uri } from '../domain/gs-types';
import { SKILL_CATEGORIES, SKILLS, skillByUri } from '../data/taxonomy';
import { Field, Pill, Select, TextField } from './ui';

export function SkillPicker({ label, selected, onChange }: {
  label: string;
  selected: Uri[];
  onChange: (uris: Uri[]) => void;
}) {
  const [cat, setCat] = useState<Uri>('all');
  const [q, setQ] = useState('');

  const options = useMemo(() => SKILLS.filter((s) =>
    (cat === 'all' || s.categoryUri === cat) &&
    (!q || s.label.toLowerCase().includes(q.toLowerCase())),
  ), [cat, q]);

  const toggle = (uri: Uri) => onChange(selected.includes(uri) ? selected.filter((x) => x !== uri) : [...selected, uri]);

  return (
    <Field label={label}>
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem', flexWrap: 'wrap' }}>
        <Select value={cat} onChange={setCat} style={{ width: 'auto', flex: '1 1 180px' }} options={[
          { value: 'all', label: 'All categories' },
          ...SKILL_CATEGORIES.map((c) => ({ value: c.uri, label: c.label })),
        ]} />
        <TextField placeholder="Search skills…" value={q} onChange={setQ} style={{ flex: '1 1 160px' }} />
      </div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
          {selected.map((u) => (
            <button key={u} onClick={() => toggle(u)} style={chipBtn} title="Remove">
              {skillByUri(u)?.label ?? u} ✕
            </button>
          ))}
        </div>
      )}
      <div style={{ maxHeight: 168, overflow: 'auto', border: '1px solid var(--c-g200)', borderRadius: 9, padding: '.5rem' }}>
        {options.map((s: SkillRef) => {
          const on = selected.includes(s.gcUri);
          return (
            <label key={s.gcUri} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.25rem .15rem', cursor: 'pointer', fontSize: '.86rem' }}>
              <input type="checkbox" checked={on} onChange={() => toggle(s.gcUri)} />
              <span style={{ fontWeight: on ? 700 : 500 }}>{s.label}</span>
              {s.cboxUri && <Pill tone="ok">C-Box</Pill>}
            </label>
          );
        })}
        {options.length === 0 && <p style={{ fontSize: '.82rem', color: 'var(--c-g400)', padding: '.25rem' }}>No skills match.</p>}
      </div>
    </Field>
  );
}

const chipBtn: React.CSSProperties = {
  background: 'var(--c-primary-subtle)', color: 'var(--c-primary-active)', border: '1px solid var(--c-primary-border)',
  borderRadius: 999, padding: '.2rem .6rem', fontSize: '.74rem', fontWeight: 700, cursor: 'pointer',
};
