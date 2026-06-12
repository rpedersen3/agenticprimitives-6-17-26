import { useState } from 'react';
import type { Hex } from 'viem';
import { useApp } from '../app-context';
import { Step, S, TxLink, AddrLine } from '../ui';
import {
  expressAndMatch, agreeTerms, fulfil, settleBoundPayment,
  type IntentMatch, type Agreement, type Fulfilment, type BoundSettlement,
} from '../lib/flows';
import { toUsdc, fromUsdc } from '../lib/x402-pay';

const AMOUNT = toUsdc(0.5);
const short = (h?: string) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '—');

/**
 * Intent → fulfilment: express a need → match/agree → fulfil → settle the bound payment.
 * The PaymentReceipt's `contextBindingHash` folds {intentId, agreementCommitment, taskId,
 * artifactHash} — so it cryptographically links order ↔ fulfilment ↔ settlement.
 */
export function IntentFlow() {
  const app = useApp();
  const [match, setMatch] = useState<IntentMatch | null>(null);
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [ful, setFul] = useState<Fulfilment | null>(null);
  const [settled, setSettled] = useState<BoundSettlement | null>(null);

  const onExpress = () => {
    if (!app.treasurySa || !app.providerTreasury) { app.setStatus('set up your agent accounts first (top bar)'); return; }
    const m = expressAndMatch(app.treasurySa, app.providerTreasury);
    setMatch(m); setAgreement(null); setFul(null); setSettled(null);
    app.setStatus(m.compatible ? `Matched — score ${(m.matchScore / 100).toFixed(0)}%.` : 'No compatible counter-intent.');
  };

  const onAgree = () => {
    if (!match || !app.treasurySa || !app.providerTreasury) return;
    const a = agreeTerms({
      buyer: app.treasurySa, provider: app.providerTreasury, issuer: app.providerTreasury,
      terms: 'Premium consult — 1 session, delivered as a written brief.',
      schedule: 'on-demand, within 24h',
    });
    setAgreement(a); setFul(null); setSettled(null);
    app.setStatus(`Agreed — commitment ${short(a.agreementCommitment)}.`);
  };

  const onFulfil = () => {
    if (!match || !agreement || !app.providerTreasury) return;
    const f = fulfil({
      provider: app.providerTreasury, intentId: match.buyerIntent.id,
      agreementCommitment: agreement.agreementCommitment, deliverable: 'BRIEF: 3 recommendations + risks (demo artifact body).',
    });
    setFul(f); setSettled(null);
    app.setStatus(`Fulfilled — task ${short(f.task.taskId)} completed, artifact ${short(f.artifactHash)}.`);
  };

  const onSettle = () =>
    app.run('intent-settle', async () => {
      const ctx = app.payCtx();
      if (!ctx || !match || !agreement || !ful) throw new Error('run the earlier steps first');
      app.setStatus('Treasury SA settling the bound payment (gasless, SA → SA)…');
      const s = await settleBoundPayment(ctx, {
        amount: AMOUNT, intentId: match.buyerIntent.id, agreementCommitment: agreement.agreementCommitment,
        taskId: ful.task.taskId, artifactHash: ful.artifactHash,
      });
      setSettled(s);
      await new Promise((r) => setTimeout(r, 2000));
      await app.refresh();
      app.setStatus('Settled — receipt links order ↔ fulfilment ↔ settlement.');
    });

  return (
    <>
      <Step n="A" title="Express a need → match">
        <p style={S.hint}>You express a need (receive a service); the provider expresses an offer (give it). The marketplace matches opposite-direction intents on the same object.</p>
        <div style={{ ...S.rowBetween, marginTop: 12 }}>
          <span style={S.mono}>need: premium-consult</span>
          <button style={S.btn} disabled={!app.isConnected} onClick={onExpress}>Express &amp; match</button>
        </div>
        {match && (
          <ul style={{ ...S.rows, listStyle: 'none', padding: 0, marginTop: 12 }}>
            <li style={S.row3}><span>Your intent</span><span style={S.mono}>{short(match.buyerIntent.id)}</span><span>receive</span></li>
            <li style={S.row3}><span>Provider intent</span><span style={S.mono}>{short(match.providerIntent.id)}</span><span>give</span></li>
            <li style={S.row3}><strong>Match</strong><strong style={S.mono}>{(match.matchScore / 100).toFixed(0)}%</strong><span>{match.compatible ? '✓ compatible' : '✗'}</span></li>
          </ul>
        )}
      </Step>

      <Step n="B" title="Agree terms (commitment)">
        <p style={S.hint}>Both parties agree terms + schedule. Only the keccak <em>commitment</em> goes on the record — parties and terms stay private (spec 241).</p>
        <div style={{ ...S.rowBetween, marginTop: 12 }}>
          <span style={S.muted}>{agreement ? 'agreed' : 'awaiting match'}</span>
          <button style={S.btn} disabled={!match} onClick={onAgree}>Agree terms</button>
        </div>
        {agreement && <AddrLine label="agreementCommitment" addr={agreement.agreementCommitment} />}
      </Step>

      <Step n="C" title="Fulfil">
        <p style={S.hint}>The provider fulfils: a Task runs submitted → working → completed and produces an Artifact whose bodyHash anchors the deliverable (spec 244).</p>
        <div style={{ ...S.rowBetween, marginTop: 12 }}>
          <span style={S.muted}>{ful ? 'task completed' : 'awaiting agreement'}</span>
          <button style={S.btn} disabled={!agreement} onClick={onFulfil}>Fulfil</button>
        </div>
        {ful && (
          <>
            <AddrLine label="taskId" addr={ful.task.taskId} extra={ful.task.state} />
            <AddrLine label="artifactHash" addr={ful.artifactHash} />
          </>
        )}
      </Step>

      <Step n="D" title="Settle the bound payment">
        <p style={S.hint}>Settle a closed mandate bound to {`{intent, agreement, task, artifact}`}. Money moves SA → SA, gaslessly. The receipt folds the whole binding into <code>contextBindingHash</code>.</p>
        <div style={{ ...S.rowBetween, marginTop: 12 }}>
          <span style={S.mono}>{fromUsdc(AMOUNT)} USDC → provider</span>
          <button style={S.btn} disabled={!ful || app.busy === 'intent-settle'} onClick={onSettle}>
            {app.busy === 'intent-settle' ? 'Settling…' : `Settle ${fromUsdc(AMOUNT)} USDC`}
          </button>
        </div>
        {settled && (
          <div style={{ ...S.card, marginTop: 12 }}>
            <p style={S.hint}>✓ settled · <TxLink hash={settled.settlementHash as Hex} label="settlement ↗" /></p>
            <AddrLine label="order · intentId" addr={settled.mandate.contextBinding.intentId} />
            <AddrLine label="order · agreement" addr={settled.mandate.contextBinding.agreementCommitment} />
            <AddrLine label="fulfilment · taskId" addr={settled.mandate.contextBinding.taskId} />
            <AddrLine label="fulfilment · artifact" addr={settled.mandate.contextBinding.artifactHash} />
            <AddrLine label="settlement · receipt binds" addr={settled.contextBindingHash} />
            <p style={{ ...S.hint, marginTop: 8 }}>One immutable receipt — order ↔ fulfilment ↔ settlement, cryptographically linked.</p>
          </div>
        )}
      </Step>
    </>
  );
}
