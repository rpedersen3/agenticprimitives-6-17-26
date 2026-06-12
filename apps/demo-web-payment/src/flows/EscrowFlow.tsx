import { useEffect, useState } from 'react';
import type { Hex } from 'viem';
import { entitlement, type Hex32 } from '@agenticprimitives/payments';
import { useApp } from '../app-context';
import { Step, S, TxLink, AddrLine } from '../ui';
import {
  escrowDeposit, escrowRelease, escrowReclaim, readEscrowHold, orderHashOf,
  grantEntitlement, SERVICE_SCOPE, ESCROW_STATUS_LABEL,
} from '../lib/flows';
import { fromUsdc, toUsdc } from '../lib/x402-pay';

const AMOUNT = toUsdc(1.0);
const EXPIRES_IN = 90; // seconds — short so the reclaim/refund path is demoable

export function EscrowFlow() {
  const app = useApp();
  const [orderHash, setOrderHash] = useState<Hex32 | null>(null);
  const [depositHash, setDepositHash] = useState<Hex>();
  const [status, setStatus] = useState<number>(0); // EscrowStatus
  const [expiry, setExpiry] = useState<number>(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [delivered, setDelivered] = useState(false);
  const [releaseHash, setReleaseHash] = useState<Hex>();
  const [reclaimHash, setReclaimHash] = useState<Hex>();
  const [ent, setEnt] = useState<entitlement.EntitlementRecord | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const refreshHold = async (oh: Hex32) => {
    const h = await readEscrowHold(oh);
    setStatus(Number(h.status));
    setExpiry(Number(h.expiry));
  };

  const onDeposit = () =>
    app.run('deposit', async () => {
      const ctx = app.payCtx();
      if (!ctx) throw new Error('set up your agent accounts first (top bar)');
      const oh = orderHashOf('escrow-demo');
      app.setStatus('Treasury SA approving + depositing 1.00 USDC into escrow (gasless)…');
      const { depositHash } = await escrowDeposit(ctx, { orderHash: oh, amount: AMOUNT, expiresInSeconds: EXPIRES_IN });
      setOrderHash(oh);
      setDepositHash(depositHash);
      setDelivered(false); setReleaseHash(undefined); setReclaimHash(undefined); setEnt(null);
      await new Promise((r) => setTimeout(r, 2500));
      await refreshHold(oh);
      await app.refresh();
      app.setStatus('Funds held in escrow. Provider can now fulfil.');
    });

  const onRelease = () =>
    app.run('release', async () => {
      const ctx = app.payCtx();
      if (!ctx || !orderHash) throw new Error('deposit first');
      app.setStatus('Releasing escrow → capture to provider + mint access (pay AFTER fulfilment)…');
      const h = await escrowRelease(ctx, orderHash);
      setReleaseHash(h);
      // pay-after-fulfillment: the entitlement is minted ONLY now, on accepted delivery
      setEnt(grantEntitlement({ subject: ctx.treasurySa, mandateId: orderHash, settlementHash: h as Hex32 }));
      await new Promise((r) => setTimeout(r, 2500));
      await refreshHold(orderHash);
      await app.refresh();
      app.setStatus('Released — provider paid, access granted.');
    });

  const onReclaim = () =>
    app.run('reclaim', async () => {
      const ctx = app.payCtx();
      if (!ctx || !orderHash) throw new Error('deposit first');
      app.setStatus('Fulfilment failed/expired — reclaiming the held funds (refund to the treasury SA)…');
      const h = await escrowReclaim(ctx, orderHash);
      setReclaimHash(h);
      await new Promise((r) => setTimeout(r, 2500));
      await refreshHold(orderHash);
      await app.refresh();
      app.setStatus('Reclaimed — funds returned to you.');
    });

  const onUse = () =>
    app.run('use', async () => {
      if (!ent || !app.treasurySa) throw new Error('no entitlement');
      const res = entitlement.consumeEntitlement(ent, { scopeHash: SERVICE_SCOPE, now: Math.floor(Date.now() / 1000), presenter: app.treasurySa ?? undefined });
      if (!res.ok) throw new Error(res.reason);
      setEnt(res.record);
      app.setStatus(`Accessed the service — ${res.record.usesLeft} use(s) left (no new payment).`);
    });

  const canReclaim = status === 1 && now >= expiry;
  const secsLeft = Math.max(0, expiry - now);

  return (
    <>
      <Step n="1" title="Hold funds in escrow for an order">
        <p style={S.hint}>Deposit funds against an <code>orderHash</code>. They move on exactly one path: release (capture) or reclaim (refund). Provider = <span style={S.mono}>{app.providerTreasury?.slice(0, 8) ?? '…'}…</span></p>
        <div style={{ ...S.rowBetween, marginTop: 12 }}>
          <span style={S.mono}>1.00 USDC · expires in {EXPIRES_IN}s</span>
          <button style={S.btn} disabled={!app.isConnected || app.busy === 'deposit'} onClick={onDeposit}>
            {app.busy === 'deposit' ? 'Depositing…' : 'Deposit to escrow'}
          </button>
        </div>
        {orderHash && (
          <>
            <AddrLine label="Order" addr={orderHash} extra={`status: ${ESCROW_STATUS_LABEL[status] ?? status}`} />
            {depositHash && <p style={S.hint}>✓ held · <TxLink hash={depositHash} /> {status === 1 && `· reclaimable in ${secsLeft}s`}</p>}
          </>
        )}
      </Step>

      <Step n="2" title="Fulfil → release (pay AFTER fulfilment), or fail → reclaim (refund)">
        <label style={{ ...S.hint, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={delivered} onChange={(e) => setDelivered(e.target.checked)} disabled={status !== 1} />
          Provider fulfilled the order (accepted delivery evidence)
        </label>
        <div style={{ ...S.rowBetween, marginTop: 12 }}>
          <button style={S.btn} disabled={status !== 1 || !delivered || app.busy === 'release'} onClick={onRelease}>
            {app.busy === 'release' ? 'Releasing…' : 'Release + grant access'}
          </button>
          <button style={S.btnGhost} disabled={!canReclaim || app.busy === 'reclaim'} onClick={onReclaim} title={canReclaim ? '' : `reclaimable after expiry (${secsLeft}s)`}>
            {app.busy === 'reclaim' ? 'Reclaiming…' : `Refund (reclaim)${canReclaim ? '' : ` · ${secsLeft}s`}`}
          </button>
        </div>
        {releaseHash && <p style={S.hint}>✓ captured to provider · <TxLink hash={releaseHash} /></p>}
        {reclaimHash && <p style={S.hint}>↩ refunded to you · <TxLink hash={reclaimHash} /></p>}
      </Step>

      {ent && (
        <Step n="3" title="Use the access you paid for (entitlement)">
          <p style={S.hint}>Granted on fulfilment — {ent.usesLeft}/{ent.maxUses} uses left. Each use consumes one, no new payment (X402-D8 one lane).</p>
          <button style={S.btn} disabled={ent.usesLeft <= 0 || app.busy === 'use'} onClick={onUse}>
            {ent.usesLeft <= 0 ? 'Exhausted' : 'Use the service'}
          </button>
        </Step>
      )}
    </>
  );
}
