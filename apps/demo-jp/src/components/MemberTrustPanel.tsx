// Member-facing trust record (Wave 8.12 — end-user capabilities). The adopter /
// facilitator's window into the live substrate, from their own seat:
//   1. Express your intent on the network (adopter need / facilitator offer) so
//      JP can broker a match — the end-user side of the Direct-Lane intent board.
//   2. See JP's recognition of you (the Association credential JP issued, on chain).
//   3. See the agreement(s) you're party to (AgreementRegistry), each verifiable.
//
// Everything here is scoped to the member's own SA address. The intent rows land
// in the shared broker vault so the JP (Jill) dashboard sees them; matches +
// agreements flow back here once the operators broker + issue.

import { useCallback, useMemo, useState } from 'react';
import type { Address } from '@agenticprimitives/types';

import { Card, SectionHead, Btn, Mono, Pill, Banner, TxLink, AddrLink, shortHex } from './ui';
import { expressIntent } from '../lib/intent-flow';
import { JP_INTENT_OBJECT } from '../lib/intent-payload';
import {
  loadIntents, saveIntents, loadAssociations, loadIssuance,
  type BoardIntent, type AssociationRow, type IssuanceRow,
} from '../lib/broker-store';
import { isAttestationValid, getAgreementRecord } from '../lib/chain';
import { findPeopleGroup } from '../lib/people-groups';

export function MemberTrustPanel({
  kind,
  address,
  fpgIds,
  adopterType,
}: {
  kind: 'adopter' | 'facilitator';
  address: Address;
  fpgIds: string[];
  adopterType?: string;
}) {
  const [intents, setIntents] = useState<BoardIntent[]>(() => loadIntents());
  const [associations] = useState<AssociationRow[]>(() => loadAssociations());
  const [issuance] = useState<IssuanceRow[]>(() => loadIssuance());
  const [verify, setVerify] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const a = address.toLowerCase();
  const mine = useMemo(() => intents.filter((i) => i.expressedBy.toLowerCase() === a), [intents, a]);
  const myAssoc = useMemo(() => associations.filter((x) => x.subjectOrg.toLowerCase() === a && x.associationKind === kind), [associations, a, kind]);
  const myAgreements = useMemo(
    () => issuance.filter((x) => x.adopterParty.toLowerCase() === a || x.facilitatorParty.toLowerCase() === a),
    [issuance, a],
  );

  const express = useCallback(async (fpgId: string) => {
    setBusy(true); setMsg(null);
    try {
      const direction = kind === 'adopter' ? 'receive' : 'give';
      const object = kind === 'adopter' ? JP_INTENT_OBJECT.NeedFacilitator : JP_INTENT_OBJECT.OfferFacilitator;
      const id = `int_${loadIntents().length}_${Date.now().toString(36)}`;
      // Run the real intent-flow (build + resolve) so the row is substrate-shaped.
      const at = adopterType as 'individual' | 'family' | 'group' | 'church' | 'organization' | 'network' | undefined;
      await expressIntent({ id, expressedBy: address, object, payload: { fpgId, adopterType: kind === 'adopter' ? at : undefined } });
      const pg = findPeopleGroup(fpgId);
      const row: BoardIntent = {
        id, direction, object: 'facilitator', fpgId,
        adopterType: kind === 'adopter' ? adopterType : undefined,
        expressedBy: address,
        label: kind === 'adopter' ? `Adopter needs a facilitator · ${pg?.name ?? fpgId}` : `Facilitator offers · ${pg?.name ?? fpgId}`,
        createdAt: new Date().toISOString(),
        state: 'expressed',
      };
      const next = [...loadIntents(), row];
      saveIntents(next); setIntents(next);
      setMsg(kind === 'adopter' ? 'Your need is on the network — JP can now broker a facilitator match.' : 'Your offering is on the network — JP can now match you to adopters.');
    } finally { setBusy(false); }
  }, [kind, address, adopterType]);

  const checkAssoc = useCallback(async (uid: string) => {
    const ok = await isAttestationValid(uid as `0x${string}`);
    setVerify((v) => ({ ...v, [uid]: ok ? 'valid on chain ✓' : 'not found' }));
  }, []);
  const checkAgreement = useCallback(async (commitment: string) => {
    const rec = await getAgreementRecord(commitment as `0x${string}`);
    setVerify((v) => ({ ...v, [commitment]: rec ? `status ${rec.status} ✓` : 'not registered' }));
  }, []);

  const expressedFpgs = new Set(mine.map((i) => i.fpgId));
  const verb = kind === 'adopter' ? 'adopt' : 'facilitate';

  return (
    <section className="section wrap" style={{ paddingTop: 0 }}>
      <div className="sec-head">
        <div className="eyebrow">Your trust record · Base Sepolia</div>
        <h2>What you can do on the network</h2>
        <p>JP runs the program on a shared trust substrate. From here you can put your intent on the network, see JP’s recognition of you, and see the agreements you’re part of — each one verifiable on chain, none of it holding your private data.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
        {/* 1. Express intent */}
        <Card>
          <SectionHead eyebrow="Step 1 · Intent" title={kind === 'adopter' ? 'Ask the network for a facilitator' : 'Offer to facilitate'} sub={`Publish your ${kind === 'adopter' ? 'need' : 'offering'} so JP can broker a match. Pre-consent only — you sign no specific deal until a commitment.`} />
          {fpgIds.length === 0 && <Banner tone="warn">Declare your {kind === 'adopter' ? 'adoption' : 'coverage'} above first, then express your intent here.</Banner>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
            {fpgIds.map((fpgId) => {
              const done = expressedFpgs.has(fpgId);
              const pg = findPeopleGroup(fpgId);
              return done
                ? <Pill key={fpgId} tone="live">✓ {pg?.name ?? fpgId} — on the network</Pill>
                : <Btn key={fpgId} variant="ghost" busy={busy} onClick={() => express(fpgId)}>Express: {verb} {pg?.name ?? fpgId}</Btn>;
            })}
          </div>
          {msg && <div style={{ marginTop: '.8rem' }}><Banner tone="ok">{msg}</Banner></div>}
        </Card>

        {/* 2. JP recognition */}
        <Card>
          <SectionHead eyebrow="Step 2 · Recognition" title="JP’s recognition of you" sub="The Association credential JP issued to your Smart Agent (AttestationRegistry). JP issues this from its broker desk." />
          {myAssoc.length === 0
            ? <p style={{ fontSize: '.85rem', color: 'var(--c-g400)' }}>Not recognized yet. Once JP approves you as {kind === 'adopter' ? 'an adopter' : 'a facilitator'}, it appears here.</p>
            : myAssoc.map((x) => (
              <div key={x.uid} style={{ display: 'flex', gap: '.6rem', alignItems: 'center', fontSize: '.83rem', padding: '.5rem 0', borderTop: '1px solid var(--c-g100)' }}>
                <Pill tone="ok">{x.associationKind}</Pill>
                <span style={{ color: 'var(--c-g500)' }}>{x.fpgIds.map((f) => findPeopleGroup(f)?.name ?? f).join(', ')}</span>
                <TxLink hash={x.txHash} />
                <Btn variant="ghost" style={{ marginLeft: 'auto', padding: '.3rem .6rem' }} onClick={() => checkAssoc(x.uid)}>Verify</Btn>
                {verify[x.uid] && <Pill tone="live">{verify[x.uid]}</Pill>}
              </div>
            ))}
        </Card>

        {/* 3. Agreements */}
        <Card>
          <SectionHead eyebrow="Step 3 · Agreement" title="Agreements you’re part of" sub="Commitment-only rows in the AgreementRegistry — your terms + contact stay in your Impact vault; only the hash is on chain." />
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
    </section>
  );
}
