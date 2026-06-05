// Shared UI primitives for demo-gs — inline styles keyed off index.html CSS vars (indigo
// --c-primary). Mirrors demo-jp's ui.tsx shape but chain-decoupled (no explorer / reverseName);
// AddrChip resolves friendly names from the fixture directory.

import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
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

/** A standalone spinner (control kit). Inherits `currentColor`; `size` is sm (13px) or md (18px). */
export function Spinner({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  return <span className={`spinner spinner-${size}`} aria-hidden="true" />;
}

export function Btn({ children, onClick, disabled, variant = 'primary', size = 'md', busy, style, title }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; busy?: boolean; style?: CSSProperties; title?: string;
}) {
  // `danger` = the warn/amber treatment (Disconnect / withdraw — amber #d97706, matching the
  // AppShellHeader Disconnect item + AgreementsPanel action errors); rendered with an inline style since
  // there's no dedicated CSS class. primary/ghost keep their index.html classes.
  const className = variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : undefined;
  const dangerStyle: CSSProperties = variant === 'danger'
    ? { background: '#fffbeb', color: '#d97706', border: '1.5px solid #fcd34d' }
    : {};
  const pad = size === 'sm' ? '.4rem .8rem' : '.6rem 1.1rem';
  const font = size === 'sm' ? '.82rem' : '.88rem';
  return (
    <button
      className={className}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      style={{ borderRadius: 10, padding: pad, fontWeight: 700, fontSize: font, cursor: disabled || busy ? 'not-allowed' : 'pointer', opacity: disabled || busy ? 0.6 : 1, border: variant === 'ghost' ? '1.5px solid var(--c-primary-border)' : variant === 'danger' ? undefined : 'none', ...dangerStyle, ...style }}
    >
      {busy ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.45rem' }}><Spinner />Working…</span> : children}
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

/** A labelled text input (control kit). Wraps the `Field` label pattern + the `inputStyle` look. */
export function TextField({ label, value, onChange, placeholder, type = 'text', disabled, mono, hint, error, autoFocus, onEnter, style }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
  disabled?: boolean; mono?: boolean; hint?: string; error?: string; autoFocus?: boolean; onEnter?: () => void; style?: CSSProperties;
}) {
  const input = (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      autoCapitalize={mono ? 'none' : undefined}
      spellCheck={mono ? false : undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onEnter ? (e) => { if (e.key === 'Enter') onEnter(); } : undefined}
      style={{ ...inputStyle, ...(mono ? { fontFamily: "'SF Mono','Roboto Mono',monospace" } : {}), ...(error ? { borderColor: '#fecaca' } : {}), ...style }}
    />
  );
  const body = (
    <>
      {input}
      {hint && <span style={{ display: 'block', fontSize: '.75rem', color: 'var(--c-g500)', marginTop: '.25rem' }}>{hint}</span>}
      {error && <span style={{ display: 'block', fontSize: '.75rem', color: '#b91c1c', marginTop: '.25rem' }}>{error}</span>}
    </>
  );
  return label ? <Field label={label}>{body}</Field> : <>{body}</>;
}

/** A labelled multi-line text input (control kit) — same shape as TextField. */
export function TextArea({ label, value, onChange, placeholder, disabled, rows = 3, hint, error, style }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string;
  disabled?: boolean; rows?: number; hint?: string; error?: string; style?: CSSProperties;
}) {
  const area = (
    <textarea
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, resize: 'vertical', ...(error ? { borderColor: '#fecaca' } : {}), ...style }}
    />
  );
  const body = (
    <>
      {area}
      {hint && <span style={{ display: 'block', fontSize: '.75rem', color: 'var(--c-g500)', marginTop: '.25rem' }}>{hint}</span>}
      {error && <span style={{ display: 'block', fontSize: '.75rem', color: '#b91c1c', marginTop: '.25rem' }}>{error}</span>}
    </>
  );
  return label ? <Field label={label}>{body}</Field> : <>{body}</>;
}

/** A labelled select (control kit) over the `inputStyle` look. */
export function Select({ label, value, onChange, options, disabled, style }: {
  label?: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
  disabled?: boolean; style?: CSSProperties;
}) {
  const select = (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, ...style }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  return label ? <Field label={label}>{select}</Field> : select;
}

/** An interactive toggle/label chip (control kit). Pill is display-only; Chip is the clickable one. */
export function Chip({ children, active, tone = 'neutral', onClick, title }: {
  children: ReactNode; active?: boolean; tone?: 'neutral' | 'accent'; onClick?: () => void; title?: string;
}) {
  const accent = tone === 'accent';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        fontSize: '.76rem', padding: '.22rem .6rem', borderRadius: 999, cursor: onClick ? 'pointer' : 'default',
        border: '1px solid',
        borderColor: active ? 'var(--c-primary)' : accent ? 'var(--c-accent-border)' : 'var(--c-g200)',
        background: active ? 'var(--c-primary)' : accent ? 'var(--c-accent-subtle)' : '#fff',
        color: active ? '#fff' : accent ? 'var(--c-accent)' : 'var(--c-g600)',
        fontWeight: active ? 700 : 500,
      }}
    >
      {children}
    </button>
  );
}

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

/** Workspace secondary navigation (spec 254) — a `role="tablist"` strip with arrow-key roving focus
 *  (ArrowLeft/Right wrap, Home/End jump, Enter/Space activate) and an optional count badge per tab.
 *  Styling lives in index.html (`.workspace-tabs` / `.workspace-tab` / `--active` / `.workspace-tab-badge`).
 *  Pair each tab with a `role="tabpanel"` keyed `tabpanel-${id}` / `aria-labelledby="tab-${id}"`; inactive
 *  panels stay MOUNTED with the `hidden` attribute (not conditional unmount) so in-progress form state survives. */
export function WorkspaceTabBar({ tabs, active, onChange }: {
  tabs: { id: string; label: string; badge?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusTab = (i: number) => {
    const next = (i + tabs.length) % tabs.length;
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); focusTab(i + 1); break;
      case 'ArrowLeft': e.preventDefault(); focusTab(i - 1); break;
      case 'Home': e.preventDefault(); focusTab(0); break;
      case 'End': e.preventDefault(); focusTab(tabs.length - 1); break;
      case 'Enter':
      case ' ': { e.preventDefault(); const t = tabs[i]; if (t) onChange(t.id); break; }
      default: break;
    }
  };

  return (
    <nav className="workspace-tabs" aria-label="Workspace sections">
      <div role="tablist">
        {tabs.map((t, i) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => { refs.current[i] = el; }}
              id={`tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`tabpanel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              className={`workspace-tab${selected ? ' --active' : ''}`}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {t.label}
              {t.badge ? <span className="workspace-tab-badge">{t.badge}</span> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
