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

import { useEffect, useMemo, useState } from 'react';
import { AppShell, RiskBadge, StatusBadge } from './components';
import { FLOWS, flowBySlug } from './flows';
import { HybridRecoveryFlow } from './flows/hybrid-recovery/HybridRecoveryFlow';

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
  const liveFlows = FLOWS.filter((flow) => flow.availableNow);
  const futureFlows = FLOWS.filter((flow) => !flow.availableNow);

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Demo Web Pro</p>
        <h1>What works now: deploy a hybrid smart account.</h1>
        <p>
          This app is not a full multi-sig product yet. Today it has one live contract-backed path:
          connect a wallet, configure optional guardians, preview the deterministic account address,
          and call `AgentAccountFactory.createAccountWithMode`.
        </p>
      </section>

      <section className="card" data-testid="what-works-now">
        <p className="eyebrow">Supported now</p>
        <h2>Hybrid account setup</h2>
        <p>
          Creates a `hybrid` mode `AgentAccount` with the connected wallet as the primary owner and
          optional guardian addresses. This is the only flow here that attempts a chain write.
        </p>
        <div className="actions">
          <a className="button-link primary" href="#/flows/hybrid-recovery" data-testid="start-live-flow">
            Start hybrid account setup
          </a>
          <RiskBadge risk="T4 Admin" />
          <StatusBadge status="live" />
        </div>
        <p className="muted">
          Needs local env/deployment addresses: <code>VITE_FACTORY_ADDRESS</code>,{' '}
          <code>VITE_THRESHOLD_VALIDATOR</code>, and <code>VITE_CHAIN_ID</code>.
        </p>
      </section>

      <section style={{ marginTop: '1rem' }}>
        <p className="eyebrow">Live path</p>
        <div className="grid" aria-label="Available now">
          {liveFlows.map((uc) => (
            <a key={uc.slug} className="card" href={`#/flows/${uc.slug}`} data-testid={`flow-card-${uc.slug}`}>
              <div className="card-header">
                <div>
                  <p className="eyebrow">{uc.mode} mode</p>
                  <h2>{uc.title}</h2>
                </div>
                <StatusBadge status={uc.status} />
              </div>
              <p>{uc.oneLiner}</p>
              <div className="actions">
                <RiskBadge risk={uc.risk} />
                <span className="muted">{uc.steps.join(' -> ')}</span>
              </div>
            </a>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginTop: '1rem' }} data-testid="future-capabilities">
        <p className="eyebrow">Future, not supported in this UI yet</p>
        <h2>Capabilities that still need on-chain/runtime support</h2>
        <p>
          These are intentionally not primary buttons. They describe where the product is going and
          what must land before the UI should claim they work.
        </p>
        <div className="roadmap-list">
          {futureFlows.map((uc) => (
            <article key={uc.slug} className="roadmap-item" data-testid={`future-${uc.slug}`}>
            <div className="card-header">
              <div>
                <p className="eyebrow">Not live · {uc.mode} mode</p>
                <h2>{uc.title}</h2>
              </div>
              <StatusBadge status={uc.status} />
            </div>
            <p>{uc.oneLiner}</p>
            <strong>Needed before this becomes a real demo:</strong>
            <ul>
              {(uc.requires ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function FlowRouter({ slug }: { slug: string }) {
  if (slug === 'hybrid-recovery') return <HybridRecoveryFlow />;
  const future = flowBySlug(slug);
  if (future) return <FutureCapability flowTitle={future.title} requirements={future.requires ?? []} />;
  return (
    <section className="card">
      <h1>Unknown flow</h1>
      <p className="muted">Return to the gallery and choose a supported capability.</p>
      <a href="#/">Back to gallery</a>
    </section>
  );
}

function FutureCapability({
  flowTitle,
  requirements,
}: {
  flowTitle: string;
  requirements: string[];
}) {
  return (
    <section className="card">
      <p className="eyebrow">Not supported yet</p>
      <h1>{flowTitle}</h1>
      <p>
        This screen is intentionally not interactive. It needs more on-chain/runtime capability
        before it should be presented as a working demo.
      </p>
      <h2>Needed first</h2>
      <ul>
        {requirements.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <a href="#/">Back to what works now</a>
    </section>
  );
}
