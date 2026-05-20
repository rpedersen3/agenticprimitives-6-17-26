/**
 * demo-web-pro — cross-cutting capability showcase.
 *
 * One route per use case. Today this is a static index of stubs that
 * link to the per-flow docs in `docs/multi-sig/flows/`. As each flow
 * implementation lands (phase 6c.5 onward), the corresponding card
 * upgrades from "stub" → "in-flight" → live + interactive.
 *
 * Routing is hash-based (no React Router dep) so each flow can ship
 * independently without breaking the index. When a flow lands, it
 * mounts a sub-component for its `#/flows/<name>` hash.
 */

import { useEffect, useState } from 'react';
import { ConnectButton } from './connect-button';
import { HybridRecoveryFlow } from './flows/hybrid-recovery/HybridRecoveryFlow';

interface UseCase {
  slug: string;          // hash route, e.g. 'hybrid-recovery'
  title: string;
  oneLiner: string;
  badge?: 'stub' | 'in-flight' | 'live';
  guidePath: string;     // relative path to the markdown walkthrough
}

const USE_CASES: UseCase[] = [
  {
    slug: 'hybrid-recovery',
    title: 'Individual user, seamless recovery',
    oneLiner: 'Single primary passkey → prompt to add a backup → mode flips single→hybrid.',
    badge: 'in-flight',
    guidePath: 'docs/multi-sig/flows/hybrid-recovery.md',
  },
  {
    slug: 'threshold-approval',
    title: 'High-risk agent delegation',
    oneLiner: 'T3 Value grant with permission card + threshold approval + on-chain acceptSessionDelegation blessing.',
    badge: 'stub',
    guidePath: 'docs/multi-sig/flows/threshold-approval.md',
  },
  {
    slug: 'org-treasury',
    title: 'Org treasury',
    oneLiner: 'org mode with 3 admins · 2-of-3 routine · 3-of-3 trust-root · timelocked admin actions.',
    badge: 'stub',
    guidePath: 'docs/multi-sig/flows/org-treasury.md',
  },
  {
    slug: 'steward-attenuation',
    title: 'Steward → delegate → agent',
    oneLiner: 'Cross-delegation chain — child caveats must be a subset of parent.',
    badge: 'stub',
    guidePath: 'docs/multi-sig/flows/steward-attenuation.md',
  },
  {
    slug: 'recovery',
    title: 'Lost device recovery',
    oneLiner: 'Multi-passkey + guardian quorum + 48h timelock + 24h primary-owner cancel window.',
    badge: 'stub',
    guidePath: 'docs/multi-sig/flows/recovery.md',
  },
];

export function App() {
  const [hash, setHash] = useState<string>(typeof window !== 'undefined' ? window.location.hash : '');

  useEffect(() => {
    const handler = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  // No flow components are mounted yet — the hash route is rendered as a
  // "this flow lands in 6c.5" notice. Each flow ships its sub-component
  // as 6c.5 progresses.
  const flowMatch = hash.match(/^#\/flows\/([\w-]+)/);
  const activeFlow = flowMatch?.[1];

  return (
    <>
      <h1>agenticprimitives — capability showcase</h1>
      <p>
        Five cross-cutting use cases from{' '}
        <a href="../specs/207-smart-account-threshold-policy.md">spec 207 § 4.1</a>. Each card links
        to the developer guide; live implementation lands incrementally as phase 6c progresses.
      </p>
      <p className="muted">
        For the simple "EOA SIWE → read profile" flow, see{' '}
        <a href="http://localhost:5173">demo-web</a> (dev) or{' '}
        <a href="https://agenticprimitives-demo.pages.dev">agenticprimitives-demo.pages.dev</a> (prod).
      </p>

      {activeFlow && (
        <>
          <section style={{ marginTop: '1.5rem' }}>
            <h2>Wallet</h2>
            <ConnectButton />
          </section>
          {activeFlow === 'hybrid-recovery' ? (
            <HybridRecoveryFlow />
          ) : (
            <section style={{ margin: '2rem 0', padding: '1rem', border: '1px solid #f0c87f', background: '#fffbeb', borderRadius: 6 }}>
              <h2 style={{ marginTop: 0 }}>{activeFlow}</h2>
              <p>
                This flow's interactive implementation lands in a future sub-phase. Until then, read
                the walkthrough at <code>docs/multi-sig/flows/{activeFlow}.md</code>.
              </p>
            </section>
          )}
          <p style={{ marginTop: '2rem' }}>
            <a href="#/">← back to gallery</a>
          </p>
        </>
      )}

      {!activeFlow && (
        <section>
          <h2>Use cases</h2>
          {USE_CASES.map((uc) => (
            <a key={uc.slug} className="card" href={`#/flows/${uc.slug}`}>
              <h3>
                {uc.title}
                {uc.badge && <span className={`badge ${uc.badge}`}>{uc.badge}</span>}
              </h3>
              <p>{uc.oneLiner}</p>
            </a>
          ))}
        </section>
      )}

      <h2>What is this app?</h2>
      <p>
        <code>demo-web-pro</code> is the canonical home for cross-cutting capability demos —
        anything that threads through ≥ 3 packages and carries its own threat model. Today: multi-sig.
        Queued: treasury, recovery UX, argument-level caveats.
      </p>
      <p>
        Each capability has a guide co-located in <code>docs/&lt;capability&gt;/</code>. The doc + code
        are designed to be read together — open the source for any flow and the matching walkthrough
        is a sibling file. See <code>CLAUDE.md</code> for the app-level navigation.
      </p>
      <p className="muted">
        Index of all cross-cutting capabilities (across the whole monorepo):{' '}
        <code>docs/architecture/cross-cutting-capabilities.md</code>.
      </p>
    </>
  );
}
