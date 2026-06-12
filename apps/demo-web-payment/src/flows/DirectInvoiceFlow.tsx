import { useState } from 'react';
import type { Hex } from 'viem';
import { useApp } from '../app-context';
import { Step, S, TxLink } from '../ui';
import { directPay, createInvoice, payInvoice } from '../lib/flows';
import { fromUsdc, toUsdc } from '../lib/x402-pay';

type Invoice = ReturnType<typeof createInvoice>;

export function DirectInvoiceFlow() {
  const app = useApp();
  const [directHash, setDirectHash] = useState<Hex>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [paidHash, setPaidHash] = useState<Hex>();

  const onDirect = () =>
    app.run('direct', async () => {
      const ctx = app.payCtx();
      if (!ctx) throw new Error('set up your agent accounts first (top bar)');
      app.setStatus('Treasury SA paying 0.50 USDC to the provider treasury (gasless)…');
      const h = await directPay(ctx, toUsdc(0.5));
      setDirectHash(h);
      await new Promise((r) => setTimeout(r, 2000));
      await app.refresh();
      app.setStatus('Direct checkout settled (SA → SA, paymaster-sponsored).');
    });

  const onIssueInvoice = () => {
    if (!app.providerTreasury) { app.setStatus('set up your agent accounts first (top bar)'); return; }
    const inv = createInvoice({
      issuer: app.providerTreasury,
      payTo: app.providerTreasury,
      lineItems: [
        { description: 'Consulting — 2h', amount: toUsdc(1.2) },
        { description: 'Report delivery', amount: toUsdc(0.3) },
      ],
      memo: 'B2B invoice — demo',
    });
    setInvoice(inv);
    setPaidHash(undefined);
    app.setStatus(`Invoice ${inv.invoiceId.slice(0, 10)}… issued for ${fromUsdc(inv.amount)} USDC.`);
  };

  const onPayInvoice = () =>
    app.run('invoice', async () => {
      const ctx = app.payCtx();
      if (!ctx || !invoice) throw new Error('issue an invoice + set up accounts first');
      app.setStatus('Treasury SA paying the invoice (gasless, bound to invoiceId)…');
      const h = await payInvoice(ctx, invoice);
      setPaidHash(h);
      await new Promise((r) => setTimeout(r, 2000));
      await app.refresh();
      app.setStatus('Invoice paid — receipt links invoice ↔ settlement.');
    });

  return (
    <>
      <Step n="A" title="Direct checkout (wallet rail)">
        <p style={S.hint}>A single closed-mandate transfer — no budget, no 402 round-trip. Plain "pay now".</p>
        <div style={{ ...S.rowBetween, marginTop: 12 }}>
          <span style={S.mono}>0.50 USDC → provider</span>
          <button style={S.btn} disabled={!app.isConnected || app.busy === 'direct'} onClick={onDirect}>
            {app.busy === 'direct' ? 'Paying…' : 'Pay 0.50 USDC'}
          </button>
        </div>
        {directHash && <p style={S.hint}>✓ paid · <TxLink hash={directHash} /></p>}
      </Step>

      <Step n="B" title="Invoice (request-for-payment)">
        <p style={S.hint}>The provider issues an invoice with line items; you review and pay it via the wallet rail. The mandate is bound to the invoiceId.</p>
        <div style={{ ...S.rowBetween, marginTop: 12 }}>
          <button style={S.btnGhost} onClick={onIssueInvoice}>Provider: issue invoice</button>
          <button style={S.btn} disabled={!invoice || app.busy === 'invoice'} onClick={onPayInvoice}>
            {app.busy === 'invoice' ? 'Paying…' : invoice ? `Pay ${fromUsdc(invoice.amount)} USDC` : 'Pay invoice'}
          </button>
        </div>
        {invoice && (
          <ul style={{ ...S.rows, listStyle: 'none', padding: 0, marginTop: 12 }}>
            {invoice.lineItems.map((li, i) => (
              <li key={i} style={S.row3}>
                <span>{li.description}</span>
                <span style={S.mono}>{fromUsdc(li.amount)} USDC</span>
                <span />
              </li>
            ))}
            <li style={S.row3}>
              <strong>Total</strong>
              <strong style={S.mono}>{fromUsdc(invoice.amount)} USDC</strong>
              <span>{paidHash ? <TxLink hash={paidHash} label="receipt ↗" /> : <span style={S.muted}>unpaid</span>}</span>
            </li>
          </ul>
        )}
      </Step>
    </>
  );
}
