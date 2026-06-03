// Adopter-level intent request (the process starter). The adopter — NOT the JP broker —
// expresses a need for a facilitator, AS one of two principals:
//   • Individual  → the connected PERSON's Smart Agent.
//   • An org type → one of the orgs the person STEWARDS (their related orgs that carry a
//     stewardship delegation), chosen from a dropdown — no address typing.
// JP only brokers the resulting need into a match (it never authors intents). The need is
// written to JP's Direct-Lane board so the broker dashboard can pick it up.

import { useState } from 'react';
import type { Address } from '@agenticprimitives/types';

import { Card, SectionHead, Btn, Field, inputStyle, Banner } from './ui';
import { expressIntent } from '../lib/intent-flow';
import { JP_INTENT_OBJECT } from '../lib/intent-payload';
import { loadIntents, saveIntents, type BoardIntent } from '../lib/broker-store';
import { ensureOrgDeployed } from '../lib/onchain';
import { FPG_SEED, findPeopleGroup } from '../lib/people-groups';
import type { RelatedOrgLink } from '../connect-client';

const ADOPTER_TYPES = ['individual', 'family', 'group', 'church', 'organization', 'network'] as const;
type AdopterType = (typeof ADOPTER_TYPES)[number];

export function IntentRequest({ personSa, personName, orgs }: {
  personSa: Address;
  personName: string;
  /** The connected person's related orgs (used to offer their stewarded orgs). */
  orgs: RelatedOrgLink[];
}) {
  const [fpgId, setFpgId] = useState(FPG_SEED[0]?.id ?? 'NAJDI');
  const [adopterType, setAdopterType] = useState<AdopterType>('individual');
  const [orgAddr, setOrgAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isIndividual = adopterType === 'individual';
  // Orgs the person STEWARDS (oversees) — those carrying a stewardship delegation. Fall back
  // to all related orgs if none are tagged yet (older orgs predate the read-delegation pair).
  const stewarded = orgs.filter((o) => o.stewardshipDelegation);
  const orgOptions = stewarded.length ? stewarded : orgs;
  const selectedOrg = orgOptions.find((o) => o.orgAgent.toLowerCase() === orgAddr.toLowerCase());

  const request = async () => {
    setErr(null);
    setMsg(null);
    if (!isIndividual && !/^0x[0-9a-fA-F]{40}$/.test(orgAddr)) {
      setErr('Select one of your organizations (or choose “Individual”).');
      return;
    }
    const expressedBy = (isIndividual ? personSa : orgAddr) as Address;
    setBusy(true);
    try {
      await ensureOrgDeployed('jp'); // JP's vault holds the Direct-Lane board (idempotent)
      const current = await loadIntents();
      const id = `int_${current.length}_${Date.now().toString(36)}`;
      await expressIntent({ id, expressedBy, object: JP_INTENT_OBJECT.NeedFacilitator, payload: { fpgId, adopterType } });
      const pg = findPeopleGroup(fpgId);
      const who = isIndividual ? `${personName} (you)` : selectedOrg?.orgName || 'your organization';
      const row: BoardIntent = {
        id, direction: 'receive', object: 'facilitator', fpgId, adopterType,
        expressedBy,
        label: `${who} needs a facilitator · ${pg?.name ?? fpgId}`,
        createdAt: new Date().toISOString(),
        state: 'expressed',
      };
      await saveIntents([...current, row]);
      setMsg(`Your request for ${pg?.name ?? fpgId} is on the network — Joshua Project can now broker a facilitator.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not submit your request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionHead
        eyebrow="Start here · request a facilitator"
        title="Request a facilitator from Joshua Project"
        sub="Tell JP which people group you want to adopt and who is adopting — you as an individual, or one of the organizations you steward. JP brokers a facilitator match; you don't choose the facilitator."
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <Field label="People group">
          <select style={inputStyle} value={fpgId} onChange={(e) => setFpgId(e.target.value)}>
            {FPG_SEED.map((g) => <option key={g.id} value={g.id}>{g.name} — {g.country}</option>)}
          </select>
        </Field>
        <Field label="Who is adopting?">
          <select style={inputStyle} value={adopterType} onChange={(e) => { setAdopterType(e.target.value as AdopterType); setOrgAddr(''); }}>
            {ADOPTER_TYPES.map((t) => <option key={t} value={t}>{t === 'individual' ? 'Individual (you)' : t}</option>)}
          </select>
        </Field>
      </div>

      {!isIndividual && (
        <div style={{ marginTop: '.4rem' }}>
          <Field label="Adopting organization (one you steward)">
            {orgOptions.length === 0 ? (
              <Banner tone="warn">You don’t steward an organization yet — create one below, or choose “Individual”.</Banner>
            ) : (
              <select style={inputStyle} value={orgAddr} onChange={(e) => setOrgAddr(e.target.value)}>
                <option value="">Select your organization…</option>
                {orgOptions.map((o) => <option key={o.orgAgent} value={o.orgAgent}>{o.orgName || o.orgAgent}</option>)}
              </select>
            )}
          </Field>
        </div>
      )}

      <div style={{ margin: '.6rem 0', fontSize: '.8rem', color: 'var(--c-g500)' }}>
        Expressed by:{' '}
        <b style={{ color: 'var(--c-g800)' }}>
          {isIndividual ? `${personName} (your person agent)` : selectedOrg?.orgName || '— select an organization —'}
        </b>
      </div>

      <Btn busy={busy} onClick={request}>Request a facilitator →</Btn>
      {msg && <div style={{ marginTop: '.8rem' }}><Banner tone="ok">{msg}</Banner></div>}
      {err && <div style={{ marginTop: '.8rem' }}><Banner tone="err">{err}</Banner></div>}
    </Card>
  );
}
