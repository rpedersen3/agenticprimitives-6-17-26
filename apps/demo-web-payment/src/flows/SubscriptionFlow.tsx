import { useEffect, useState } from 'react';
import type { Hex } from 'viem';
import { useApp } from '../app-context';
import { Step, S, TxLink } from '../ui';
import { buildSubscription, subscriptionWindow, settlePeriod, type Subscription } from '../lib/flows';
import { fromUsdc } from '../lib/x402-pay';

export function SubscriptionFlow() {
  const app = useApp();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [paid, setPaid] = useState<Record<number, Hex>>({});
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const onApprove = () => {
    if (!app.treasurySa || !app.providerTreasury) { app.setStatus('set up your agent accounts first (top bar)'); return; }
    const s = buildSubscription(app.treasurySa, app.providerTreasury);
    setSub(s); setPaid({});
    app.setStatus(`Subscription authorized: ${fromUsdc(s.amountPerPeriod)} USDC × ${s.periods} periods (${s.windowSeconds}s windows). One open mandate covers them all.`);
  };

  const onSettle = (period: number) =>
    app.run(`period:${period}`, async () => {
      const ctx = app.payCtx();
      if (!ctx || !sub) throw new Error('approve the subscription first');
      app.setStatus(`Treasury SA settling period ${period + 1} (gasless)…`);
      const h = await settlePeriod(ctx, sub, period);
      setPaid((p) => ({ ...p, [period]: h }));
      await new Promise((r) => setTimeout(r, 2000));
      await app.refresh();
      app.setStatus(`Period ${period + 1} charged.`);
    });

  return (
    <Step n="1" title="Recurring subscription (open mandate → per-period charges)">
      <p style={S.hint}>Authorize once; each period derives a closed per-charge mandate. The PaymentEnforcer's frequency window blocks an early re-charge — here each period only settles inside its 60s window.</p>
      {!sub ? (
        <button style={{ ...S.btn, marginTop: 12 }} disabled={!app.isConnected} onClick={onApprove}>Authorize subscription</button>
      ) : (
        <>
          <ul style={{ ...S.rows, listStyle: 'none', padding: 0, marginTop: 12 }}>
            {Array.from({ length: sub.periods }, (_, i) => {
              const w = subscriptionWindow(sub, i);
              const open = now >= w.start && now < w.end;
              const future = now < w.start;
              const done = !!paid[i];
              return (
                <li key={i} style={S.row3}>
                  <span>Period {i + 1} <span style={S.muted}>{done ? '· paid' : open ? '· window open' : future ? `· opens in ${w.start - now}s` : '· window passed'}</span></span>
                  <span style={S.mono}>{fromUsdc(sub.amountPerPeriod)} USDC</span>
                  {done ? <TxLink hash={paid[i]} /> : (
                    <button style={S.btnSm} disabled={!open || app.busy === `period:${i}`} onClick={() => onSettle(i)} title={open ? '' : 'only settleable inside its window'}>
                      {app.busy === `period:${i}` ? '…' : 'Charge'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <button style={{ ...S.btnGhost, marginTop: 12 }} onClick={() => { setSub(null); app.setStatus('Subscription revoked — no further charges.'); }}>Revoke</button>
        </>
      )}
    </Step>
  );
}
