// Operator dashboards (Wave 8.12) — the genuinely new surfaces that make the
// substrate spine visible end-to-end on Base Sepolia.
//
//   Jill  = JP (broker): deploy the JP org SA; run the Direct-Lane intent board
//           (express → match → commitment); hand drafts to Global Church; issue
//           Association credentials to org SAs (real AttestationRegistry write).
//   Pete  = Global Church (issuer): deploy the issuer org SA; register agreement
//           commitments (real AgreementRegistry write); publish the bilateral
//           joint-agreement assertion; verify rows back on chain.
//
// Every on-chain action routes through the issuer/broker org SA's execute()
// (onchain.ts) — msg.sender is the agent, gas is paymaster-sponsored.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { keccak256, toBytes } from 'viem';
import type { Address, Hex } from '@agenticprimitives/types';

import { Card, SectionHead, Btn, Mono, Pill, Field, inputStyle, Banner, AddrLink, TxLink, shortHex } from './ui';
import { PERSONA_META } from '../lib/persona-mode';
import { loadOrMintOrgPersona, type OrgName } from '../lib/org-personas';
import {
  ensureOrgDeployed,
  predictOrgAddress,
  orgChainState,
  issueAssociationOnChain,
  registerAgreementOnChain,
  submitJointAssertionOnChain,
  type OrgChainState,
} from '../lib/onchain';
import { getAgreementRecord, isAttestationValid } from '../lib/chain';
import { expressIntent, tryMatch, buildCommitment } from '../lib/intent-flow';
import { JP_INTENT_OBJECT } from '../lib/intent-payload';
import {
  loadIntents, saveIntents, loadMatches, saveMatches, loadDrafts, saveDrafts,
  loadIssuance, saveIssuance, loadAssociations, saveAssociations,
  type BoardIntent, type BoardMatch, type AgreementDraft, type IssuanceRow, type AssociationRow,
} from '../lib/broker-store';
import { FPG_SEED, findPeopleGroup, type PeopleGroup } from '../lib/people-groups';
import type { Hex32 } from '@agenticprimitives/attestations';

const ZERO32 = ('0x' + '00'.repeat(32)) as Hex32;

// ─── Shared org-deploy card ──────────────────────────────────────────────────

function OrgDeployCard({ org }: { org: OrgName }) {
  const persona = useMemo(() => loadOrMintOrgPersona(org), [org]);
  const [state, setState] = useState<OrgChainState | null>(() => orgChainState(org));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Predict the address (no deploy) on first mount so the SA is shown immediately.
  useEffect(() => {
    if (!state?.saAddress) {
      predictOrgAddress(org).then((addr) => setState({ name: org, custodian: persona.custodian.address, saAddress: addr, deployed: false })).catch(() => {});
    }
  }, [org, persona.custodian.address, state?.saAddress]);

  const deploy = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const s = await ensureOrgDeployed(org);
      setState(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState(orgChainState(org));
    } finally {
      setBusy(false);
    }
  }, [org]);

  const label = org === 'global-church' ? 'Global Church' : 'JP';
  return (
    <Card>
      <SectionHead eyebrow="Organization Smart Agent" title={`${label} SA`} sub={`Mode-0, custodied by ${org === 'global-church' ? 'Pete' : 'Jill'}’s EOA (${shortHex(persona.custodian.address)}).`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.4rem 1rem', alignItems: 'center', fontSize: '.85rem' }}>
        <span style={{ color: 'var(--c-g500)' }}>Address</span>
        <span><AddrLink addr={state?.saAddress} /></span>
        <span style={{ color: 'var(--c-g500)' }}>Status</span>
        <span>{state?.deployed ? <Pill tone="live">● Deployed on Base Sepolia</Pill> : <Pill tone="warn">Predicted (not deployed)</Pill>}</span>
        {state?.deployTxHash && (
          <>
            <span style={{ color: 'var(--c-g500)' }}>Deploy tx</span>
            <span><TxLink hash={state.deployTxHash} /></span>
          </>
        )}
      </div>
      {!state?.deployed && (
        <div style={{ marginTop: '1rem' }}>
          <Btn onClick={deploy} busy={busy}>Deploy on Base Sepolia</Btn>
        </div>
      )}
      {err && <div style={{ marginTop: '.8rem' }}><Banner tone="err">{err}</Banner></div>}
    </Card>
  );
}

function FpgSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>
      {FPG_SEED.map((g: PeopleGroup) => (
        <option key={g.id} value={g.id}>{g.name} — {g.country}</option>
      ))}
    </select>
  );
}

// ─── Jill (JP broker) ────────────────────────────────────────────────────────

export function JillDashboard() {
  const meta = PERSONA_META.jill;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 920, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      <header>
        <div className="eyebrow">{meta.glyph} Broker operator</div>
        <h1 style={{ fontSize: '1.6rem', marginTop: '.3rem' }}>JP — match brokerage</h1>
        <p style={{ color: 'var(--c-g600)', marginTop: '.4rem', maxWidth: '60ch' }}>{meta.blurb} Direct Lane only (D-27): adopter need ↔ facilitator offer.</p>
      </header>
      <OrgDeployCard org="jp" />
      <IntentBoard />
      <AssociationIssuer />
    </div>
  );
}

function IntentBoard() {
  const [intents, setIntents] = useState<BoardIntent[]>(() => loadIntents());
  const [matches, setMatches] = useState<BoardMatch[]>(() => loadMatches());
  const [drafts, setDrafts] = useState<AgreementDraft[]>(() => loadDrafts());

  const [fpgId, setFpgId] = useState(FPG_SEED[0]?.id ?? 'NAJDI');
  const [adopterAddr, setAdopterAddr] = useState('');
  const [facilitatorAddr, setFacilitatorAddr] = useState('');
  const [adopterType, setAdopterType] = useState('church');
  const [err, setErr] = useState<string | null>(null);

  const persist = (next: { i?: BoardIntent[]; m?: BoardMatch[]; d?: AgreementDraft[] }) => {
    if (next.i) { setIntents(next.i); saveIntents(next.i); }
    if (next.m) { setMatches(next.m); saveMatches(next.m); }
    if (next.d) { setDrafts(next.d); saveDrafts(next.d); }
  };

  const express = useCallback(async (direction: 'receive' | 'give') => {
    setErr(null);
    const addr = (direction === 'receive' ? adopterAddr : facilitatorAddr).trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { setErr('Enter a valid party SA address (0x…40 hex).'); return; }
    const id = `int_${intents.length}_${Date.now().toString(36)}`;
    const object = direction === 'receive' ? JP_INTENT_OBJECT.NeedFacilitator : JP_INTENT_OBJECT.OfferFacilitator;
    // Exercise the real intent-flow (build + resolve via PassThroughResolver).
    const at = adopterType as 'individual' | 'family' | 'group' | 'church' | 'organization' | 'network';
    await expressIntent({ id, expressedBy: addr as Address, object, payload: { fpgId, adopterType: direction === 'receive' ? at : undefined } });
    const row: BoardIntent = {
      id, direction, object: 'facilitator', fpgId,
      adopterType: direction === 'receive' ? adopterType : undefined,
      expressedBy: addr as Address,
      label: direction === 'receive' ? `Adopter needs facilitator · ${findPeopleGroup(fpgId)?.name ?? fpgId}` : `Facilitator offers · ${findPeopleGroup(fpgId)?.name ?? fpgId}`,
      createdAt: new Date().toISOString(),
      state: 'expressed',
    };
    persist({ i: [...intents, row] });
  }, [adopterAddr, facilitatorAddr, fpgId, adopterType, intents]);

  const runMatch = useCallback(async (need: BoardIntent, offer: BoardIntent) => {
    setErr(null);
    if (need.fpgId !== offer.fpgId) { setErr('Intents must share the same FPG to match.'); return; }
    const broker = orgChainState('jp')?.saAddress ?? loadOrMintOrgPersona('jp').saAddress;
    // Rebuild the substrate intents to feed tryMatch (opposite direction + same object).
    const needIntent = await expressIntent({ id: need.id, expressedBy: need.expressedBy, object: JP_INTENT_OBJECT.NeedFacilitator, payload: { fpgId: need.fpgId } });
    const offerIntent = await expressIntent({ id: offer.id, expressedBy: offer.expressedBy, object: JP_INTENT_OBJECT.OfferFacilitator, payload: { fpgId: offer.fpgId } });
    // NeedFacilitator (receive) vs OfferFacilitator (give): different objects in the
    // SKOS taxonomy, so align them on the shared "facilitator" object for the demo's
    // direct lane (receive-facilitator ↔ give-facilitator).
    needIntent.intent.object = 'apint:Facilitator';
    needIntent.intent.direction = 'receive';
    offerIntent.intent.object = 'apint:Facilitator';
    offerIntent.intent.direction = 'give';
    const m = tryMatch(broker, needIntent.intent, offerIntent.intent, { topicSimilarityThreshold: 0 });
    if (!m) { setErr('No compatible match (SS-01: needs opposite direction + same object).'); return; }
    const commitment = buildCommitment({ intentMatch: m, parties: [need.expressedBy, offer.expressedBy] });
    const row: BoardMatch = {
      id: m.id, receiveIntentId: need.id, giveIntentId: offer.id,
      matchScore: m.matchScore, rationale: m.rationale ?? '', brokeredAt: new Date().toISOString(),
      adopterParty: need.expressedBy, facilitatorParty: offer.expressedBy, fpgId: need.fpgId,
    };
    void commitment;
    persist({
      m: [...matches.filter((x) => x.id !== row.id), row],
      i: intents.map((x) => (x.id === need.id || x.id === offer.id ? { ...x, state: 'matched' } : x)),
    });
  }, [matches, intents]);

  const draftFor = useCallback((m: BoardMatch) => {
    const fpg = findPeopleGroup(m.fpgId);
    const draft: AgreementDraft = {
      id: `draft_${drafts.length}_${Date.now().toString(36)}`,
      matchId: m.id,
      adopterParty: m.adopterParty,
      facilitatorParty: m.facilitatorParty,
      fpgId: m.fpgId,
      termsText: `Adopter commits to 12 months of prayer + monthly support for the ${fpg?.name ?? m.fpgId}; facilitator provides quarterly field updates + on-the-ground coordination.`,
      capabilityList: ['receive-quarterly-updates', 'send-monthly-support', 'request-prayer-focus'],
      draftedAt: new Date().toISOString(),
    };
    persist({ d: [...drafts.filter((x) => x.matchId !== m.id), draft] });
  }, [drafts]);

  const needs = intents.filter((i) => i.direction === 'receive');
  const offers = intents.filter((i) => i.direction === 'give');

  return (
    <Card>
      <SectionHead eyebrow="Direct Lane · Intent → Match → Commitment" title="Intent board" sub="Express adopter needs + facilitator offerings, then broker a match. Vault-only (D-28); the commitment is the hand-off to Global Church." />
      {err && <div style={{ marginBottom: '.9rem' }}><Banner tone="err">{err}</Banner></div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <Field label="People group"><FpgSelect value={fpgId} onChange={setFpgId} /></Field>
          <Field label="Adopter type">
            <select style={inputStyle} value={adopterType} onChange={(e) => setAdopterType(e.target.value)}>
              {['individual', 'family', 'group', 'church', 'organization', 'network'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Adopter party SA"><input style={inputStyle} placeholder="0x…" value={adopterAddr} onChange={(e) => setAdopterAddr(e.target.value)} /></Field>
          <Btn variant="ghost" onClick={() => express('receive')}>+ Express adopter need</Btn>
        </div>
        <div>
          <Field label="Facilitator party SA"><input style={inputStyle} placeholder="0x…" value={facilitatorAddr} onChange={(e) => setFacilitatorAddr(e.target.value)} /></Field>
          <Btn variant="ghost" onClick={() => express('give')}>+ Express facilitator offering</Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <IntentColumn title="Adopter needs" rows={needs} />
        <IntentColumn title="Facilitator offerings" rows={offers} />
      </div>

      {needs.length > 0 && offers.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h3 style={{ fontSize: '.95rem', marginBottom: '.5rem' }}>Broker a match</h3>
          {needs.flatMap((n) => offers.filter((o) => o.fpgId === n.fpgId).map((o) => (
            <div key={`${n.id}:${o.id}`} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.5rem 0', borderTop: '1px solid var(--c-g100)', fontSize: '.84rem' }}>
              <Pill>{findPeopleGroup(n.fpgId)?.name ?? n.fpgId}</Pill>
              <span style={{ color: 'var(--c-g600)' }}><AddrLink addr={n.expressedBy} /> ↔ <AddrLink addr={o.expressedBy} /></span>
              <Btn variant="ghost" style={{ marginLeft: 'auto', padding: '.35rem .7rem' }} onClick={() => runMatch(n, o)}>Run match</Btn>
            </div>
          )))}
        </div>
      )}

      {matches.length > 0 && (
        <div style={{ marginTop: '1.25rem' }}>
          <h3 style={{ fontSize: '.95rem', marginBottom: '.5rem' }}>Matches → draft for Global Church (D-8)</h3>
          {matches.map((m) => {
            const drafted = drafts.some((d) => d.matchId === m.id);
            return (
              <div key={m.id} style={{ border: '1px solid var(--c-g200)', borderRadius: 10, padding: '.7rem .9rem', marginBottom: '.6rem', fontSize: '.84rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                  <Pill tone="ok">match {m.matchScore}/10000</Pill>
                  <span>{findPeopleGroup(m.fpgId)?.name ?? m.fpgId}</span>
                  {drafted ? <Pill tone="live">drafted →</Pill> : <Btn variant="ghost" style={{ marginLeft: 'auto', padding: '.35rem .7rem' }} onClick={() => draftFor(m)}>Draft agreement</Btn>}
                </div>
                <p style={{ color: 'var(--c-g500)', marginTop: '.4rem' }}>{m.rationale}</p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function IntentColumn({ title, rows }: { title: string; rows: BoardIntent[] }) {
  return (
    <div>
      <h4 style={{ fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--c-g500)', marginBottom: '.4rem' }}>{title}</h4>
      {rows.length === 0 && <p style={{ fontSize: '.82rem', color: 'var(--c-g400)' }}>None yet.</p>}
      {rows.map((r) => (
        <div key={r.id} style={{ border: '1px solid var(--c-g200)', borderRadius: 9, padding: '.5rem .7rem', marginBottom: '.4rem', fontSize: '.82rem' }}>
          <div style={{ fontWeight: 700, color: 'var(--c-g800)' }}>{r.label}</div>
          <div style={{ color: 'var(--c-g500)', marginTop: '.2rem' }}>
            <AddrLink addr={r.expressedBy} /> {r.state === 'matched' && <Pill tone="ok">matched</Pill>}
          </div>
        </div>
      ))}
    </div>
  );
}

function AssociationIssuer() {
  const [associations, setAssociations] = useState<AssociationRow[]>(() => loadAssociations());
  const [kind, setKind] = useState<'facilitator' | 'adopter'>('facilitator');
  const [subject, setSubject] = useState('');
  const [fpgId, setFpgId] = useState(FPG_SEED[0]?.id ?? 'NAJDI');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string; tx?: Hex } | null>(null);

  const issue = useCallback(async () => {
    setMsg(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(subject.trim())) { setMsg({ tone: 'err', text: 'Enter a valid subject org SA address.' }); return; }
    setBusy(true);
    try {
      const res = await issueAssociationOnChain({
        subjectOrg: subject.trim() as Address,
        body: { associationKind: kind, role: 'approved', fpgIds: [fpgId], ...(kind === 'adopter' ? { adopterType: 'church', mouHash: ZERO32 } : { countries: [findPeopleGroup(fpgId)?.country ?? 'XX'] }) },
        validFrom: new Date().toISOString(),
        salt: BigInt(Date.now()),
      });
      if (!res.ok) { setMsg({ tone: 'err', text: res.error ?? 'issuance failed' }); return; }
      const row: AssociationRow = { uid: res.id ?? ('0x' as Hex), subjectOrg: subject.trim() as Address, associationKind: kind, fpgIds: [fpgId], issuedAt: new Date().toISOString(), txHash: res.txHash };
      const next = [row, ...associations];
      setAssociations(next); saveAssociations(next);
      setMsg({ tone: 'ok', text: `Association issued + asserted on Base Sepolia.`, tx: res.txHash });
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [subject, kind, fpgId, associations]);

  return (
    <Card>
      <SectionHead eyebrow="Agentic Trust · AttestationRegistry" title="Issue Association credential" sub="JP recognizes an org SA as an approved facilitator/adopter. Signs the credential as the JP SA and writes the public Association assertion on chain (subject = org, issuer = JP)." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <Field label="Kind">
          <select style={inputStyle} value={kind} onChange={(e) => setKind(e.target.value as 'facilitator' | 'adopter')}>
            <option value="facilitator">Facilitator</option>
            <option value="adopter">Adopter</option>
          </select>
        </Field>
        <Field label="People group"><FpgSelect value={fpgId} onChange={setFpgId} /></Field>
      </div>
      <Field label="Subject org SA"><input style={inputStyle} placeholder="0x…" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Btn onClick={issue} busy={busy}>Issue + assert on chain</Btn>
      {msg && <div style={{ marginTop: '.8rem' }}><Banner tone={msg.tone}>{msg.text} {msg.tx && <TxLink hash={msg.tx} />}</Banner></div>}

      {associations.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h4 style={{ fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--c-g500)', marginBottom: '.4rem' }}>Issued associations</h4>
          {associations.map((a) => (
            <div key={a.uid} style={{ display: 'flex', gap: '.6rem', alignItems: 'center', fontSize: '.82rem', padding: '.4rem 0', borderTop: '1px solid var(--c-g100)' }}>
              <Pill tone={a.associationKind === 'facilitator' ? 'ok' : 'neutral'}>{a.associationKind}</Pill>
              <AddrLink addr={a.subjectOrg} />
              <span style={{ color: 'var(--c-g500)' }}>UID <Mono>{shortHex(a.uid)}</Mono></span>
              <span style={{ marginLeft: 'auto' }}><TxLink hash={a.txHash} /></span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Pete (Global Church issuer) ──────────────────────────────────────────────

export function PeteDashboard() {
  const meta = PERSONA_META.pete;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 920, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      <header>
        <div className="eyebrow">{meta.glyph} Issuer operator</div>
        <h1 style={{ fontSize: '1.6rem', marginTop: '.3rem' }}>Global Church — agreement issuance</h1>
        <p style={{ color: 'var(--c-g600)', marginTop: '.4rem', maxWidth: '60ch' }}>{meta.blurb} Issues the AgreementCredential + registers the commitment-only row, then publishes the bilateral joint assertion.</p>
      </header>
      <OrgDeployCard org="global-church" />
      <IssuanceDesk />
    </div>
  );
}

function IssuanceDesk() {
  const [drafts, setDrafts] = useState<AgreementDraft[]>(() => loadDrafts());
  const [issuance, setIssuance] = useState<IssuanceRow[]>(() => loadIssuance());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string; tx?: Hex } | null>(null);

  // Refresh from the broker store on mount (drafts arrive from Jill).
  useEffect(() => { setDrafts(loadDrafts()); }, []);

  const register = useCallback(async (d: AgreementDraft) => {
    setBusyId(d.id); setMsg(null);
    try {
      const res = await registerAgreementOnChain({
        party1: d.adopterParty,
        party2: d.facilitatorParty,
        payload: { agreementKind: 'facilitator-adopter', fpgId: d.fpgId, termsText: d.termsText, capabilityList: d.capabilityList, validFrom: new Date().toISOString() },
        salt: BigInt(Date.now()),
      });
      if (!res.ok || !res.id) { setMsg({ tone: 'err', text: res.error ?? 'register failed' }); return; }
      const row: IssuanceRow = { agreementCommitment: res.id, adopterParty: d.adopterParty, facilitatorParty: d.facilitatorParty, fpgId: d.fpgId, registeredAt: new Date().toISOString(), registerTxHash: res.txHash };
      const next = [row, ...issuance];
      setIssuance(next); saveIssuance(next);
      // Consume the draft + remember the issued credential for the joint assertion.
      lastIssued[res.id] = res.issued;
      const remaining = drafts.filter((x) => x.id !== d.id);
      setDrafts(remaining); saveDrafts(remaining);
      setMsg({ tone: 'ok', text: 'Agreement commitment registered on chain.', tx: res.txHash });
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally { setBusyId(null); }
  }, [drafts, issuance]);

  const publishJoint = useCallback(async (row: IssuanceRow) => {
    setBusyId(row.agreementCommitment); setMsg(null);
    try {
      const issued = lastIssued[row.agreementCommitment];
      if (!issued) { setMsg({ tone: 'err', text: 'Re-register first (issued credential not cached this session).' }); return; }
      const bilateralConsentRef = keccak256(toBytes(`bilateral:${row.adopterParty}:${row.facilitatorParty}:${row.agreementCommitment}`)) as Hex32;
      const res = await submitJointAssertionOnChain({
        credential: issued.credential,
        party1: row.adopterParty,
        party2: row.facilitatorParty,
        agreementCommitment: row.agreementCommitment as Hex32,
        bilateralConsentRef,
        salt: BigInt(Date.now()),
      });
      if (!res.ok) { setMsg({ tone: 'err', text: res.error ?? 'joint assertion failed' }); return; }
      const next = issuance.map((x) => x.agreementCommitment === row.agreementCommitment ? { ...x, jointAssertionTxHash: res.txHash } : x);
      setIssuance(next); saveIssuance(next);
      setMsg({ tone: 'ok', text: 'Bilateral joint assertion published on chain.', tx: res.txHash });
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally { setBusyId(null); }
  }, [issuance]);

  const verify = useCallback(async (row: IssuanceRow) => {
    setBusyId(row.agreementCommitment); setMsg(null);
    try {
      const rec = await getAgreementRecord(row.agreementCommitment);
      const valid = rec ? 'status ' + rec.status : 'not found';
      setMsg({ tone: rec ? 'ok' : 'err', text: `On-chain agreement row: ${valid}.` });
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally { setBusyId(null); }
  }, []);

  return (
    <Card>
      <SectionHead eyebrow="AgreementRegistry + AttestationRegistry" title="Issuance desk" sub="Drafts arrive from JP (D-8 holding cell). Register the commitment, then publish the bilateral joint assertion." />
      {msg && <div style={{ marginBottom: '.9rem' }}><Banner tone={msg.tone}>{msg.text} {msg.tx && <TxLink hash={msg.tx} />}</Banner></div>}

      <h4 style={{ fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--c-g500)', marginBottom: '.4rem' }}>Pending drafts</h4>
      {drafts.length === 0 && <p style={{ fontSize: '.84rem', color: 'var(--c-g400)' }}>No drafts. Switch to Jill to broker a match and draft one.</p>}
      {drafts.map((d) => (
        <div key={d.id} style={{ border: '1px solid var(--c-g200)', borderRadius: 10, padding: '.8rem 1rem', marginBottom: '.6rem' }}>
          <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', fontSize: '.84rem' }}>
            <Pill>{findPeopleGroup(d.fpgId)?.name ?? d.fpgId}</Pill>
            <span style={{ color: 'var(--c-g600)' }}><AddrLink addr={d.adopterParty} /> ↔ <AddrLink addr={d.facilitatorParty} /></span>
            <Btn style={{ marginLeft: 'auto', padding: '.4rem .8rem' }} busy={busyId === d.id} onClick={() => register(d)}>Register on chain</Btn>
          </div>
          <p style={{ fontSize: '.82rem', color: 'var(--c-g500)', marginTop: '.5rem' }}>{d.termsText}</p>
          <div style={{ marginTop: '.4rem', display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>{d.capabilityList.map((c) => <Pill key={c} tone="neutral">{c}</Pill>)}</div>
        </div>
      ))}

      {issuance.length > 0 && (
        <div style={{ marginTop: '1.25rem' }}>
          <h4 style={{ fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--c-g500)', marginBottom: '.4rem' }}>Issuance log</h4>
          {issuance.map((row) => (
            <div key={row.agreementCommitment} style={{ border: '1px solid var(--c-g200)', borderRadius: 10, padding: '.8rem 1rem', marginBottom: '.6rem', fontSize: '.83rem' }}>
              <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <Pill>{findPeopleGroup(row.fpgId)?.name ?? row.fpgId}</Pill>
                <span style={{ color: 'var(--c-g500)' }}>commitment <Mono>{shortHex(row.agreementCommitment)}</Mono></span>
                <TxLink hash={row.registerTxHash} label="register" />
              </div>
              <div style={{ display: 'flex', gap: '.5rem', marginTop: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {row.jointAssertionTxHash
                  ? <><Pill tone="live">joint asserted</Pill><TxLink hash={row.jointAssertionTxHash} label="assertion" /></>
                  : <Btn variant="ghost" style={{ padding: '.35rem .7rem' }} busy={busyId === row.agreementCommitment} onClick={() => publishJoint(row)}>Publish joint assertion</Btn>}
                <Btn variant="ghost" style={{ padding: '.35rem .7rem' }} busy={busyId === row.agreementCommitment} onClick={() => verify(row)}>Verify on chain</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Session cache of issued AgreementCredentials keyed by commitment (the credential
// body is needed to publish the joint assertion; it isn't persisted to localStorage
// to keep the full VC body out of long-lived demo storage).
const lastIssued: Record<string, Awaited<ReturnType<typeof registerAgreementOnChain>>['issued']> = {};

// ─── Adopter-Org / Facilitator-Org views (Wave 8.12) ────────────────────────

/** Read-only view of an organization Smart Agent: the Association credential JP
 *  issued it, and the agreements it's party to — each verifiable on chain. The
 *  org's confidential profile + signed docs live in Impact; this surface holds
 *  only the public anchors (the on-chain rows). */
export function OrgDashboard({ kind, orgAddress }: { kind: 'adopter' | 'facilitator'; orgAddress: Address | null }) {
  const [associations] = useState<AssociationRow[]>(() => loadAssociations());
  const [issuance] = useState<IssuanceRow[]>(() => loadIssuance());
  const [verify, setVerify] = useState<Record<string, string>>({});

  const mine = useMemo(() => {
    if (!orgAddress) return { assoc: [] as AssociationRow[], agreements: [] as IssuanceRow[] };
    const a = orgAddress.toLowerCase();
    return {
      assoc: associations.filter((x) => x.subjectOrg.toLowerCase() === a && x.associationKind === kind),
      agreements: issuance.filter((x) => x.adopterParty.toLowerCase() === a || x.facilitatorParty.toLowerCase() === a),
    };
  }, [orgAddress, associations, issuance, kind]);

  const checkAssoc = useCallback(async (uid: Hex) => {
    const ok = await isAttestationValid(uid);
    setVerify((v) => ({ ...v, [uid]: ok ? 'valid on chain ✓' : 'not valid / not found' }));
  }, []);
  const checkAgreement = useCallback(async (commitment: Hex) => {
    const rec = await getAgreementRecord(commitment);
    setVerify((v) => ({ ...v, [commitment]: rec ? `status ${rec.status} ✓` : 'not registered' }));
  }, []);

  const label = kind === 'adopter' ? 'Adopter Org' : 'Facilitator Org';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 920, margin: '0 auto', padding: '1.5rem 1rem 4rem' }}>
      <header>
        <div className="eyebrow">{kind === 'adopter' ? '🏛️' : '🏢'} Organization Smart Agent</div>
        <h1 style={{ fontSize: '1.6rem', marginTop: '.3rem' }}>{label}</h1>
        <p style={{ color: 'var(--c-g600)', marginTop: '.4rem', maxWidth: '62ch' }}>
          The public anchors for this organization’s Smart Agent — the recognition JP issued + the agreements it’s party to. Confidential profile + signed MOU/WEA stay in the member’s Impact home.
        </p>
      </header>

      {!orgAddress && (
        <Card><Banner tone="warn">Sign in as a member (Adopter / Facilitator persona) so the org Smart Agent address is known. This view reads the on-chain rows scoped to that address.</Banner></Card>
      )}

      {orgAddress && (
        <>
          <Card>
            <SectionHead eyebrow="Identity" title="Org SA address" />
            <AddrLink addr={orgAddress} />
          </Card>

          <Card>
            <SectionHead eyebrow="Agentic Trust" title="JP recognition" sub="The Association credential JP issued to this org (AttestationRegistry)." />
            {mine.assoc.length === 0 && <p style={{ fontSize: '.85rem', color: 'var(--c-g400)' }}>No association yet. JP issues this from the broker (Jill) dashboard.</p>}
            {mine.assoc.map((a) => (
              <div key={a.uid} style={{ display: 'flex', gap: '.6rem', alignItems: 'center', fontSize: '.83rem', padding: '.5rem 0', borderTop: '1px solid var(--c-g100)' }}>
                <Pill tone="ok">{a.associationKind}</Pill>
                <span style={{ color: 'var(--c-g500)' }}>UID <Mono>{shortHex(a.uid)}</Mono></span>
                <TxLink hash={a.txHash} />
                <Btn variant="ghost" style={{ marginLeft: 'auto', padding: '.3rem .6rem' }} onClick={() => checkAssoc(a.uid)}>Verify</Btn>
                {verify[a.uid] && <Pill tone="live">{verify[a.uid]}</Pill>}
              </div>
            ))}
          </Card>

          <Card>
            <SectionHead eyebrow="Agreements" title="On-chain commitments" sub="The agreement rows this org is party to (AgreementRegistry, commitment-only)." />
            {mine.agreements.length === 0 && <p style={{ fontSize: '.85rem', color: 'var(--c-g400)' }}>No agreements yet.</p>}
            {mine.agreements.map((row) => (
              <div key={row.agreementCommitment} style={{ fontSize: '.83rem', padding: '.5rem 0', borderTop: '1px solid var(--c-g100)' }}>
                <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Pill>{findPeopleGroup(row.fpgId)?.name ?? row.fpgId}</Pill>
                  <span style={{ color: 'var(--c-g500)' }}>commitment <Mono>{shortHex(row.agreementCommitment)}</Mono></span>
                  <TxLink hash={row.registerTxHash} label="register" />
                  {row.jointAssertionTxHash && <TxLink hash={row.jointAssertionTxHash} label="joint" />}
                  <Btn variant="ghost" style={{ marginLeft: 'auto', padding: '.3rem .6rem' }} onClick={() => checkAgreement(row.agreementCommitment)}>Verify</Btn>
                  {verify[row.agreementCommitment] && <Pill tone="live">{verify[row.agreementCommitment]}</Pill>}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
