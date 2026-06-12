import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient } from 'wagmi';
import { formatEther, type Address, type Hex } from 'viem';
import { config } from './config';
import { readEthBalance, seedGas } from './lib/wallet';
import { deployPersona, providerEoa } from './lib/personas';
import {
  approvePaymentBudget,
  accessAndPay,
  fundWithUsdc,
  readUsdcBalance,
  toUsdc,
  fromUsdc,
  type PaymentBudget,
  type PricedResource,
} from './lib/x402-pay';
import type { PaymentWallet } from './lib/wallet';

const RESOURCES: PricedResource[] = [
  { title: 'Market briefing (PDF)', url: 'https://provider.example/briefing', price: toUsdc(0.25) },
  { title: 'Premium dataset (CSV)', url: 'https://provider.example/dataset', price: toUsdc(1.0) },
  { title: 'Expert Q&A session', url: 'https://provider.example/qa', price: toUsdc(2.5) },
];

const SESSION_BUDGET = toUsdc(10);
const PER_CHARGE_CAP = toUsdc(5);

interface Receipt {
  title: string;
  amount: bigint;
  hash: Hex;
}

export function App() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const wallet = walletClient as unknown as PaymentWallet | undefined;

  const [readerSa, setReaderSa] = useState<Address | null>(null);
  const [treasury, setTreasury] = useState<Address | null>(null);
  const [readerBal, setReaderBal] = useState<bigint>(0n);
  const [treasuryBal, setTreasuryBal] = useState<bigint>(0n);
  const [budget, setBudget] = useState<PaymentBudget | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [ethBal, setEthBal] = useState<bigint>(0n);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');

  const refreshEth = useCallback(async (a?: Address) => {
    if (a) setEthBal(await readEthBalance(a));
  }, []);

  useEffect(() => {
    if (address) void refreshEth(address);
  }, [address, refreshEth]);

  const refreshBalances = useCallback(async (r: Address | null, t: Address | null) => {
    if (r) setReaderBal(await readUsdcBalance(r));
    if (t) setTreasuryBal(await readUsdcBalance(t));
  }, []);

  useEffect(() => {
    if (readerSa || treasury) void refreshBalances(readerSa, treasury);
  }, [readerSa, treasury, refreshBalances]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onSeedGas = () =>
    run('seed', async () => {
      if (!address) throw new Error('connect a wallet first');
      setStatus('Requesting gas from the deployer faucet…');
      const r = await seedGas(address);
      if (!r.ok) throw new Error(`faucet — ${r.error}${r.detail ? `: ${r.detail}` : ''}`);
      if (r.skipped) {
        setStatus(`Wallet already has enough gas (${r.balance} ETH).`);
      } else {
        setStatus(`Seeded ${r.amount} ETH from the deployer. Waiting for confirmation…`);
        await new Promise((res) => setTimeout(res, 3000));
      }
      await refreshEth(address);
    });

  const onCreatePersonas = () =>
    run('personas', async () => {
      if (!address) throw new Error('connect a wallet first');
      setStatus('Deploying reader Person SA (gasless)…');
      const reader = await deployPersona(address);
      if (!reader.ok) throw new Error(`reader deploy failed — ${reader.error}`);
      setReaderSa(reader.address);

      setStatus('Deploying provider treasury SA (gasless)…');
      const provider = await deployPersona(providerEoa());
      if (!provider.ok) throw new Error(`provider deploy failed — ${provider.error}`);
      setTreasury(provider.address);
      setStatus('Both Smart Agents deployed.');
      await refreshBalances(reader.address, provider.address);
    });

  const onFund = () =>
    run('fund', async () => {
      if (!wallet || !readerSa) throw new Error('create the reader first');
      setStatus('Minting 25 demo USDC into the reader SA…');
      await fundWithUsdc(wallet, readerSa, toUsdc(25));
      setStatus('Funded. Waiting for balance…');
      await new Promise((r) => setTimeout(r, 2500));
      await refreshBalances(readerSa, treasury);
      setStatus('Reader funded with USDC.');
    });

  const onApprove = () =>
    run('approve', async () => {
      if (!wallet || !readerSa || !treasury) throw new Error('create personas first');
      setStatus('Sign the payment budget (one signature, repeated capped charges)…');
      const b = await approvePaymentBudget({
        wallet,
        readerSa,
        treasury,
        perCharge: PER_CHARGE_CAP,
        sessionBudget: SESSION_BUDGET,
      });
      setBudget(b);
      setStatus('Budget approved — you can now pay per use.');
    });

  const onPay = (resource: PricedResource) =>
    run(`pay:${resource.url}`, async () => {
      if (!wallet || !budget || !readerSa || !treasury) throw new Error('approve a budget first');
      setStatus(`Accessing "${resource.title}" — submitting the gated charge…`);
      const res = await accessAndPay({ wallet, budget, readerSa, treasury, resource });
      setReceipts((prev) => [{ title: resource.title, amount: res.amount, hash: res.settlementHash }, ...prev]);
      setStatus('Paid. Waiting for settlement…');
      await new Promise((r) => setTimeout(r, 2500));
      await refreshBalances(readerSa, treasury);
      setStatus(`"${resource.title}" unlocked — USDC moved to the provider treasury.`);
    });

  return (
    <main style={S.page}>
      <header style={S.header}>
        <h1 style={S.h1}>x402 pay-per-use</h1>
        <p style={S.sub}>
          A reader Person Smart Agent pays USDC into a provider's treasury Smart Agent to access a
          priced service — each charge gated on-chain by the spec-272 <code>PaymentEnforcer</code> on
          Base Sepolia.
        </p>
      </header>

      {/* Wallet */}
      <section style={S.card}>
        <div style={S.rowBetween}>
          <strong>Wallet</strong>
          {isConnected ? (
            <span style={S.mono}>
              {address?.slice(0, 6)}…{address?.slice(-4)}{' '}
              <button style={S.linkBtn} onClick={() => disconnect()}>
                disconnect
              </button>
            </span>
          ) : (
            connectors.map((c) => (
              <button key={c.uid} style={S.btn} onClick={() => connect({ connector: c })}>
                Connect {c.name}
              </button>
            ))
          )}
        </div>
        {isConnected && (
          <div style={S.gasRow}>
            <span style={S.hint}>
              Gas: <span style={S.mono}>{Number(formatEther(ethBal)).toFixed(4)} ETH</span>
              {ethBal < 900_000_000_000_000n && <span style={S.lowGas}> · low</span>}
            </span>
            <button style={S.btnSm} disabled={busy === 'seed'} onClick={onSeedGas}>
              {busy === 'seed' ? 'Seeding…' : 'Seed gas from deployer'}
            </button>
          </div>
        )}
        <p style={S.hint}>The wallet custodies the reader SA, signs the budget, and submits the mint + charge txs. Those need a little Base Sepolia ETH — the deployer faucet seeds it (dev).</p>
      </section>

      {/* Step 1 — personas */}
      <Step n={1} title="Create the two Smart Agents">
        <button style={S.btn} disabled={!isConnected || busy === 'personas'} onClick={onCreatePersonas}>
          {busy === 'personas' ? 'Deploying…' : 'Deploy reader + provider'}
        </button>
        <AddrLine label="Reader SA" addr={readerSa} extra={`${fromUsdc(readerBal)} USDC`} />
        <AddrLine label="Provider treasury SA" addr={treasury} extra={`${fromUsdc(treasuryBal)} USDC`} />
      </Step>

      {/* Step 2 — fund */}
      <Step n={2} title="Fund the reader with USDC">
        <button style={S.btn} disabled={!readerSa || busy === 'fund'} onClick={onFund}>
          {busy === 'fund' ? 'Minting…' : 'Mint 25 demo USDC → reader'}
        </button>
      </Step>

      {/* Step 3 — budget */}
      <Step n={3} title="Approve a session budget">
        <button style={S.btn} disabled={!readerSa || !treasury || busy === 'approve'} onClick={onApprove}>
          {busy === 'approve' ? 'Awaiting signature…' : `Approve ${fromUsdc(SESSION_BUDGET)} USDC budget`}
        </button>
        {budget && (
          <p style={S.hint}>
            ✓ Per-charge cap {fromUsdc(budget.consent.maxAmountPerCharge)} · session budget{' '}
            {fromUsdc(budget.consent.sessionBudget)} · recipient {budget.consent.recipient.slice(0, 8)}… · revocable
          </p>
        )}
      </Step>

      {/* Step 4 — pay */}
      <Step n={4} title="Access a service, pay per use">
        <div style={S.resources}>
          {RESOURCES.map((r) => (
            <div key={r.url} style={S.resourceRow}>
              <span>{r.title}</span>
              <span style={S.mono}>{fromUsdc(r.price)} USDC</span>
              <button
                style={S.btnSm}
                disabled={!budget || busy === `pay:${r.url}`}
                onClick={() => onPay(r)}
              >
                {busy === `pay:${r.url}` ? 'Paying…' : 'Access + pay'}
              </button>
            </div>
          ))}
        </div>
      </Step>

      {/* Treasury / receipts */}
      <section style={S.card}>
        <div style={S.rowBetween}>
          <strong>Provider treasury</strong>
          <span style={S.mono}>{fromUsdc(treasuryBal)} USDC received</span>
        </div>
        {receipts.length === 0 ? (
          <p style={S.hint}>No charges yet.</p>
        ) : (
          <ul style={S.receipts}>
            {receipts.map((rc) => (
              <li key={rc.hash} style={S.receiptItem}>
                <span>{rc.title}</span>
                <span style={S.mono}>{fromUsdc(rc.amount)} USDC</span>
                <a style={S.link} href={`https://sepolia.basescan.org/tx/${rc.hash}`} target="_blank" rel="noreferrer">
                  receipt ↗
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {status && <p style={S.status}>{status}</p>}
      {error && <p style={S.error}>⚠ {error}</p>}

      <footer style={S.footer}>
        PaymentEnforcer <code>{config.paymentEnforcer.slice(0, 10)}…</code> · MockUSDC{' '}
        <code>{config.mockUsdc.slice(0, 10)}…</code> · Base Sepolia
      </footer>
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section style={S.card}>
      <div style={S.stepHead}>
        <span style={S.stepNum}>{n}</span>
        <strong>{title}</strong>
      </div>
      {children}
    </section>
  );
}

function AddrLine({ label, addr, extra }: { label: string; addr: Address | null; extra?: string }) {
  return (
    <p style={S.addrLine}>
      <span style={S.addrLabel}>{label}</span>
      {addr ? (
        <a style={S.link} href={`https://sepolia.basescan.org/address/${addr}`} target="_blank" rel="noreferrer">
          <span style={S.mono}>{addr.slice(0, 10)}…{addr.slice(-6)}</span>
        </a>
      ) : (
        <span style={S.muted}>—</span>
      )}
      {extra && addr && <span style={S.balPill}>{extra}</span>}
    </p>
  );
}

const ink = '#1a2433';
const accent = '#2f6df0';
const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: 720, margin: '0 auto', padding: '32px 20px 64px', fontFamily: 'system-ui, sans-serif', color: ink },
  header: { marginBottom: 24 },
  h1: { fontSize: 28, margin: '0 0 8px' },
  sub: { color: '#5b6b80', lineHeight: 1.5, margin: 0 },
  card: { border: '1px solid #e3e8ef', borderRadius: 12, padding: 18, marginBottom: 14, background: '#fff' },
  stepHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  stepNum: { display: 'inline-flex', width: 24, height: 24, borderRadius: 999, background: accent, color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 },
  rowBetween: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  btn: { background: accent, color: '#fff', border: 0, borderRadius: 8, padding: '9px 16px', fontSize: 14, cursor: 'pointer', fontWeight: 600 },
  btnSm: { background: accent, color: '#fff', border: 0, borderRadius: 7, padding: '6px 12px', fontSize: 13, cursor: 'pointer', fontWeight: 600 },
  linkBtn: { background: 'none', border: 0, color: accent, cursor: 'pointer', fontSize: 13, textDecoration: 'underline' },
  hint: { color: '#7a8aa0', fontSize: 13, marginTop: 10, marginBottom: 0, lineHeight: 1.4 },
  gasRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f3f8' },
  lowGas: { color: '#b54708', fontWeight: 600 },
  mono: { fontFamily: 'ui-monospace, monospace', fontSize: 13 },
  muted: { color: '#aab4c2' },
  addrLine: { display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 0', fontSize: 14 },
  addrLabel: { minWidth: 170, color: '#5b6b80' },
  balPill: { marginLeft: 'auto', background: '#eef4ff', color: accent, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 },
  resources: { display: 'flex', flexDirection: 'column', gap: 8 },
  resourceRow: { display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid #f0f3f8' },
  receipts: { listStyle: 'none', padding: 0, margin: '10px 0 0' },
  receiptItem: { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, padding: '6px 0', fontSize: 14, borderTop: '1px solid #f0f3f8' },
  link: { color: accent, textDecoration: 'none' },
  status: { background: '#f3f8ff', border: '1px solid #d6e6ff', borderRadius: 8, padding: '10px 14px', fontSize: 14 },
  error: { background: '#fff4f4', border: '1px solid #ffd6d6', color: '#b42318', borderRadius: 8, padding: '10px 14px', fontSize: 14 },
  footer: { marginTop: 24, color: '#9aa6b6', fontSize: 12, textAlign: 'center' },
};
