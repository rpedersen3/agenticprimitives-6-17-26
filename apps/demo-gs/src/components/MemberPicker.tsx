// Select which created member you're acting as, or create a new one (the demo-jp
// "create + act as your org / yourself" analog). Generic over GCO orgs + KC individuals.

import { useState } from 'react';
import { Btn, Card, Pill, SectionHead, inputStyle } from './ui';

interface FieldDef { key: string; placeholder: string }

export function MemberPicker({ eyebrow, title, sub, options, activeId, onSelect, createLabel, fields, onCreate }: {
  eyebrow: string;
  title: string;
  sub: string;
  options: { id: string; label: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  createLabel: string;
  fields: FieldDef[];
  onCreate: (values: Record<string, string>) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});

  function submit() {
    if (fields.some((f) => !vals[f.key]?.trim())) return;
    onCreate(vals);
    setVals({});
    setCreating(false);
  }

  return (
    <Card style={{ background: 'var(--c-primary-subtle)', borderColor: 'var(--c-primary-border)' }}>
      <SectionHead eyebrow={eyebrow} title={title} sub={sub} />
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--c-g500)' }}>Acting as</span>
        <select value={activeId} onChange={(e) => onSelect(e.target.value)} style={{ ...inputStyle, width: 'auto', flex: '1 1 260px' }}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <Pill tone="neutral">{options.length} on file</Pill>
        <Btn variant="ghost" style={{ padding: '.4rem .8rem' }} onClick={() => setCreating((c) => !c)}>{creating ? 'Cancel' : `+ ${createLabel}`}</Btn>
      </div>
      {creating && (
        <div style={{ marginTop: '.8rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {fields.map((f) => (
            <input key={f.key} placeholder={f.placeholder} value={vals[f.key] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} style={{ ...inputStyle, flex: '1 1 200px' }} />
          ))}
          <Btn style={{ padding: '.5rem 1rem' }} onClick={submit}>Create &amp; act as</Btn>
        </div>
      )}
    </Card>
  );
}
