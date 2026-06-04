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
import { Banner, Btn, Card, Chip, Field, SectionHead, Select, TextField } from './ui';
import { useToast } from './Toast';

const AVAIL: Capacity['availabilityStatus'][] = ['available', 'limited', 'paused', 'unavailable'];

export function ExpertOfferingWizard({ owner, ownerName, session, onCreated, eyebrow, title: titleProp, sub }: {
  owner: Address; ownerName?: string; session: MemberSession; onCreated?: () => void;
  /** Card header overrides (Wave D re-homes this as the workspace primary-task card). */
  eyebrow?: string; title?: string; sub?: string;
}) {
  const [headline, setHeadline] = useState('');
  const [skills, setSkills] = useState<Uri[]>([]);
  const [regionUris, setRegionUris] = useState<Uri[]>([]);
  const [causeUris, setCauseUris] = useState<Uri[]>([]);
  const [langs, setLangs] = useState<string[]>(['en']);
  const [availability, setAvailability] = useState<Capacity['availabilityStatus']>('available');
  const [evidence, setEvidence] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const toast = useToast();
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
      toast('Offering published', 'ok');
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
        eyebrow={eyebrow ?? 'KC · publish an offering'}
        title={titleProp ?? 'Offer your expertise'}
        sub={sub ?? 'Which skills can you serve with, and under what constraints? Your identity + contact stay confidential until a connection is accepted.'}
      />
      <TextField label="Headline" value={headline} onChange={setHeadline} placeholder="e.g. Grant writing + foundation strategy for missions" />
      <SkillPicker label="Offered skills" selected={skills} onChange={setSkills} />
      <Field label="Region focus">
        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
          {REGIONS.map((r) => <Chip key={r.uri} active={regionUris.includes(r.uri)} onClick={() => toggle(regionUris, r.uri, setRegionUris)}>{r.label}</Chip>)}
        </div>
      </Field>
      <Field label="Causes">
        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
          {CAUSES.map((c) => <Chip key={c.uri} active={causeUris.includes(c.uri)} onClick={() => toggle(causeUris, c.uri, setCauseUris)}>{c.label}</Chip>)}
        </div>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
        <Field label="Languages">
          <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
            {LANGUAGES.slice(0, 6).map((l) => <Chip key={l.code} active={langs.includes(l.code)} onClick={() => toggle(langs, l.code, setLangs)}>{l.label}</Chip>)}
          </div>
        </Field>
        <Select label="Availability" value={availability} onChange={(v) => setAvailability(v as Capacity['availabilityStatus'])} options={AVAIL.map((a) => ({ value: a, label: a }))} />
      </div>
      <TextField label="Evidence (optional)" value={evidence} onChange={setEvidence} placeholder="e.g. $250k raised for a literacy program" />
      {msg && <div style={{ margin: '.5rem 0' }}><Banner tone="ok">{msg}</Banner></div>}
      <Btn onClick={submit} busy={busy}>Publish offering</Btn>
    </Card>
  );
}
