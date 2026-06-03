// The org's window into the live substrate (acting AS the organization, not the
// individual). Scoped to the member org's Smart Agent address:
//   1. Express the org's intent on the network (adopter need / facilitator offer)
//      so JP can broker a match — the org side of the Direct-Lane intent board.
//   2. See JP's recognition of the org (the Association credential, on chain).
//   3. See the agreement(s) the org is party to (AgreementRegistry), verifiable.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Address } from '@agenticprimitives/types';

import { Card, SectionHead, Btn, Mono, Pill, Field, inputStyle, Banner, TxLink, AddrLink, shortHex } from './ui';
import { expressIntent } from '../lib/intent-flow';
import { JP_INTENT_OBJECT } from '../lib/intent-payload';
import {
  loadIntents, saveIntents, loadAssociations, loadIssuance,
  type BoardIntent, type AssociationRow, type IssuanceRow,
} from '../lib/broker-store';
import { ensureOrgDeployed } from '../lib/onchain';
import { getAgreementRecord } from '../lib/chain';
import { FPG_SEED, findPeopleGroup } from '../lib/people-groups';

const ADOPTER_TYPES = ['individual', 'family', 'group', 'church', 'organization', 'network'] as const;

export function MemberTrustPanel({
  kind,
  orgAgent,
  orgName,
}: {
  kind: 'adopter' | 'facilitator';
  orgAgent: Address;
  orgName: string;
}) {
  const [intents, setIntents] = useState<BoardIntent[]>([]);
  const [associations, setAssociations] = useState<AssociationRow[]>([]);
  const [issuance, setIssuance] = useState<IssuanceRow[]>([]);
  const [verify, setVerify] = useState<Record<string, string>>({});
  const [fpgId, setFpgId] = useState(FPG_SEED[0]?.id ?? 'NAJDI');
  const [adopterType, setAdopterType] = useState<(typeof ADOPTER_TYPES)[number]>('church');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // The broker board + JP's recognition live in JP Org's vault (spec 247) — load
  // once JP is deployed (the org reads JP's view of itself via JP's custodian key).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try { await ensureOrgDeployed('jp'); } catch { /* surfaced on the operator dash */ }
      const [i, assoc, iss] = await Promise.all([loadIntents(), loadAssociations(), loadIssuance()]);
      if (cancelled) return;
      setIntents(i); setAssociations(assoc); setIssuance(iss);
    })();
    return () => { cancelled = true; };
  }, []);

  const a = orgAgent.toLowerCase();
  const mine = useMemo(() => intents.filter((i) => i.expressedBy.toLowerCase() === a), [intents, a]);
  const myAssoc = useMemo(() => associations.filter((x) => x.subjectOrg.toLowerCase() === a && x.associationKind === kind), [associations, a, kind]);
  const myAgreements = useMemo(
    () => issuance.filter((x) => x.adopterParty.toLowerCase() === a || x.facilitatorParty.toLowerCase() === a),
    [issuance, a],
  );

  const express = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      const direction = kind === 'adopter' ? 'receive' : 'give';
      const object = kind === 'adopter' ? JP_INTENT_OBJECT.NeedFacilitator : JP_INTENT_OBJECT.OfferFacilitator;
      const current = await loadIntents();
      const id = `int_${current.length}_${Date.now().toString(36)}`;
      await expressIntent({ id, expressedBy: orgAgent, object, payload: { fpgId, adopterType: kind === 'adopter' ? adopterType : undefined } });
      const pg = findPeopleGroup(fpgId);
      const row: BoardIntent = {
        id, direction, object: 'facilitator', fpgId,
        adopterType: kind === 'adopter' ? adopterType : undefined,
        expressedBy: orgAgent,
        label: kind === 'adopter' ? `${orgName} needs a facilitator · ${pg?.name ?? fpgId}` : `${orgName} offers to facilitate · ${pg?.name ?? fpgId}`,
        createdAt: new Date().toISOString(),
        state: 'expressed',
      };
      const next = [...current, row];
      await saveIntents(next); setIntents(next);
      setMsg(kind === 'adopter' ? `${orgName}'s need is on the network — JP can broker a facilitator match.` : `${orgName}'s offering is on the network — JP can match you to adopters.`);
    } finally { setBusy(false); }
  }, [kind, orgAgent, orgName, fpgId, adopterType]);

  const checkAgreement = useCallback(async (commitment: string) => {
    const rec = await getAgreementRecord(commitment as `0x${string}`);
    setVerify((v) => ({ ...v, [commitment]: rec ? `status ${rec.status} ✓` : 'not registered' }));
  }, []);

  const verb = kind === 'adopter' ? 'adopt' : 'facilitate';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* 1. Express intent as the org */}
      <Card>
        <SectionHead eyebrow="Step 1 · Intent (as your org)" title={kind === 'adopter' ? 'Ask the network for a facilitator' : 'Offer to facilitate'} sub={`Publish ${orgName}'s ${kind === 'adopter' ? 'need' : 'offering'} so JP can broker a match. Pre-consent only — no specific deal is signed until a commitment.`} />
        <div style={{ display: 'grid', gridTemplateColumns: kind === 'adopter' ? '1fr 1fr' : '1fr', gap: '1rem' }}>
          <Field label="People group">
            <select style={inputStyle} value={fpgId} onChange={(e) => setFpgId(e.target.value)}>
              {FPG_SEED.map((g) => <option key={g.id} value={g.id}>{g.name} — {g.country}</option>)}
            </select>
          </Field>
          {kind === 'adopter' && (
            <Field label="Adopter type">
              <select style={inputStyle} value={adopterType} onChange={(e) => setAdopterType(e.target.value as (typeof ADOPTER_TYPES)[number])}>
                {ADOPTER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          )}
        </div>
        <Btn busy={busy} onClick={express}>Express: {verb} {findPeopleGroup(fpgId)?.name ?? fpgId}</Btn>
        {msg && <div style={{ marginTop: '.8rem' }}><Banner tone="ok">{msg}</Banner></div>}
        {mine.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <h4 style={{ fontSize: '.74rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--c-g500)', marginBottom: '.4rem' }}>On the network</h4>
            {mine.map((i) => (
              <div key={i.id} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', fontSize: '.82rem', padding: '.35rem 0', borderTop: '1px solid var(--c-g100)' }}>
                <Pill tone={i.state === 'matched' ? 'live' : 'ok'}>{i.state}</Pill>
                <span style={{ color: 'var(--c-g700)' }}>{i.label}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 2. JP recognition */}
      <Card>
        <SectionHead eyebrow="Step 2 · Recognition" title="JP's recognition of your org" sub="A JP-signed Association credential held off-chain — JP keeps it in its vault and delivered a copy to your org. It's not on the AttestationRegistry; this credential is what lets JP broker matches for you." />
        {myAssoc.length === 0
          ? <p style={{ fontSize: '.85rem', color: 'var(--c-g400)' }}>Not recognized yet. Once JP approves your org as {kind === 'adopter' ? 'an adopter' : 'a facilitator'}, the credential appears here.</p>
          : myAssoc.map((x) => (
            <div key={x.uid} style={{ display: 'flex', gap: '.6rem', alignItems: 'center', fontSize: '.83rem', padding: '.5rem 0', borderTop: '1px solid var(--c-g100)', flexWrap: 'wrap' }}>
              <Pill tone="ok">{x.associationKind}</Pill>
              <span style={{ color: 'var(--c-g500)' }}>{x.fpgIds.map((f) => findPeopleGroup(f)?.name ?? f).join(', ')}</span>
              <span style={{ color: 'var(--c-g500)' }}>credential <Mono>{shortHex(x.uid)}</Mono></span>
              <span style={{ marginLeft: 'auto' }}><Pill tone="live">JP-signed ✓ (off-chain)</Pill></span>
            </div>
          ))}
      </Card>

      {/* 3. Agreements */}
      <Card>
        <SectionHead eyebrow="Step 3 · Agreement" title="Agreements your org is part of" sub="Commitment-only rows in the AgreementRegistry — terms + contact stay in your Impact vault; only the hash is on chain." />
        {myAgreements.length === 0
          ? <p style={{ fontSize: '.85rem', color: 'var(--c-g400)' }}>No agreement yet. When JP brokers a match and Global Church issues the agreement, it shows here.</p>
          : myAgreements.map((row) => {
            const counterparty = row.adopterParty.toLowerCase() === a ? row.facilitatorParty : row.adopterParty;
            return (
              <div key={row.agreementCommitment} style={{ fontSize: '.83rem', padding: '.5rem 0', borderTop: '1px solid var(--c-g100)' }}>
                <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Pill>{findPeopleGroup(row.fpgId)?.name ?? row.fpgId}</Pill>
                  <span style={{ color: 'var(--c-g500)' }}>with <AddrLink addr={counterparty} /></span>
                  <span style={{ color: 'var(--c-g400)' }}>commitment <Mono>{shortHex(row.agreementCommitment)}</Mono></span>
                  <TxLink hash={row.registerTxHash} label="register" />
                  {row.jointAssertionTxHash && <TxLink hash={row.jointAssertionTxHash} label="joint" />}
                  <Btn variant="ghost" style={{ marginLeft: 'auto', padding: '.3rem .6rem' }} onClick={() => checkAgreement(row.agreementCommitment)}>Verify</Btn>
                  {verify[row.agreementCommitment] && <Pill tone="live">{verify[row.agreementCommitment]}</Pill>}
                </div>
              </div>
            );
          })}
      </Card>
    </div>
  );
}
