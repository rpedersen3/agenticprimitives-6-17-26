// KC Expert Offering wizard (spec 250 §12.2, §17.1). The connected KC publishes an expertise
// Offering owned by their person agent. v1 writes to the local store; Phase 2 writes via the
// person-vault adapter (profile/contact stay confidential until an Agreement is accepted).

import { useState } from 'react';
import type { Capacity, ExpertOffering, Uri } from '../domain/gs-types';
import { CAUSES, LANGUAGES, REGIONS, skillByUri } from '../data/taxonomy';
import { KC_EOA, caip10 } from '../lib/personas';
import { upsertOffering } from '../lib/store';
import { SkillPicker } from './SkillPicker';
import { Banner, Btn, Card, Field, Pill, SectionHead, inputStyle } from './ui';

const AVAIL: Capacity['availabilityStatus'][] = ['available', 'limited', 'paused', 'unavailable'];

export function ExpertOfferingWizard({ onCreated }: { onCreated?: () => void }) {
  const [headline, setHeadline] = useState('');
  const [skills, setSkills] = useState<Uri[]>([]);
  const [regionUris, setRegionUris] = useState<Uri[]>([]);
  const [causeUris, setCauseUris] = useState<Uri[]>([]);
  const [langs, setLangs] = useState<string[]>(['en']);
  const [availability, setAvailability] = useState<Capacity['availabilityStatus']>('available');
  const [evidence, setEvidence] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  function submit() {
    if (!headline.trim()) { setMsg('Add a short headline.'); return; }
    if (skills.length === 0) { setMsg('Pick at least one offered skill.'); return; }
    const now = new Date().toISOString();
    const offering: ExpertOffering = {
      id: `gc:offering:demo-gs:kc-${headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}-${Date.now().toString(36)}`,
      ownerPersonAgentId: caip10(KC_EOA),
      displayName: 'You (KC)',
      headline: headline.trim(),
      offeredSkills: skills.map((u) => skillByUri(u)!),
      geoFacets: REGIONS.filter((r) => regionUris.includes(r.uri)),
      causeFacets: CAUSES.filter((c) => causeUris.includes(c.uri)),
      languages: LANGUAGES.filter((l) => langs.includes(l.code)),
      capacity: { availabilityStatus: availability },
      evidence: evidence.trim() ? [{ id: `ev:${Date.now().toString(36)}`, kind: 'self_claim', label: evidence.trim(), visibility: 'public' }] : [],
      confidentialContact: 'you@kc.example (confidential)',
      visibility: 'public-summary',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    upsertOffering(offering);
    setHeadline(''); setSkills([]); setEvidence(''); setMsg('Offering published. Switch to Jane to see it matched against open needs.');
    onCreated?.();
  }

  return (
    <Card>
      <SectionHead eyebrow="KC · publish an offering" title="Offer your expertise" sub="Which skills can you serve with, and under what constraints? Your identity + contact stay confidential until a connection is accepted." />
      <Field label="Headline"><input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Grant writing + foundation strategy for missions" style={inputStyle} /></Field>
      <SkillPicker label="Offered skills" selected={skills} onChange={setSkills} />
      <Field label="Region focus">
        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
          {REGIONS.map((r) => <button key={r.uri} onClick={() => toggle(regionUris, r.uri, setRegionUris)} style={tagBtn}><Pill tone={regionUris.includes(r.uri) ? 'ok' : 'neutral'}>{r.label}</Pill></button>)}
        </div>
      </Field>
      <Field label="Causes">
        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
          {CAUSES.map((c) => <button key={c.uri} onClick={() => toggle(causeUris, c.uri, setCauseUris)} style={tagBtn}><Pill tone={causeUris.includes(c.uri) ? 'ok' : 'neutral'}>{c.label}</Pill></button>)}
        </div>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
        <Field label="Languages">
          <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
            {LANGUAGES.slice(0, 6).map((l) => <button key={l.code} onClick={() => toggle(langs, l.code, setLangs)} style={tagBtn}><Pill tone={langs.includes(l.code) ? 'ok' : 'neutral'}>{l.label}</Pill></button>)}
          </div>
        </Field>
        <Field label="Availability">
          <select value={availability} onChange={(e) => setAvailability(e.target.value as Capacity['availabilityStatus'])} style={inputStyle}>
            {AVAIL.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Evidence (optional)"><input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="e.g. $250k raised for a literacy program" style={inputStyle} /></Field>
      {msg && <div style={{ margin: '.5rem 0' }}><Banner tone="ok">{msg}</Banner></div>}
      <Btn onClick={submit}>Publish offering</Btn>
    </Card>
  );
}

const tagBtn: React.CSSProperties = { cursor: 'pointer', border: 'none', background: 'transparent', padding: 0 };
