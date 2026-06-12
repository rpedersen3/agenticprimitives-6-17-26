import { useCallback, useEffect, useState } from 'react';
import type { Address, Hex } from 'viem';
import { useApp } from '../app-context';
import { Step, S, AddrLine, TxLink } from '../ui';
import { deployPersona, providerEoa } from '../lib/personas';
import { approvePaymentBudget, accessAndPay, fundWithUsdc, readUsdcBalance, toUsdc, fromUsdc, type PaymentBudget, type PricedResource } from '../lib/x402-pay';

const RESOURCES: PricedResource[] = [
  { title: 'Market briefing (PDF)', url: 'https://provider.example/briefing', price: toUsdc(0.25) },
  { title: 'Premium dataset (CSV)', url: 'https://provider.example/dataset', price: toUsdc(1.0) },
  { title: 'Expert Q&A session', url: 'https://provider.example/qa', price: toUsdc(2.5) },
];
const SESSION_BUDGET = toUsdc(10);
const PER_CHARGE_CAP = toUsdc(5);

export function MeteredFlow() {
  const app = useApp();
  const [readerSa, setReaderSa] = useState<Address | null>(null);
  const [treasury, setTreasury] = useState<Address | null>(null);
  const [readerBal, setReaderBal] = useState(0n);
  const [treasuryBal, setTreasuryBal] = useState(0n);
  const [budget, setBudget] = useState<PaymentBudget | null>(null);
  const [receipts, setReceipts] = useState<{ title: string; amount: bigint; hash: Hex }[]>([]);

  const refreshBal = useCallback(async (r: Address | null, t: Address | null) => {
    if (r) setReaderBal(await readUsdcBalance(r));
    if (t) setTreasuryBal(await readUsdcBalance(t));
  }, []);
  useEffect(() => { if (readerSa || treasury) void refreshBal(readerSa, treasury); }, [readerSa, treasury, refreshBal]);

  const onCreate = () => app.run('personas', async () => {
    if (!app.address) throw new Error('connect a wallet');
    let reader = readerSa;
    if (!reader) { app.setStatus('Deploying reader Person SA (gasless)…'); const r = await deployPersona(app.address); if (!r.ok) throw new Error(`reader deploy — ${r.error}`); reader = r.address; setReaderSa(r.address); }
    let prov = treasury;
    if (!prov) { app.setStatus('Deploying provider treasury SA (gasless, retries past relayer nonce)…'); const p = await deployPersona(providerEoa()); if (!p.ok) throw new Error(`provider deploy — ${p.error}`); prov = p.address; setTreasury(p.address); }
    app.setStatus('Both Smart Agents deployed.');
    await refreshBal(reader, prov);
  });

  const onFund = () => app.run('fund-reader', async () => {
    if (!app.wallet || !readerSa) throw new Error('create the reader first');
    app.setStatus('Minting 25 demo USDC into the reader SA…');
    await fundWithUsdc(app.wallet, readerSa, toUsdc(25));
    await new Promise((r) => setTimeout(r, 2500));
    await refreshBal(readerSa, treasury);
    app.setStatus('Reader funded.');
  });

  const onApprove = () => app.run('approve', async () => {
    if (!app.wallet || !readerSa || !treasury) throw new Error('create personas first');
    app.setStatus('Sign the payment budget (one signature → repeated capped charges)…');
    setBudget(await approvePaymentBudget({ wallet: app.wallet, readerSa, treasury, perCharge: PER_CHARGE_CAP, sessionBudget: SESSION_BUDGET }));
    app.setStatus('Budget approved — pay per use.');
  });

  const onPay = (resource: PricedResource) => app.run(`pay:${resource.url}`, async () => {
    if (!app.wallet || !budget || !readerSa || !treasury) throw new Error('approve a budget first');
    const bal = await readUsdcBalance(readerSa);
    if (bal < resource.price) throw new Error(`Reader SA holds ${fromUsdc(bal)} USDC but this charge needs ${fromUsdc(resource.price)} — run step 2 "Mint 25 USDC → reader" first (the wallet-bar mint funds your wallet, not the reader SA).`);
    app.setStatus(`Accessing "${resource.title}" — submitting the gated charge…`);
    const res = await accessAndPay({ wallet: app.wallet, budget, readerSa, treasury, resource });
    setReceipts((p) => [{ title: resource.title, amount: res.amount, hash: res.settlementHash }, ...p]);
    await new Promise((r) => setTimeout(r, 2500));
    await refreshBal(readerSa, treasury);
    app.setStatus(`"${resource.title}" unlocked — USDC moved to the provider treasury.`);
  });

  return (
    <>
      <Step n="1" title="Create the two Smart Agents">
        <button style={S.btn} disabled={!app.isConnected || app.busy === 'personas'} onClick={onCreate}>{app.busy === 'personas' ? 'Deploying…' : 'Deploy reader + provider'}</button>
        <AddrLine label="Reader SA" addr={readerSa} extra={`${fromUsdc(readerBal)} USDC`} />
        <AddrLine label="Provider treasury SA" addr={treasury} extra={`${fromUsdc(treasuryBal)} USDC`} />
      </Step>
      <Step n="2" title="Fund the reader with USDC">
        <button style={S.btn} disabled={!readerSa || app.busy === 'fund-reader'} onClick={onFund}>{app.busy === 'fund-reader' ? 'Minting…' : 'Mint 25 USDC → reader'}</button>
      </Step>
      <Step n="3" title="Approve a session budget">
        <button style={S.btn} disabled={!readerSa || !treasury || app.busy === 'approve'} onClick={onApprove}>{app.busy === 'approve' ? 'Awaiting signature…' : `Approve ${fromUsdc(SESSION_BUDGET)} USDC budget`}</button>
        {budget && <p style={S.hint}>✓ per-charge {fromUsdc(budget.consent.maxAmountPerCharge)} · budget {fromUsdc(budget.consent.sessionBudget)} · revocable</p>}
      </Step>
      <Step n="4" title="Access a service, pay per use">
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
