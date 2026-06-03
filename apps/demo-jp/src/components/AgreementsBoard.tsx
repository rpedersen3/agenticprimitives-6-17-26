// On-chain agreements + assertions view — the ONLY agreement detail an operator (GC/Pete
// as issuer, JP/Jill as broker) can actually see for issued agreements: the public chain.
//
// Everything here is read live from AgreementRegistry + AttestationRegistry + the naming
// service. The off-chain terms text + member contact live in the PARTIES' own vaults and
// are NOT readable here (the operators hold no delegation to them) — so this view shows
// only on-chain truth: status, the two parties (reverse-resolved to names), the agreement
// commitment, the joint-assertion validity, and the tx links. No private detail leaks in.

import { useEffect, useState } from 'react';
import type { Address } from '@agenticprimitives/types';

import { Card, SectionHead, Pill, Mono, TxLink, shortHex } from './ui';
import { loadIssuance, type IssuanceRow } from '../lib/broker-store';
import { getAgreementRecord, isAttestationValid, reverseName } from '../lib/chain';
import { ensureOrgDeployed } from '../lib/onchain';
import { findPeopleGroup } from '../lib/people-groups';

interface EnrichedRow extends IssuanceRow {
  status: number | null;
  assertionValid: boolean | null;
  issuer: Address | null;
  adopterName: string | null;
  facName: string | null;
}

function statusLabel(s: number | null): { text: string; tone: 'ok' | 'live' | 'neutral' } {
  if (s === null || s === 0) return { text: 'not registered', tone: 'neutral' };
  if (s === 1) return { text: 'Registered on chain', tone: 'ok' };
  return { text: `status ${s}`, tone: 'live' };
}

const party = (name: string | null, addr: Address) =>
  name ? <span title={addr} style={{ fontWeight: 700, color: 'var(--c-g800)' }}>{name}</span> : <Mono>{shortHex(addr)}</Mono>;

export function AgreementsBoard({ title, sub }: { title: string; sub: string }) {
  const [rows, setRows] = useState<EnrichedRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try { await ensureOrgDeployed('jp'); } catch { /* surfaced elsewhere */ }
      const iss = await loadIssuance().catch(() => [] as IssuanceRow[]);
      const enriched = await Promise.all(iss.map(async (r): Promise<EnrichedRow> => {
        const [rec, valid, adopterName, facName] = await Promise.all([
          getAgreementRecord(r.agreementCommitment),
          r.jointAssertionUid ? isAttestationValid(r.jointAssertionUid) : Promise.resolve(null),
          reverseName(r.adopterParty),
          reverseName(r.facilitatorParty),
        ]);
        return { ...r, status: rec ? Number(rec.status) : null, assertionValid: valid, issuer: rec?.issuer ?? null, adopterName, facName };
      }));
      if (!cancelled) { setRows(enriched); setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Card>
      <SectionHead eyebrow="On chain · AgreementRegistry + AttestationRegistry" title={title} sub={sub} />
      {!loaded ? (
        <p style={{ fontSize: '.85rem', color: 'var(--c-g400)' }}>Reading the chain…</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: '.85rem', color: 'var(--c-g400)' }}>No agreements on chain yet.</p>
      ) : (
        rows.map((r) => {
          const st = statusLabel(r.status);
          return (
            <div key={r.agreementCommitment} style={{ border: '1px solid var(--c-g200)', borderRadius: 10, padding: '.8rem 1rem', marginBottom: '.6rem', fontSize: '.83rem' }}>
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <Pill>{findPeopleGroup(r.fpgId)?.name ?? r.fpgId}</Pill>
                <Pill tone={st.tone}>{st.text}</Pill>
                {r.jointAssertionTxHash && (
                  r.assertionValid === null
                    ? <Pill tone="ok">joint asserted</Pill>
                    : <Pill tone={r.assertionValid ? 'live' : 'neutral'}>{r.assertionValid ? 'assertion valid ✓' : 'assertion revoked'}</Pill>
                )}
              </div>
              <div style={{ margin: '.55rem 0', color: 'var(--c-g600)', display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--c-g400)' }}>Adopter</span>
                {party(r.adopterName, r.adopterParty)}
                <span style={{ color: 'var(--c-g400)' }}>↔</span>
                <span style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--c-g400)' }}>Facilitator</span>
                {party(r.facName, r.facilitatorParty)}
              </div>
              <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap', color: 'var(--c-g500)' }}>
                <span>commitment <Mono>{shortHex(r.agreementCommitment)}</Mono></span>
                {r.issuer && <span>issuer <Mono>{shortHex(r.issuer)}</Mono></span>}
                {r.registerTxHash && <TxLink hash={r.registerTxHash} label="register" />}
                {r.jointAssertionTxHash && <TxLink hash={r.jointAssertionTxHash} label="assertion" />}
              </div>
            </div>
          );
        })
      )}
    </Card>
  );
}
