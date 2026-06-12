import { useState } from 'react';
import { formatEther } from 'viem';
import { config } from './config';
import { AppProvider, useApp } from './app-context';
import { S, accent } from './ui';
import { fromUsdc } from './lib/x402-pay';
import { MeteredFlow } from './flows/MeteredFlow';
import { DirectInvoiceFlow } from './flows/DirectInvoiceFlow';
import { EscrowFlow } from './flows/EscrowFlow';
import { SplitFlow } from './flows/SplitFlow';
import { SubscriptionFlow } from './flows/SubscriptionFlow';
import { VoucherFlow } from './flows/VoucherFlow';
import { OpsFlow } from './flows/OpsFlow';

interface Tab {
  id: string;
  label: string;
  blurb: string;
  render?: () => React.ReactNode;
  reserved?: string; // why, if not wired
}

const TABS: Tab[] = [
  { id: 'metered', label: 'Pay-per-use (x402)', blurb: 'Reader SA pays USDC per access, gated on-chain by the PaymentEnforcer. One signature → repeated capped charges; each access mints an entitlement.', render: () => <MeteredFlow /> },
  { id: 'direct', label: 'Direct / Invoice', blurb: 'Plain checkout (wallet rail) + a request-for-payment invoice bound to its invoiceId.', render: () => <DirectInvoiceFlow /> },
  { id: 'escrow', label: 'Escrow · deliver-then-pay', blurb: 'Hold funds for an order → provider fulfils → release captures + grants access (pay AFTER fulfilment); if it fails/expires, reclaim refunds you.', render: () => <EscrowFlow /> },
  { id: 'split', label: 'Marketplace split', blurb: 'One amount split by basis points to provider + platform + referrer — recipient-specific consideration, no dust.', render: () => <SplitFlow /> },
  { id: 'sub', label: 'Subscription', blurb: 'Recurring profile: approve once (open mandate), derive per-period closed charges; each period only settles inside its window (early re-charge blocked).', render: () => <SubscriptionFlow /> },
  { id: 'anon', label: 'Anonymous', blurb: 'Pay once → a blind-signed VOPRF voucher pack redeemed unlinkably from a separate context; double-spend rejected.', render: () => <VoucherFlow /> },
  { id: 'ops', label: 'Ops dashboard', blurb: 'Idempotent event log + receipt reconciliation/payment-detection + CSV/JSON export.', render: () => <OpsFlow /> },
  { id: 'intent', label: 'Intent → fulfilment', blurb: 'Express a need → match/agree → fulfil → settle the bound payment; receipt links order ↔ fulfilment ↔ settlement.', reserved: 'wires intent-marketplace + agreements + fulfilment alongside payments — next' },
];

function WalletBar() {
  const app = useApp();
  return (
    <section style={S.card}>
      <div style={S.rowBetween}>
        <strong>Wallet</strong>
        {app.isConnected ? (
          <span style={S.mono}>
            {app.address?.slice(0, 6)}…{app.address?.slice(-4)}{' '}
            <button style={S.linkBtn} onClick={() => app.disconnect()}>disconnect</button>
          </span>
        ) : (
          app.connectors.map((c) => (
            <button key={c.uid} style={S.btn} onClick={() => app.connect({ connector: c })}>Connect {c.name}</button>
          ))
        )}
      </div>
      {app.isConnected && (
        <div style={S.gasRow}>
          <span style={S.hint}>
            Gas <span style={S.mono}>{Number(formatEther(app.ethBal)).toFixed(4)} ETH</span>
            {app.ethBal < 80_000_000_000_000n && <span style={S.lowGas}> · low</span>}
            {' '}· Wallet <span style={S.mono}>{fromUsdc(app.walletUsdc)} USDC</span>
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            {import.meta.env.DEV && <button style={S.btnGhost} disabled={app.busy === 'seed'} onClick={app.seedGas}>{app.busy === 'seed' ? 'Seeding…' : 'Seed gas'}</button>}
            <button style={S.btnGhost} disabled={app.busy === 'fund'} onClick={() => app.fundWallet(10)}>{app.busy === 'fund' ? 'Minting…' : 'Mint 10 USDC'}</button>
          </span>
        </div>
      )}
      <p style={S.hint}>The connected wallet is the payer for the direct/escrow/split flows, and custodies the reader SA for pay-per-use. Needs a little Base Sepolia ETH for gas{import.meta.env.DEV ? ' (the deployer faucet seeds a tiny amount in dev)' : ''}.</p>
    </section>
  );
}

function Shell() {
  const app = useApp();
  const [active, setActive] = useState('metered');
  const tab = TABS.find((t) => t.id === active)!;

  return (
    <main style={S.page}>
      <header style={S.header}>
        <h1 style={S.h1}>Agentic payments — every flow</h1>
        <p style={S.sub}>x402 pay-per-use, direct/invoice, escrow deliver-then-pay, recurring, splits, anonymous vouchers — all on the live Base Sepolia substrate (PaymentEnforcer + PaymentEscrow + receipts).</p>
      </header>

      <WalletBar />

      <nav style={S.tabs}>
        {TABS.map((t) => (
          <button key={t.id} style={active === t.id ? S.tabActive : S.tab} onClick={() => setActive(t.id)}>
            {t.label}{t.reserved ? ' ·' : ''}
          </button>
        ))}
      </nav>

      <section style={{ ...S.card, background: '#f7f9fc' }}>
        <strong>{tab.label}</strong>
        <p style={{ ...S.hint, marginTop: 6 }}>{tab.blurb}</p>
      </section>

      {tab.render ? (
        tab.render()
      ) : (
        <section style={{ ...S.card, ...S.reserved }}>
          <p style={S.hint}>🔒 Reserved — {tab.reserved}. The primitive is built + tested in <code>@agenticprimitives/payments</code>; see <a style={S.link} href="https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/feature-analysis/09-payments-treasury-commerce.md" target="_blank" rel="noreferrer">feature-analysis 09</a>.</p>
        </section>
      )}

      {app.status && <p style={S.status}>{app.status}</p>}
      {app.error && <p style={S.error}>⚠ {app.error}</p>}

      <footer style={S.footer}>
        PaymentEnforcer <code>{config.paymentEnforcer.slice(0, 8)}…</code> · PaymentEscrow <code>{config.paymentEscrow.slice(0, 8)}…</code> · MockUSDC <code>{config.mockUsdc.slice(0, 8)}…</code> · Base Sepolia
      </footer>
    </main>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

void accent;
