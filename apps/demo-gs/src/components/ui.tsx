// Shared UI primitives for demo-gs — inline styles keyed off index.html CSS vars (indigo
// --c-primary). Mirrors demo-jp's ui.tsx shape but chain-decoupled (no explorer / reverseName);
// AddrChip resolves friendly names from the fixture directory.

import type { CSSProperties, ReactNode } from 'react';
import { agentName } from '../lib/names';

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ border: '1px solid var(--c-g200)', borderRadius: 16, background: '#fff', padding: '1.4rem 1.5rem', boxShadow: '0 1px 2px rgba(15,23,42,.04)', ...style }}>
      {children}
    </div>
  );
}

export function SectionHead({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h2 style={{ fontSize: '1.25rem', marginTop: eyebrow ? '.35rem' : 0 }}>{title}</h2>
      {sub && <p style={{ color: 'var(--c-g500)', fontSize: '.9rem', marginTop: '.4rem' }}>{sub}</p>}
    </div>
  );
}

export function Btn({ children, onClick, disabled, variant = 'primary', busy, style }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: 'primary' | 'ghost'; busy?: boolean; style?: CSSProperties;
}) {
  return (
    <button
      className={variant === 'primary' ? 'btn-primary' : 'btn-ghost'}
      onClick={onClick}
      disabled={disabled || busy}
      style={{ borderRadius: 10, padding: '.6rem 1.1rem', fontWeight: 700, fontSize: '.88rem', cursor: disabled || busy ? 'not-allowed' : 'pointer', opacity: disabled || busy ? 0.6 : 1, border: variant === 'ghost' ? '1.5px solid var(--c-primary-border)' : 'none', ...style }}
    >
      {busy ? 'Working…' : children}
    </button>
  );
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <code title={title} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '.78rem', color: 'var(--c-g700)', background: 'var(--c-g100)', borderRadius: 6, padding: '.1rem .35rem', wordBreak: 'break-all' }}>
      {children}
    </code>
  );
}

export function shortHex(s: string | undefined, head = 6, tail = 4): string {
  if (!s) return '—';
  if (s.length <= head + tail + 2) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** A name-or-hex chip for an agent id/address. Resolves the fixture directory name when known. */
export function AddrChip({ id }: { id?: string }) {
  if (!id) return <span>—</span>;
  const addr = id.includes(':') ? id.split(':').pop()! : id;
  const name = agentName(addr);
  return name
    ? <span style={{ fontWeight: 600, color: 'var(--c-g800)' }} title={addr}>{name}</span>
    : <Mono title={addr}>{shortHex(addr, 8, 6)}</Mono>;
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'neutral' | 'live' }) {
  const tones: Record<string, CSSProperties> = {
    ok: { background: 'var(--c-primary-subtle)', color: 'var(--c-primary-active)', border: '1px solid var(--c-primary-border)' },
    warn: { background: 'var(--c-accent-subtle)', color: 'var(--c-accent)', border: '1px solid var(--c-accent-border)' },
    neutral: { background: 'var(--c-g100)', color: 'var(--c-g600)', border: '1px solid var(--c-g200)' },
    live: { background: '#ecfdf5', color: '#047857', border: '1px solid #6ee7b7' },
  };
  return <span style={{ fontSize: '.72rem', fontWeight: 800, letterSpacing: '.02em', borderRadius: 999, padding: '.2rem .6rem', display: 'inline-block', ...tones[tone] }}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: '.7rem' }}>
      <span style={{ display: 'block', fontSize: '.72rem', fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--c-g500)', marginBottom: '.3rem' }}>{label}</span>
      {children}
    </label>
  );
}

export const inputStyle: CSSProperties = {
  width: '100%', borderRadius: 9, border: '1.5px solid var(--c-g200)', padding: '.55rem .7rem', fontSize: '.88rem', fontFamily: 'inherit', color: 'var(--c-g800)',
};

export function Banner({ tone, children }: { tone: 'ok' | 'warn' | 'err'; children: ReactNode }) {
  const tones: Record<string, CSSProperties> = {
    ok: { background: 'var(--c-primary-subtle)', borderColor: 'var(--c-primary-border)', color: 'var(--c-primary-active)' },
    warn: { background: 'var(--c-accent-subtle)', borderColor: 'var(--c-accent-border)', color: 'var(--c-accent)' },
    err: { background: '#fef2f2', borderColor: '#fecaca', color: '#b91c1c' },
  };
  return <div style={{ border: '1px solid', borderRadius: 10, padding: '.7rem .9rem', fontSize: '.85rem', ...tones[tone] }}>{children}</div>;
}

export function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 70 ? '#047857' : score >= 40 ? '#b45309' : '#64748b';
  const bg = score >= 70 ? '#ecfdf5' : score >= 40 ? '#fffbeb' : '#f1f5f9';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, height: 44, borderRadius: 12, fontWeight: 900, fontSize: '1.05rem', color: tone, background: bg, border: `1px solid ${tone}33` }}>
      {score}
    </span>
  );
}
