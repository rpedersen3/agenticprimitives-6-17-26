import { useState } from 'react';
import type { Address, Hex } from 'viem';
import { useApp } from '../app-context';
import { Step, S, TxLink } from '../ui';
import { splitPay } from '../lib/flows';
import { fromUsdc, toUsdc } from '../lib/x402-pay';

const PLATFORM = '0x00000000000000000000000000000000000091a7' as Address;
const REFERRER = '0x0000000000000000000000000000000000007e7e' as Address;
const AMOUNT = toUsdc(1.0);

export function SplitFlow() {
  const app = useApp();
  const [legs, setLegs] = useState<{ to: Address; amount: bigint; hash: Hex }[]>([]);

  const recipients = [
    { to: (app.providerTreasury ?? PLATFORM), bps: 7000, label: 'Provider' },
    { to: PLATFORM, bps: 2000, label: 'Platform' },
    { to: REFERRER, bps: 1000, label: 'Referrer' },
  ];

  const onSplit = () =>
    app.run('split', async () => {
      const ctx = app.payCtx();
      if (!ctx) throw new Error('set up your agent accounts first (top bar)');
      app.setStatus('Treasury SA splitting 1.00 USDC across 3 recipients (gasless)…');
      const out = await splitPay(ctx, AMOUNT, recipients.map((r) => ({ to: r.to, bps: r.bps })));
      setLegs(out);
      await new Promise((r) => setTimeout(r, 2000));
      await app.refresh();
      app.setStatus('Split settled — recipient-specific consideration, no dust.');
    });

  return (
    <Step n="1" title="Marketplace split payout">
      <p style={S.hint}>One checkout amount split by basis points to provider + platform + referrer. Each leg is its own transfer + receipt; the rounding remainder goes to the first recipient so legs total exactly the amount.</p>
      <ul style={{ ...S.rows, listStyle: 'none', padding: 0, marginTop: 12 }}>
        {recipients.map((r, i) => (
          <li key={r.to} style={S.row3}>
            <span>{r.label} <span style={S.muted}>({r.bps / 100}%)</span> <span style={S.mono}>{r.to.slice(0, 8)}…</span></span>
            <span style={S.mono}>{fromUsdc((AMOUNT * BigInt(r.bps)) / 10000n)} USDC</span>
            <span>{legs[i] ? <TxLink hash={legs[i].hash} /> : <span style={S.muted}>—</span>}</span>
          </li>
        ))}
      </ul>
      <button style={{ ...S.btn, marginTop: 12 }} disabled={!app.isConnected || app.busy === 'split'} onClick={onSplit}>
        {app.busy === 'split' ? 'Splitting…' : 'Pay + split 1.00 USDC'}
      </button>
    </Step>
  );
}
