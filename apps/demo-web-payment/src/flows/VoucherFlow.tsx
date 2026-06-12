import { useState } from 'react';
import { useApp } from '../app-context';
import { Step, S, TxLink } from '../ui';
import { buyVoucherPack, redeemVoucher, type VoucherPack, type Voucher } from '../lib/flows';

export function VoucherFlow() {
  const app = useApp();
  const [pack, setPack] = useState<VoucherPack | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});

  const onBuy = () =>
    app.run('buy-vouchers', async () => {
      const ctx = app.payCtx();
      if (!ctx) throw new Error('set up your agent accounts first (top bar)');
      app.setStatus('Treasury SA paying 0.30 USDC → the issuer blind-signs a 3-voucher pack (gasless)…');
      const p = await buyVoucherPack(ctx, 3);
      setPack(p); setResult({});
      await new Promise((r) => setTimeout(r, 2000));
      await app.refresh();
      app.setStatus('Pack issued. Each voucher is unlinkable to the purchase + one-use.');
    });

  const onRedeem = (v: Voucher) =>
    app.run(`redeem:${v.voucherId}`, async () => {
      const res = await redeemVoucher(v);
      setResult((s) => ({ ...s, [v.voucherId]: res.ok ? 'redeemed ✓' : `rejected — ${res.reason}` }));
      app.setStatus(res.ok ? 'Redeemed unlinkably — the issuer can\'t tie this to your payment.' : `Rejected: ${res.reason}`);
    });

  return (
    <>
      <Step n="1" title="Pay once → blind voucher pack (VOPRF, Privacy Pass)">
        <p style={S.hint}>The issuer signs BLINDED tokens, so the requests it sees at purchase are independent of the tokens you redeem later — no link between paying and using.</p>
        <button style={{ ...S.btn, marginTop: 12 }} disabled={!app.isConnected || app.busy === 'buy-vouchers'} onClick={onBuy}>
          {app.busy === 'buy-vouchers' ? 'Issuing…' : 'Buy 3-voucher pack (0.30 USDC)'}
        </button>
        {pack && <p style={S.hint}>✓ paid · <TxLink hash={pack.payHash} /> · 3 vouchers issued</p>}
      </Step>

      {pack && (
        <Step n="2" title="Redeem from a separate context (unlinkable + one-use)">
          <p style={S.hint}>The blinded request the issuer signed ≠ the token you present — that's the unlinkability. Redeeming twice is rejected (double-spend).</p>
          <ul style={{ ...S.rows, listStyle: 'none', padding: 0, marginTop: 12 }}>
            {pack.vouchers.map((v, i) => (
              <li key={v.voucherId} style={{ borderTop: '1px solid #f0f3f8', padding: '8px 0' }}>
                <div style={S.rowBetween}>
                  <span style={S.mono}>voucher {i + 1}: {v.voucherId.slice(0, 14)}…</span>
                  <button style={S.btnSm} disabled={app.busy === `redeem:${v.voucherId}`} onClick={() => onRedeem(v)}>
                    {result[v.voucherId]?.startsWith('redeemed') ? 'Redeem again' : 'Redeem'}
                  </button>
                </div>
                <div style={{ ...S.hint, marginTop: 4 }}>
                  issuer saw (blinded): <span style={S.mono}>{pack.blinded[i]!.slice(0, 14)}…</span>
                  {result[v.voucherId] && <strong style={{ marginLeft: 8, color: result[v.voucherId]!.includes('rejected') ? '#b42318' : '#1a7f37' }}>{result[v.voucherId]}</strong>}
                </div>
              </li>
            ))}
          </ul>
        </Step>
      )}
    </>
  );
}
