// KC Expert Offering wizard (spec 250 §12.2, §17.1). The connected KC publishes an expertise Offering
// owned by their person agent. Wave 2 (spec 252): it writes to the KC's OWN vault via the session grant
// (`saveKcOffering`) — the broker reads it only through that grant. Contact stays confidential until an
// Agreement is accepted.

import { useState } from 'react';
import type { Capacity, ExpertOffering, Uri } from '../domain/gs-types';
import { CAUSES, LANGUAGES, REGIONS, skillByUri } from '../data/taxonomy';
import type { Address } from '@agenticprimitives/types';
import { caip10 } from '../lib/personas';
import { saveKcOffering } from '../lib/member-vault';
import { hydrate } from '../lib/store';
import type { MemberSession } from '../lib/session';
import { SkillPicker } from './SkillPicker';
import { Banner, Btn, Card, Field, Pill, SectionHead, inputStyle } from './ui';

const AVAIL: Capacity['availabilityStatus'][] = ['available', 'limited', 'paused', 'unavailable'];

export function ExpertOfferingWizard({ owner, ownerName, session, onCreated }: { owner: Address; ownerName?: string; session: MemberSession; onCreated?: () => void }) {
  const [headline, setHeadline] = useState('');
  const [skills, setSkills] = useState<Uri[]>([]);
  const [regionUris, setRegionUris] = useState<Uri[]>([]);
  const [causeUris, setCauseUris] = useState<Uri[]>([]);
  const [langs, setLangs] = useState<string[]>(['en']);
  const [availability, setAvailability] = useState<Capacity['availabilityStatus']>('available');
  const [evidence, setEvidence] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const toggle = (arr: string[], v: string, set: (x: string[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  async function submit() {
    if (!headline.trim()) { setMsg('Add a short headline.'); return; }
    if (skills.length === 0) { setMsg('Pick at least one offered skill.'); return; }
    const now = new Date().toISOString();
    const offering: ExpertOffering = {
      id: `gc:offering:demo-gs:kc-${headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}-${Date.now().toString(36)}`,
      ownerPersonAgentId: caip10(owner),
      displayName: ownerName ?? 'You (KC)',
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
    setBusy(true); setMsg(null);
    try {
      await saveKcOffering(session.grant, offering); // KC's OWN vault, via the session grant
      await hydrate(true);
      setHeadline(''); setSkills([]); setEvidence(''); setMsg('Offering published to your vault. Switch to Jane to see it matched against open needs.');
      onCreated?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
      <Btn onClick={submit} busy={busy}>Publish offering</Btn>
    </Card>
  );
}

const tagBtn: React.CSSProperties = { cursor: 'pointer', border: 'none', background: 'transparent', padding: 0 };
