import { useState } from 'react';
import type { Hex } from 'viem';
import { useApp } from '../app-context';
import { Step, S, TxLink } from '../ui';
import { approvePaymentBudget, accessAndPay, toUsdc, fromUsdc, type PaymentBudget, type PricedResource } from '../lib/x402-pay';

const RESOURCES: PricedResource[] = [
  { title: 'Market briefing (PDF)', url: 'https://provider.example/briefing', price: toUsdc(0.25) },
  { title: 'Premium dataset (CSV)', url: 'https://provider.example/dataset', price: toUsdc(1.0) },
  { title: 'Expert Q&A session', url: 'https://provider.example/qa', price: toUsdc(2.5) },
];
const SESSION_BUDGET = toUsdc(10);
const PER_CHARGE_CAP = toUsdc(5);

export function MeteredFlow() {
  const app = useApp();
  const [budget, setBudget] = useState<PaymentBudget | null>(null);
  const [receipts, setReceipts] = useState<{ title: string; amount: bigint; hash: Hex }[]>([]);

  const onApprove = () => app.run('approve', async () => {
    if (!app.wallet || !app.treasurySa || !app.providerTreasury) throw new Error('set up your agent accounts first (top bar)');
    app.setStatus('Sign the payment budget (one signature → repeated capped charges)…');
    setBudget(await approvePaymentBudget({ wallet: app.wallet, treasurySa: app.treasurySa, providerTreasury: app.providerTreasury, perCharge: PER_CHARGE_CAP, sessionBudget: SESSION_BUDGET }));
    app.setStatus('Budget approved — pay per use (gasless, enforcer-gated).');
  });

  const onPay = (resource: PricedResource) => app.run(`pay:${resource.url}`, async () => {
    if (!app.wallet || !budget || !app.treasurySa || !app.personalSa || !app.providerTreasury) throw new Error('approve a budget first');
    app.setStatus(`Accessing "${resource.title}" — Personal SA redeems the gated charge (gasless)…`);
    const res = await accessAndPay({ wallet: app.wallet, budget, treasurySa: app.treasurySa, personalSa: app.personalSa, providerTreasury: app.providerTreasury, resource });
    setReceipts((p) => [{ title: resource.title, amount: res.amount, hash: res.settlementHash }, ...p]);
    await new Promise((r) => setTimeout(r, 2500));
    await app.refresh();
    app.setStatus(`"${resource.title}" unlocked — USDC moved Treasury SA → provider, gated by the PaymentEnforcer.`);
  });

  return (
    <>
      <Step n="1" title="Approve a session budget (one signature)">
        <p style={S.hint}>The Treasury SA signs ONE open payment delegation (PaymentEnforcer + per-charge + session caps, scoped to the provider). Set up + fund the treasury in the top bar first.</p>
        <button style={{ ...S.btn, marginTop: 12 }} disabled={!app.treasurySa || app.busy === 'approve'} onClick={onApprove}>{app.busy === 'approve' ? 'Awaiting signature…' : `Approve ${fromUsdc(SESSION_BUDGET)} USDC budget`}</button>
        {budget && <p style={S.hint}>✓ per-charge {fromUsdc(budget.consent.maxAmountPerCharge)} · budget {fromUsdc(budget.consent.sessionBudget)} · revocable</p>}
      </Step>
      <Step n="2" title="Access a service, pay per use (gasless, on-chain gated)">
        <div style={S.rows}>
          {RESOURCES.map((r) => (
            <div key={r.url} style={S.row3}>
              <span>{r.title}</span><span style={S.mono}>{fromUsdc(r.price)} USDC</span>
              <button style={S.btnSm} disabled={!budget || app.busy === `pay:${r.url}`} onClick={() => onPay(r)}>{app.busy === `pay:${r.url}` ? 'Paying…' : 'Access + pay'}</button>
            </div>
          ))}
        </div>
      </Step>
      {receipts.length > 0 && (
        <Step n="✓" title="Receipts">
          <ul style={S.receipts}>{receipts.map((rc) => (<li key={rc.hash} style={S.receiptItem}><span>{rc.title}</span><span style={S.mono}>{fromUsdc(rc.amount)} USDC</span><TxLink hash={rc.hash} label="receipt ↗" /></li>))}</ul>
        </Step>
      )}
    </>
  );
}
