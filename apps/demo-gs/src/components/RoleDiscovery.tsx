// Post-connect role discovery (spec 252 design spec §9/§13/§15a). After a connect-return the active
// context hydrates async; instead of a blank/wrong workspace we show a visible timeline driven by the
// store's `isHydrated()` / `loadError()`, plus the "what Switchboard can access" table. On hydrate the
// App routes on to the workspace/hub; on a vault error we surface it (never fall back — ADR-0013).
//
// §15b.1 caveat: the access table is owner-keyed today; record-scope is the spec-248 intended model.

import { useSyncExternalStore } from 'react';
import { isHydrated, loadError, subscribe, version } from '../lib/store';
import { GS } from '../lib/gs-brand';
import type { RoleKind } from '../lib/role-capabilities';
import { Banner, Card, Pill } from './ui';

interface Step { label: string; done: boolean }

export function RoleDiscovery({ kind, onRetry }: { kind: RoleKind; onRetry: () => void }) {
  useSyncExternalStore(subscribe, version, version);
  const hydrated = isHydrated();
  const err = loadError();

  // The store hydrates the whole entitled view in one pass, so we model the timeline against the two
  // observable signals: verified sign-in (we got here from a return), and the vault read completing.
  const steps: Step[] = [
    { label: `Verified your ${GS.community} sign-in`, done: true },
    { label: 'Loaded the member registry + grant', done: hydrated || !!err },
    { label: 'Read your vault (gs:needs / gs:offering)', done: hydrated },
    { label: 'Resolved your workspace', done: hydrated },
  ];

  const accessRows: Array<{ rec: string; access: string; tone: 'ok' | 'warn' }> =
    kind === 'gco'
      ? [
          { rec: 'gs:needs (your org vault)', access: 'read + write', tone: 'ok' },
          { rec: 'match status', access: 'read', tone: 'ok' },
          { rec: 'your contact', access: 'only on accept', tone: 'warn' },
        ]
      : [
          { rec: 'gs:offering (your vault)', access: 'read + write', tone: 'ok' },
          { rec: 'match status', access: 'read', tone: 'ok' },
          { rec: 'your contact', access: 'only on accept', tone: 'warn' },
        ];

  return (
    <Card style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="eyebrow">Setting up your workspace</div>
      <h2 style={{ fontSize: '1.35rem', marginTop: '.35rem' }}>Connection status</h2>

      <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
        {steps.map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
            <span style={{
              width: 20, height: 20, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '.7rem', fontWeight: 900, color: '#fff',
              background: s.done ? '#16a34a' : 'var(--c-g200)',
            }} aria-hidden="true">{s.done ? '✓' : ''}</span>
            <span style={{ fontSize: '.9rem', fontWeight: 600, color: s.done ? 'var(--c-g800)' : 'var(--c-g500)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {err && (
        <div style={{ marginTop: '1rem' }}>
          <Banner tone="err">
            Couldn&rsquo;t reach the vault: {err}. Please retry — Switchboard never falls back to local data.
          </Banner>
          <button className="btn-ghost" onClick={onRetry} style={{ marginTop: '.6rem', borderRadius: 10, padding: '.5rem 1rem', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer' }}>
            Retry discovery
          </button>
        </div>
      )}

      <div style={{ marginTop: '1.25rem', background: 'var(--c-g50)', border: '1px solid var(--c-g200)', borderRadius: 12, padding: '.9rem 1rem' }}>
        <h3 style={{ fontSize: '.9rem', color: 'var(--c-g800)' }}>What Switchboard can access</h3>
        <div style={{ marginTop: '.6rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
          {accessRows.map((row) => (
            <div key={row.rec} style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
              <span style={{ flex: 1, fontSize: '.82rem', color: 'var(--c-g700)', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>{row.rec}</span>
              <Pill tone={row.tone}>{row.access}</Pill>
            </div>
          ))}
        </div>
        <p style={{ fontSize: '.74rem', color: 'var(--c-g500)', marginTop: '.6rem' }}>
          Owner-keyed today; record-scope = spec 248.
        </p>
      </div>
    </Card>
  );
}
