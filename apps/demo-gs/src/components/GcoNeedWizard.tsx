// GCO Need wizard (spec 250 §12.1, §17.1). The GCO signatory (the connected person) declares a
// skill-based Need owned by their GCO organization (e.g. Hope Church Missions Team). Wave 2 (spec 252):
// it appends to the GCO ORG's OWN vault via the session grant (`saveGcoNeeds`) — the broker reads it
// only through that grant.

import { useState } from 'react';
import type { GcoNeedIntent, NeedKind, Uri, VisibilityTier } from '../domain/gs-types';
import { CAUSES, LANGUAGES, REGIONS, skillByUri } from '../data/taxonomy';
import type { Address } from '@agenticprimitives/types';
import { caip10 } from '../lib/personas';
import { loadGcoNeeds, saveGcoNeeds } from '../lib/member-vault';
import { hydrate } from '../lib/store';
import type { MemberSession } from '../lib/session';
import { SkillPicker } from './SkillPicker';
import { Banner, Btn, Card, Field, Pill, SectionHead, inputStyle } from './ui';

const NEED_KINDS: NeedKind[] = ['project', 'role', 'discussion', 'inquiry'];

export function GcoNeedWizard({ ownerOrg, signatory, session, onCreated }: { ownerOrg: Address; signatory: Address; session: MemberSession; onCreated?: () => void }) {
  const [title, setTitle] = useState('');
  const [needKind, setNeedKind] = useState<NeedKind>('project');
  const [skills, setSkills] = useState<Uri[]>([]);
  const [regionUri, setRegionUri] = useState<Uri>(REGIONS[0]!.uri);
  const [causeUri, setCauseUri] = useState<Uri>(CAUSES[0]!.uri);
  const [langs, setLangs] = useState<string[]>(['en']);
  const [cadence, setCadence] = useState('weekly');
  const [visibility, setVisibility] = useState<VisibilityTier>('public');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim()) { setMsg('Give the need a title.'); return; }
    if (skills.length === 0) { setMsg('Pick at least one required skill.'); return; }
    const now = new Date().toISOString();
    const region = REGIONS.find((r) => r.uri === regionUri)!;
    const cause = CAUSES.find((c) => c.uri === causeUri)!;
    const need: GcoNeedIntent = {
      id: `gc:need:demo-gs:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}-${Date.now().toString(36)}`,
      ownerOrgAgentId: caip10(ownerOrg),
      createdByPersonAgentId: caip10(signatory),
      title: title.trim(),
      needKind,
      requiredSkills: skills.map((u) => skillByUri(u)!),
      geoFacets: [region],
      causeFacets: [cause],
      languages: LANGUAGES.filter((l) => langs.includes(l.code)),
      commitment: { cadence: cadence as 'weekly' | 'monthly' | 'once' | 'ongoing' | 'seasonal' },
      visibility,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
    setBusy(true); setMsg(null);
    try {
      const existing = await loadGcoNeeds(session.grant); // the GCO org's OWN vault, via the session grant
      await saveGcoNeeds(session.grant, [need, ...existing]);
      await hydrate(true);
      setTitle(''); setSkills([]); setMsg('Need posted to your org vault. Switch to Jane to broker matches.');
      onCreated?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionHead eyebrow="GCO · post a need" title="Declare a skill need" sub="What capability does your organization need, where, and for what cause? Skills are canonical concepts — both needs and offerings cite the same anchors." />
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Grant writing help for a North Africa project" style={inputStyle} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
        <Field label="Need kind">
          <select value={needKind} onChange={(e) => setNeedKind(e.target.value as NeedKind)} style={inputStyle}>
            {NEED_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Visibility">
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as VisibilityTier)} style={inputStyle}>
            <option value="public">public (anchor + fields)</option>
            <option value="confidential">confidential (anchor coarsened)</option>
            <option value="sensitive">sensitive (absence)</option>
          </select>
        </Field>
      </div>
      <SkillPicker label="Required skills" selected={skills} onChange={setSkills} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
        <Field label="Region focus">
          <select value={regionUri} onChange={(e) => setRegionUri(e.target.value)} style={inputStyle}>
            {REGIONS.map((r) => <option key={r.uri} value={r.uri}>{r.label}{r.sensitivity && r.sensitivity !== 'normal' ? ' (sensitive)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Cause">
          <select value={causeUri} onChange={(e) => setCauseUri(e.target.value)} style={inputStyle}>
            {CAUSES.map((c) => <option key={c.uri} value={c.uri}>{c.label}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
        <Field label="Languages">
          <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
            {LANGUAGES.slice(0, 6).map((l) => {
              const on = langs.includes(l.code);
              return <button key={l.code} onClick={() => setLangs(on ? langs.filter((x) => x !== l.code) : [...langs, l.code])} style={{ cursor: 'pointer', border: 'none', background: 'transparent', padding: 0 }}><Pill tone={on ? 'ok' : 'neutral'}>{l.label}</Pill></button>;
            })}
          </div>
        </Field>
        <Field label="Commitment cadence">
          <select value={cadence} onChange={(e) => setCadence(e.target.value)} style={inputStyle}>
            {['once', 'weekly', 'monthly', 'seasonal', 'ongoing'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      {msg && <div style={{ margin: '.5rem 0' }}><Banner tone="ok">{msg}</Banner></div>}
      <Btn onClick={submit} busy={busy}>Post need</Btn>
    </Card>
  );
}
