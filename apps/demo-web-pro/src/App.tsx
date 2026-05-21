/**
 * demo-web-pro — capability showcase.
 *
 * Hash-routed gallery. Each capability in `flows.ts` is wired end-to-end
 * against live contracts. New capabilities ship as they get the chain
 * + SDK + UX support. Aspirational copy and stubs do NOT live here —
 * they live in specs/.
 */

import { useEffect, useMemo, useState } from 'react';
import { AppShell, RiskBadge, StatusBadge } from './components';
import { FLOWS, flowBySlug } from './flows';
import { CreateAccountFlow } from './flows/create-account/CreateAccountFlow';
import { ViewAccountFlow } from './flows/view-account/ViewAccountFlow';

export function App() {
  const [hash, setHash] = useState<string>(typeof window !== 'undefined' ? window.location.hash : '');

  useEffect(() => {
    const handler = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const flowMatch = hash.match(/^#\/flows\/([\w-]+)/);
  const activeFlow = flowMatch?.[1];
  const flow = useMemo(() => flowBySlug(activeFlow), [activeFlow]);

  return (
    <AppShell activeFlow={flow}>
      {!flow ? <Gallery /> : <FlowRouter slug={flow.slug} />}
    </AppShell>
  );
}

function Gallery() {
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Demo Web Pro</p>
        <h1>Multi-sig capabilities, one at a time.</h1>
        <p>
          Each card below is a capability wired end-to-end against the Base Sepolia deploy
          (factory <code>0x880FE0…</code>, validator <code>0xccfD79…</code>). New cards appear as
          chain + SDK + UX support lands. We don't list capabilities we can't actually run.
        </p>
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <p className="eyebrow">Live capabilities</p>
        <div className="grid" aria-label="Live capabilities">
          {FLOWS.map((uc) => (
            <a
              key={uc.slug}
              className="card"
              href={`#/flows/${uc.slug}`}
              data-testid={`flow-card-${uc.slug}`}
            >
              <div className="card-header">
                <div>
                  <p className="eyebrow">{uc.steps.join(' → ')}</p>
                  <h2>{uc.title}</h2>
                </div>
                <StatusBadge status={uc.status} />
              </div>
              <p>{uc.oneLiner}</p>
              <div className="actions">
                <RiskBadge risk={uc.risk} />
              </div>
            </a>
          ))}
        </div>
      </section>

      <section className="card muted" style={{ marginTop: '1.5rem' }} data-testid="not-yet">
        <p className="eyebrow">Not in this UI yet</p>
        <h2>Capabilities that still need plumbing</h2>
        <p>
          We add a capability card above only after the chain + SDK + UX path is verifiably live.
          Today's gaps (tracked in specs/207 § 14 + task list):
        </p>
        <ul>
          <li>
            <strong>Add owner / guardian / change mode via admin path</strong> — blocked on the
            ThresholdValidator <code>proposeAdmin</code> eta-coupling fix (task #101).
          </li>
          <li>
            <strong>Add backup passkey to an existing account</strong> — blocked on
            <code> AgentAccountClient.buildUserOp</code> SDK implementation and a corresponding
            demo-a2a relayer endpoint.
          </li>
          <li>
            <strong>T6 Recovery via guardian quorum</strong> — same dependencies as above + 48h
            timelock UX (the contract surface is shipped + tested).
          </li>
          <li>
            <strong>Delegation issuance / redemption</strong> — <code>@agenticprimitives/delegation</code>{' '}
            is built and tested; no demo-web-pro flow wires it yet.
          </li>
        </ul>
      </section>
    </>
  );
}

function FlowRouter({ slug }: { slug: string }) {
  if (slug === 'create-account') return <CreateAccountFlow />;
  if (slug === 'view-account') return <ViewAccountFlow />;
  return (
    <section className="card">
      <h1>Unknown capability</h1>
      <p className="muted">Return to the gallery and choose a supported capability.</p>
      <a href="#/">Back to gallery</a>
    </section>
  );
}
