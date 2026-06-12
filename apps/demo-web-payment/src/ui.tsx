import type { Address } from 'viem';

const ink = '#1a2433';
export const accent = '#2f6df0';

export const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: 760, margin: '0 auto', padding: '28px 20px 64px', fontFamily: 'system-ui, sans-serif', color: ink },
  header: { marginBottom: 18 },
  h1: { fontSize: 26, margin: '0 0 6px' },
  sub: { color: '#5b6b80', lineHeight: 1.5, margin: 0, fontSize: 14 },
  card: { border: '1px solid #e3e8ef', borderRadius: 12, padding: 18, marginBottom: 14, background: '#fff' },
  stepHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  stepNum: { display: 'inline-flex', width: 24, height: 24, borderRadius: 999, background: accent, color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 },
  rowBetween: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  btn: { background: accent, color: '#fff', border: 0, borderRadius: 8, padding: '9px 16px', fontSize: 14, cursor: 'pointer', fontWeight: 600 },
  btnSm: { background: accent, color: '#fff', border: 0, borderRadius: 7, padding: '6px 12px', fontSize: 13, cursor: 'pointer', fontWeight: 600 },
  btnGhost: { background: '#eef4ff', color: accent, border: 0, borderRadius: 7, padding: '6px 12px', fontSize: 13, cursor: 'pointer', fontWeight: 600 },
  linkBtn: { background: 'none', border: 0, color: accent, cursor: 'pointer', fontSize: 13, textDecoration: 'underline' },
  hint: { color: '#7a8aa0', fontSize: 13, marginTop: 10, marginBottom: 0, lineHeight: 1.4 },
  gasRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f3f8' },
  lowGas: { color: '#b54708', fontWeight: 600 },
  mono: { fontFamily: 'ui-monospace, monospace', fontSize: 13 },
  muted: { color: '#aab4c2' },
  addrLine: { display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 0', fontSize: 14 },
  addrLabel: { minWidth: 170, color: '#5b6b80' },
  balPill: { marginLeft: 'auto', background: '#eef4ff', color: accent, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 },
  rows: { display: 'flex', flexDirection: 'column', gap: 8 },
  row3: { display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid #f0f3f8' },
  receipts: { listStyle: 'none', padding: 0, margin: '10px 0 0' },
  receiptItem: { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, padding: '6px 0', fontSize: 14, borderTop: '1px solid #f0f3f8' },
  link: { color: accent, textDecoration: 'none' },
  status: { background: '#f3f8ff', border: '1px solid #d6e6ff', borderRadius: 8, padding: '10px 14px', fontSize: 14 },
  error: { background: '#fff4f4', border: '1px solid #ffd6d6', color: '#b42318', borderRadius: 8, padding: '10px 14px', fontSize: 14 },
  footer: { marginTop: 24, color: '#9aa6b6', fontSize: 12, textAlign: 'center' },
  tabs: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  tab: { border: '1px solid #e3e8ef', background: '#fff', color: '#5b6b80', borderRadius: 999, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600 },
  tabActive: { border: `1px solid ${accent}`, background: accent, color: '#fff', borderRadius: 999, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600 },
  reserved: { opacity: 0.6 },
};

export function Step({ n, title, children }: { n: number | string; title: string; children: React.ReactNode }) {
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

export function AddrLine({ label, addr, extra }: { label: string; addr?: Address | string | null; extra?: string }) {
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

export function TxLink({ hash, label = 'tx ↗' }: { hash?: string; label?: string }) {
  if (!hash) return null;
  return (
    <a style={S.link} href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}
