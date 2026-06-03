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
import { loadReceivedDelegations, type ReceivedOrgDelegation } from '../lib/vault';
import { setupOperatorHome, operatorSignInUrl } from '../lib/operator-home';
import { personChainState, resolvePersonState, type PersonChainState } from '../lib/person-sa';
import type { PersonaName } from '../lib/personas';
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

  // Auto-provision (D: "not behind manual Deploy buttons"). On mount, deploy the
  // org SA if it isn't already on chain — custody = Pete/Jill (the only association,
  // so they can sign issuance). Idempotent: ensureOrgDeployed getCode-checks first +
  // a cached deployed state short-circuits. On failure we surface a manual Retry.
  const provision = useCallback(async () => {
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

  useEffect(() => {
    let cancelled = false;
    const cached = orgChainState(org);
    if (cached?.deployed) { setState(cached); return; }
    // Show the predicted address immediately, then auto-provision.
    void (async () => {
      try {
        const addr = await predictOrgAddress(org);
        if (!cancelled) setState((s) => s ?? { name: org, custodian: persona.custodian.address, saAddress: addr, deployed: false });
      } catch { /* fall through to provision, which derives too */ }
      if (!cancelled) await provision();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org]);

  const label = org === 'global-church' ? 'Global Church' : 'JP';
  return (
    <Card>
      <SectionHead eyebrow="Default issuer · auto-provisioned" title={`${label} SA`} sub={`Mode-0, custodied by ${org === 'global-church' ? 'Pete' : 'Jill'}’s EOA (${shortHex(persona.custodian.address)}) — the custody is the only association, so ${org === 'global-church' ? 'Pete' : 'Jill'} can sign as the issuer.`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.4rem 1rem', alignItems: 'center', fontSize: '.85rem' }}>
        <span style={{ color: 'var(--c-g500)' }}>Name</span>
        <span>{state?.agentName ? <Mono>{state.agentName}</Mono> : '—'}</span>
        <span style={{ color: 'var(--c-g500)' }}>Address</span>
        <span><AddrLink addr={state?.saAddress} /></span>
        <span style={{ color: 'var(--c-g500)' }}>Status</span>
        <span>
          {state?.deployed
            ? <Pill tone="live">● Deployed on Base Sepolia</Pill>
            : busy
              ? <Pill tone="neutral">Provisioning…</Pill>
              : <Pill tone="warn">Predicted (not deployed)</Pill>}
        </span>
        {state?.deployTxHash && (
          <>
            <span style={{ color: 'var(--c-g500)' }}>Deploy tx</span>
            <span><TxLink hash={state.deployTxHash} /></span>
          </>
        )}
      </div>
      {err && (
        <div style={{ marginTop: '.8rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          <Banner tone="err">{err}</Banner>
          <div><Btn onClick={provision} busy={busy}>Retry provisioning</Btn></div>
        </div>
      )}
    </Card>
  );
}

// ─── Operator's own person agent + home (spec 247) ───────────────────────────
//
// Pete + Jill are real PERSON Smart Agents — siblings of their org, custodied by
// the same EOA (person SA @ salt 0, org SA @ salt 1). "Set up" deploys + names the
// person SA and registers the person→org link at their Connect home; "Open home"
// deep-links to `<handle>.impact-agent.me/you`, where they sign in with the SAME
// key and see their org + delegations (deep-link + sign-in-at-home; no handoff).
function OperatorHomeCard({ who }: { who: PersonaName }) {
  const [state, setState] = useState<PersonChainState | null>(() => personChainState(who));
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [opening, setOpening] = useState(false);

  // Resolve the deployed state from chain on mount (read-only, no deploy) so the
  // "Sign in at impact-agent.me" link is shown immediately — without first running
  // "Set up your home" on a fresh browser.
  useEffect(() => {
    let cancelled = false;
    void resolvePersonState(who).then((s) => { if (!cancelled) setState(s); }).catch(() => { /* keep cached/empty */ });
    return () => { cancelled = true; };
  }, [who]);

  const connect = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const p = await setupOperatorHome(who, setStep);
      setState(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState(personChainState(who));
    } finally {
      setBusy(false);
      setStep(null);
    }
  }, [who]);

  // One-click connect: sign the operator in at their .me home with their demo-jp key
  // (SIWE handoff) and open /you already signed in, where their org's delegations show.
  const openHome = useCallback(async () => {
    const s = state;
    if (!s?.deployed) return;
    setOpening(true);
    setErr(null);
    try {
      const url = await operatorSignInUrl(s);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  }, [state]);

  const label = who === 'pete' ? 'Pete' : 'Jill';
  return (
    <Card>
      <SectionHead
        eyebrow="Your person agent · spec 247"
        title={`${label}’s home`}
        sub={`${label} is a real person Smart Agent — a sibling of the org, custodied by the same key. Set it up, then open ${label}’s own home to sign in and see the org + delegations.`}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '.4rem 1rem', alignItems: 'center', fontSize: '.85rem' }}>
        <span style={{ color: 'var(--c-g500)' }}>Name</span>
        <span>{state?.agentName ? <Mono>{state.agentName}</Mono> : '—'}</span>
        <span style={{ color: 'var(--c-g500)' }}>Address</span>
        <span><AddrLink addr={state?.saAddress} /></span>
        <span style={{ color: 'var(--c-g500)' }}>Status</span>
        <span>
          {state?.deployed
            ? <Pill tone="live">● Deployed + named</Pill>
            : busy
              ? <Pill tone="neutral">{step ?? 'Working…'}</Pill>
              : <Pill tone="warn">Not set up</Pill>}
        </span>
      </div>
      <div style={{ marginTop: '.8rem', display: 'flex', gap: '.7rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <Btn onClick={connect} busy={busy}>{state?.deployed ? 'Re-sync home' : `Set up ${label}’s home`}</Btn>
        {state?.deployed && (
          <Btn onClick={openHome} busy={opening}>Sign in at impact-agent.me ↗</Btn>
        )}
      </div>
      {state?.deployed && (
        <p style={{ marginTop: '.55rem', fontSize: '.8rem', color: 'var(--c-g500)' }}>
          Signs you in at impact-agent.me with this device’s key (no wallet) and opens your home — see{' '}
          {label === 'Jill' ? 'JP' : 'Global Church'}’s delegations under “Received by your organizations”.
        </p>
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
      <OperatorHomeCard who="jill" />
      <OrgDeployCard org="jp" />
      <DelegatedOrgsPanel />
      <IntentBoard />
      <AssociationIssuer />
    </div>
  );
}

/** spec 247: list the adopter/facilitator orgs that delegated scoped access to JP —
 *  read from JP's OWN vault (`delegation-received:<org>`), the single source. JP holds
 *  the org→broker grant it received; the broker reads it with JP's custodian key. */
function DelegatedOrgsPanel() {
  const [orgs, setOrgs] = useState<ReceivedOrgDelegation[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      // JP org SA must be deployed so its vault is addressable (the OrgDeployCard
      // auto-provisions it above; ensureOrgDeployed is idempotent + deduped).
      await ensureOrgDeployed('jp');
      const list = await loadReceivedDelegations();
      setOrgs(list);
      if (list.length === 0) setMsg('No orgs have delegated to JP yet. They are added to JP’s vault when an adopter/facilitator creates an org via demo-jp.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <Card>
      <SectionHead
        eyebrow="Spec 247 · received delegations"
        title="Orgs delegated to JP"
        sub="Adopter/facilitator orgs that granted JP scoped access during org creation — read from JP’s own vault (the single source). No person identity is exposed."
      />
      <Btn onClick={load} busy={busy}>Refresh delegated orgs</Btn>
      {msg && <div style={{ marginTop: '.8rem' }}><Banner tone="warn">{msg}</Banner></div>}
      {orgs.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          {orgs.map((o) => (
            <div key={o.orgAgent} style={{ display: 'flex', gap: '.6rem', alignItems: 'center', fontSize: '.84rem', padding: '.5rem 0', borderTop: '1px solid var(--c-g100)' }}>
              <Pill tone="ok">org</Pill>
              <span style={{ fontWeight: 700, color: 'var(--c-g800)' }}>{o.orgName || '(unnamed org)'}</span>
              <span style={{ marginLeft: 'auto' }}><AddrLink addr={o.orgAgent} /></span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Pick a party SA from JP's members (orgs delegated to JP), or fall back to a manual
 *  address. The value is always the org SA (0x…40), so the intent-flow validation passes
 *  unchanged — the dropdown just removes the copy-paste step. */
function PartySelect({ value, onChange, members, kindHint }: {
  value: string; onChange: (v: string) => void; members: ReceivedOrgDelegation[]; kindHint: string;
}) {
  const [manual, setManual] = useState(false);
  if (manual || members.length === 0) {
    return (
      <div>
        <input style={inputStyle} placeholder="0x…" value={value} onChange={(e) => onChange(e.target.value)} />
        {members.length > 0 && (
          <button type="button" onClick={() => { setManual(false); onChange(''); }}
            style={{ background: 'none', border: 'none', color: 'var(--c-primary)', cursor: 'pointer', fontSize: '.74rem', padding: '.25rem 0' }}>
            ↳ pick from JP members
          </button>
        )}
      </div>
    );
  }
  return (
    <div>
      <select style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select a {kindHint} (JP member)…</option>
        {members.map((m) => (
          <option key={m.orgAgent} value={m.orgAgent}>{m.orgName || shortHex(m.orgAgent)}</option>
        ))}
      </select>
      <button type="button" onClick={() => { setManual(true); onChange(''); }}
        style={{ background: 'none', border: 'none', color: 'var(--c-g500)', cursor: 'pointer', fontSize: '.74rem', padding: '.25rem 0' }}>
        ↳ enter an address manually
      </button>
    </div>
  );
}

function IntentBoard() {
  const [intents, setIntents] = useState<BoardIntent[]>([]);
  const [matches, setMatches] = useState<BoardMatch[]>([]);
  const [drafts, setDrafts] = useState<AgreementDraft[]>([]);

  const [fpgId, setFpgId] = useState(FPG_SEED[0]?.id ?? 'NAJDI');
  const [adopterAddr, setAdopterAddr] = useState('');
  const [facilitatorAddr, setFacilitatorAddr] = useState('');
  const [adopterType, setAdopterType] = useState('church');
  const [members, setMembers] = useState<ReceivedOrgDelegation[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // The broker board lives in JP Org's vault (spec 247) — load it once JP is
  // deployed (ensureOrgDeployed is idempotent + deduped, so this shares the
  // deploy card's provisioning rather than racing it). JP's member roster (the
  // orgs delegated to JP) is read from JP's OWN vault as its custodian (Jill),
  // through the demo-a2a boundary — that's what populates the party dropdowns so
  // the operator picks a member instead of pasting an address.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try { await ensureOrgDeployed('jp'); } catch { /* deploy card surfaces errors */ }
      if (cancelled) return;
      const [i, m, d, mem] = await Promise.all([loadIntents(), loadMatches(), loadDrafts(), loadReceivedDelegations()]);
      if (cancelled) return;
      setIntents(i); setMatches(m); setDrafts(d); setMembers(mem);
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = async (next: { i?: BoardIntent[]; m?: BoardMatch[]; d?: AgreementDraft[] }) => {
    if (next.i) { setIntents(next.i); await saveIntents(next.i); }
    if (next.m) { setMatches(next.m); await saveMatches(next.m); }
    if (next.d) { setDrafts(next.d); await saveDrafts(next.d); }
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
    await persist({ i: [...intents, row] });
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
    await persist({
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
    void persist({ d: [...drafts.filter((x) => x.matchId !== m.id), draft] });
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
          <Field label="Adopter party SA"><PartySelect value={adopterAddr} onChange={setAdopterAddr} members={members} kindHint="adopter org" /></Field>
          <Btn variant="ghost" onClick={() => express('receive')}>+ Express adopter need</Btn>
        </div>
        <div>
          <Field label="Facilitator party SA"><PartySelect value={facilitatorAddr} onChange={setFacilitatorAddr} members={members} kindHint="facilitator org" /></Field>
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
  const [associations, setAssociations] = useState<AssociationRow[]>([]);
  const [kind, setKind] = useState<'facilitator' | 'adopter'>('facilitator');
  const [subject, setSubject] = useState('');
  const [fpgId, setFpgId] = useState(FPG_SEED[0]?.id ?? 'NAJDI');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string; tx?: Hex } | null>(null);

  // Associations are JP's records → JP Org vault (spec 247); load once JP is up.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try { await ensureOrgDeployed('jp'); } catch { /* deploy card surfaces errors */ }
      const rows = await loadAssociations();
      if (!cancelled) setAssociations(rows);
    })();
    return () => { cancelled = true; };
  }, []);

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
      setAssociations(next); await saveAssociations(next);
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
      <OperatorHomeCard who="pete" />
      <OrgDeployCard org="global-church" />
      <IssuanceDesk />
    </div>
  );
}

function IssuanceDesk() {
  const [drafts, setDrafts] = useState<AgreementDraft[]>([]);
  const [issuance, setIssuance] = useState<IssuanceRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string; tx?: Hex } | null>(null);

  // Drafts + issuance live in JP Org's vault (spec 247) — drafts arrive from Jill;
  // Pete (Global Church) reads them via JP's custodian key (held in this demo
  // browser). Load once JP is up.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try { await ensureOrgDeployed('jp'); } catch { /* surfaced elsewhere */ }
      const [d, i] = await Promise.all([loadDrafts(), loadIssuance()]);
      if (cancelled) return;
      setDrafts(d); setIssuance(i);
    })();
    return () => { cancelled = true; };
  }, []);

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
      setIssuance(next); await saveIssuance(next);
      // Consume the draft + remember the issued credential for the joint assertion.
      lastIssued[res.id] = res.issued;
      const remaining = drafts.filter((x) => x.id !== d.id);
      setDrafts(remaining); await saveDrafts(remaining);
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
      setIssuance(next); await saveIssuance(next);
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

