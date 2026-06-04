// GCO Need wizard (spec 250 §12.1, §17.1). The GCO signatory (the connected person) declares a
// skill-based Need owned by their GCO organization (e.g. Hope Church Missions Team). Wave 2 (spec 252):
// it appends to the GCO ORG's OWN vault via the session grant (`saveGcoNeeds`) — the broker reads it
// only through that grant.

import { useEffect, useState } from 'react';
import type { GcoNeedIntent, NeedKind, Uri, VisibilityTier } from '../domain/gs-types';
import { CAUSES, LANGUAGES, REGIONS, skillByUri } from '../data/taxonomy';
import type { Address } from '@agenticprimitives/types';
import { caip10 } from '../lib/personas';
import { loadGcoNeeds, saveGcoNeeds } from '../lib/member-vault';
import { hydrate } from '../lib/store';
import type { MemberSession } from '../lib/session';
import { SkillPicker } from './SkillPicker';
import { Banner, Btn, Card, Chip, Field, SectionHead, Select, TextField } from './ui';
import { useToast } from './Toast';

const NEED_KINDS: NeedKind[] = ['project', 'role', 'discussion', 'inquiry'];

export function GcoNeedWizard({ ownerOrg, signatory, session, onCreated, eyebrow, title: titleProp, sub, prefill }: {
  ownerOrg: Address; signatory: Address; session: MemberSession; onCreated?: () => void;
  /** Card header overrides (Wave C re-homes this as the workspace primary-task card). */
  eyebrow?: string; title?: string; sub?: string;
  /** Re-post / edit: prefill the form from a withdrawn need (Wave C edit flow). */
  prefill?: GcoNeedIntent | null;
}) {
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
  const toast = useToast();

  // Prefill from an edited need (a "re-post"). Only canonical/known values are applied.
  useEffect(() => {
    if (!prefill) return;
    setTitle(prefill.title);
    setNeedKind(prefill.needKind);
    setSkills(prefill.requiredSkills.map((s) => s.gcUri));
    if (prefill.geoFacets[0]) setRegionUri(prefill.geoFacets[0].uri);
    if (prefill.causeFacets?.[0]) setCauseUri(prefill.causeFacets[0].uri);
    if (prefill.languages?.length) setLangs(prefill.languages.map((l) => l.code));
    if (prefill.commitment?.cadence) setCadence(prefill.commitment.cadence);
    setVisibility(prefill.visibility);
    setMsg('Editing — adjust and re-post; the original was withdrawn.');
  }, [prefill]);

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
      toast('Need posted', 'ok');
      onCreated?.();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setMsg(m); toast(m, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <SectionHead
        eyebrow={eyebrow ?? 'GCO · post a need'}
        title={titleProp ?? 'Declare a skill need'}
        sub={sub ?? 'What capability does your organization need, where, and for what cause? Skills are canonical concepts — both needs and offerings cite the same anchors.'}
      />
      <TextField label="Title" value={title} onChange={setTitle} placeholder="e.g. Grant writing help for a North Africa project" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
        <Select label="Need kind" value={needKind} onChange={(v) => setNeedKind(v as NeedKind)} options={NEED_KINDS.map((k) => ({ value: k, label: k }))} />
        <Select label="Visibility" value={visibility} onChange={(v) => setVisibility(v as VisibilityTier)} options={[
          { value: 'public', label: 'public (anchor + fields)' },
          { value: 'confidential', label: 'confidential (anchor coarsened)' },
          { value: 'sensitive', label: 'sensitive (absence)' },
        ]} />
      </div>
      <SkillPicker label="Required skills" selected={skills} onChange={setSkills} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
        <Select label="Region focus" value={regionUri} onChange={setRegionUri} options={REGIONS.map((r) => ({ value: r.uri, label: `${r.label}${r.sensitivity && r.sensitivity !== 'normal' ? ' (sensitive)' : ''}` }))} />
        <Select label="Cause" value={causeUri} onChange={setCauseUri} options={CAUSES.map((c) => ({ value: c.uri, label: c.label }))} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
        <Field label="Languages">
          <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
            {LANGUAGES.slice(0, 6).map((l) => {
              const on = langs.includes(l.code);
              return <Chip key={l.code} active={on} onClick={() => setLangs(on ? langs.filter((x) => x !== l.code) : [...langs, l.code])}>{l.label}</Chip>;
            })}
          </div>
        </Field>
        <Select label="Commitment cadence" value={cadence} onChange={setCadence} options={['once', 'weekly', 'monthly', 'seasonal', 'ongoing'].map((c) => ({ value: c, label: c }))} />
      </div>
      {msg && <div style={{ margin: '.5rem 0' }}><Banner tone="ok">{msg}</Banner></div>}
      <Btn onClick={submit} busy={busy}>Post need</Btn>
    </Card>
  );
}
