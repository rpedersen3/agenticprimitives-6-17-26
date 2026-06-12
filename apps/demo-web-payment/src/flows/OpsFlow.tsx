import { useState } from 'react';
import type { Address } from 'viem';
import { useApp } from '../app-context';
import { Step, S } from '../ui';
import { eventLog, opsHelpers, type ReceiptRow } from '../lib/flows';
import { fromUsdc, toUsdc } from '../lib/x402-pay';
import type { Hex32 } from '@agenticprimitives/payments';

const ORDER = ('0x' + 'ab'.repeat(32)) as Hex32;

export function OpsFlow() {
  const app = useApp();
  const [tick, setTick] = useState(0);
  const [n, setN] = useState(0);

  // demo receipts (a charge + a refund) over which reconciliation runs
  const receipts: ReceiptRow[] = [
    { mandateId: ('0x' + '11'.repeat(32)) as Hex32, payer: (app.address ?? ('0x' + '00'.repeat(20)) as Address), payee: (app.providerTreasury ?? ('0x' + '00'.repeat(20)) as Address), asset: (app.providerTreasury ?? ('0x' + '00'.repeat(20)) as Address), amount: toUsdc(1), settlementHash: ('0x' + 'a1'.repeat(32)) as Hex32, at: 1, orderHash: ORDER },
    { mandateId: ('0x' + '22'.repeat(32)) as Hex32, payer: (app.providerTreasury ?? ('0x' + '00'.repeat(20)) as Address), payee: (app.address ?? ('0x' + '00'.repeat(20)) as Address), asset: (app.providerTreasury ?? ('0x' + '00'.repeat(20)) as Address), amount: toUsdc(0.25), settlementHash: ('0x' + 'a2'.repeat(32)) as Hex32, at: 2, orderHash: ORDER, refunds: ('0x' + '11'.repeat(32)) as Hex32 },
  ];

  const emit = (dup: boolean) => {
    const key = dup ? 'evt-fixed' : `evt-${n}`;
    const r = eventLog.emit({ idempotencyKey: key, type: dup ? 'payment.settled' : 'entitlement.consumed', at: Math.floor(Date.now() / 1000), orderHash: ORDER });
    if (!dup) setN((x) => x + 1);
    setTick((x) => x + 1);
    app.setStatus(r.accepted ? `Event "${key}" accepted (subscribers notified once).` : `Event "${key}" deduped — idempotent, not re-emitted.`);
  };

  const download = (text: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  };

  const events = eventLog.list();
  void tick;
  const treasuryDelta = opsHelpers.balanceDelta(receipts, (app.providerTreasury ?? ('0x' + '00'.repeat(20)) as Address));

  return (
    <>
      <Step n="1" title="Idempotent event log">
        <p style={S.hint}>At-least-once producers, exactly-once consumers: re-emitting the same idempotency key is a no-op (no re-notify).</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button style={S.btnSm} onClick={() => emit(false)}>Emit unique event</button>
          <button style={S.btnGhost} onClick={() => emit(true)}>Re-emit fixed key (dedup)</button>
        </div>
        <ul style={{ ...S.rows, listStyle: 'none', padding: 0, marginTop: 12 }}>
          {events.length === 0 ? <li style={S.hint}>No events yet.</li> : events.slice(-6).map((e, i) => (
            <li key={i} style={S.row3}><span style={S.mono}>{e.type}</span><span style={S.muted}>{e.idempotencyKey}</span><span /></li>
          ))}
        </ul>
      </Step>

      <Step n="2" title="Reconciliation + export">
        <p style={S.hint}>Payment detection + balance reconciliation from receipts (no eth_getLogs). Demo set: a 1.00 charge + a 0.25 refund on one order.</p>
        <p style={{ ...S.addrLine }}>
          <span style={S.addrLabel}>Order paid?</span><span>{opsHelpers.isOrderPaid(receipts, ORDER) ? '✓ yes' : 'no'}</span>
          <span style={S.balPill}>treasury net {fromUsdc(treasuryDelta)} USDC</span>
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button style={S.btnSm} onClick={() => download(opsHelpers.exportReceiptsCSV(receipts), 'receipts.csv', 'text/csv')}>Export CSV</button>
          <button style={S.btnGhost} onClick={() => download(opsHelpers.exportReceiptsJSON(receipts), 'receipts.json', 'application/json')}>Export JSON</button>
        </div>
      </Step>
    </>
  );
}
