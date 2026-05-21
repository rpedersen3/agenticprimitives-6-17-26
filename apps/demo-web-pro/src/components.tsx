import type { ReactNode } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { ConnectButton } from './connect-button';
import { config } from './config';
import type { FlowMeta, FlowStatus } from './flows';

export function AppShell({
  activeFlow,
  children,
}: {
  activeFlow?: FlowMeta;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#/" aria-label="agenticprimitives demo-web-pro home">
          agenticprimitives <span>pro</span>
        </a>
        <WalletAndModeBar activeFlow={activeFlow} />
      </header>
      <div className="layout">
        {activeFlow && <StepRail steps={activeFlow.steps} activeIndex={0} />}
        <main className="main">{children}</main>
      </div>
    </div>
  );
}

function WalletAndModeBar({ activeFlow }: { activeFlow?: FlowMeta }) {
  const chainId = useChainId();
  const expected = config.chainId;
  const wrongChain = expected !== undefined && chainId !== expected;
  return (
    <div className="wallet-bar">
      <span className={`chain-pill ${wrongChain ? 'danger' : ''}`}>
        {wrongChain ? `Wrong chain ${chainId}` : expected ? `Chain ${expected}` : `Chain ${chainId}`}
      </span>
      <ModePill mode={activeFlow?.mode ?? 'single'} detail={activeFlow?.risk ?? 'No flow selected'} />
      <ConnectButton />
    </div>
  );
}

export function ModePill({
  mode,
  detail,
}: {
  mode: 'single' | 'hybrid' | 'threshold' | 'org';
  detail?: string;
}) {
  const label =
    mode === 'single'
      ? 'JUST ME'
      : mode === 'hybrid'
        ? 'HYBRID'
        : mode === 'threshold'
          ? 'THRESHOLD'
          : 'ORG';
  return (
    <span className={`mode-pill ${mode}`} title={detail}>
      {label}
      {detail && <span>{detail}</span>}
    </span>
  );
}

export function StepRail({ steps, activeIndex }: { steps: string[]; activeIndex: number }) {
  return (
    <aside className="step-rail" aria-label="Flow progress">
      <p className="eyebrow">Flow steps</p>
      <ol>
        {steps.map((step, idx) => (
          <li key={step} className={idx === activeIndex ? 'active' : idx < activeIndex ? 'done' : ''}>
            <span>{idx + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </aside>
  );
}

export function StatusBadge({ status }: { status: FlowStatus }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

export function RiskBadge({ risk }: { risk: string }) {
  const tier = risk.split(' ')[0]?.toLowerCase() ?? 't1';
  return <span className={`risk-badge ${tier}`}>{risk}</span>;
}

export function AddressChipInput({
  label,
  value,
  onChange,
  help,
}: {
  label: string;
  value: `0x${string}`[];
  onChange: (next: `0x${string}`[]) => void;
  help?: string;
}) {
  const addAddress = (raw: string) => {
    const trimmed = raw.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return;
    const addr = trimmed as `0x${string}`;
    if (value.some((existing) => existing.toLowerCase() === addr.toLowerCase())) return;
    onChange([...value, addr]);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <div className="chip-box">
        {value.map((addr) => (
          <span className="chip" key={addr}>
            <code>{shortAddress(addr)}</code>
            <button type="button" aria-label={`Remove ${addr}`} onClick={() => onChange(value.filter((v) => v !== addr))}>
              ×
            </button>
          </span>
        ))}
        <input
          placeholder="Paste 0x address and press Enter"
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            addAddress(event.currentTarget.value);
            event.currentTarget.value = '';
          }}
        />
      </div>
      {help && <small>{help}</small>}
    </label>
  );
}

export function PermissionCard({
  title,
  agent,
  risk,
  allowed,
  limits,
  denied,
  technical,
}: {
  title: string;
  agent: string;
  risk: string;
  allowed: string[];
  limits: string[];
  denied: string[];
  technical?: ReactNode;
}) {
  return (
    <section className="permission-card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Permission request</p>
          <h2>{title}</h2>
          <p className="muted">Agent: {agent}</p>
        </div>
        <RiskBadge risk={risk} />
      </div>
      <ListBlock title="This permits" items={allowed} />
      <ListBlock title="Limits" items={limits} />
      <ListBlock title="This does not permit" items={denied} negative />
      {technical && <details><summary>Show technical details</summary>{technical}</details>}
    </section>
  );
}

export function ThresholdMeter({
  approved,
  required,
  labels,
}: {
  approved: number;
  required: number;
  labels: { label: string; status: 'approved' | 'pending' | 'blocked' }[];
}) {
  return (
    <section className="card">
      <div className="meter-row" aria-label={`${approved} of ${required} approvals`}>
        {Array.from({ length: required }).map((_, idx) => (
          <span key={idx} className={idx < approved ? 'dot filled' : 'dot'} />
        ))}
        <strong>{approved} of {required} approvals</strong>
      </div>
      <ul className="status-list">
        {labels.map((item) => (
          <li key={item.label} className={item.status}>
            <span>{item.status === 'approved' ? '✓' : item.status === 'blocked' ? '!' : '○'}</span>
            {item.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PendingApprovals({ items }: { items: { title: string; meta: string; status: string; risk: string }[] }) {
  return (
    <section className="card">
      <h3>Pending approvals</h3>
      <div className="approval-list">
        {items.map((item) => (
          <article key={item.title} className="approval-item">
            <RiskBadge risk={item.risk} />
            <div>
              <strong>{item.title}</strong>
              <p className="muted">{item.meta}</p>
            </div>
            <span className="status-pill">{item.status}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

export function AuditTrailPreview({ events }: { events: { action: string; detail: string; correlation: string }[] }) {
  return (
    <section className="card">
      <h3>Audit trail preview</h3>
      <ul className="audit-list">
        {events.map((event) => (
          <li key={`${event.action}-${event.correlation}`}>
            <code>{event.action}</code>
            <span>{event.detail}</span>
            <small>{event.correlation}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ListBlock({ title, items, negative }: { title: string; items: string[]; negative?: boolean }) {
  return (
    <div className="list-block">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}><span>{negative ? '×' : '•'}</span>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
