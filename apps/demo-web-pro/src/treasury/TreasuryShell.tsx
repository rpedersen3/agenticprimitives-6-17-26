/**
 * TreasuryShell — persistent UI shell for the Treasury demo (spec
 * 211 § 5). Four regions: top bar, left progress rail, main panel,
 * right explainer. Bottom audit strip is a placeholder until phase
 * 6f.9 lights it up with PROV-O Activities.
 *
 * Routing model: hash-based, two route shapes:
 *   #/                  → seat picker (or dashboard if both seats claimed)
 *   #/acts/<slug>       → act router
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ACTS, actBySlug } from './acts';
import { orgConfig } from '../org-config';
import { loadSeats, loadActiveSeat, subscribeSeats } from '../lib/seats';
import { ProgressRail } from './components/ProgressRail';
import { PrincipalChip } from './components/PrincipalChip';
import { LiveStatusBadge } from './components/LiveStatusBadge';
import { SeatPicker } from './components/SeatPicker';
import { Act1AlicePerson } from './acts/Act1AlicePerson';
import { config } from '../config';

export function TreasuryShell() {
  const [hash, setHash] = useState<string>(typeof window !== 'undefined' ? window.location.hash : '');
  const [seatsTick, setSeatsTick] = useState(0);

  useEffect(() => {
    const h = () => setHash(window.location.hash);
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  useEffect(() => subscribeSeats(() => setSeatsTick((t) => t + 1)), []);

  const seats = useMemo(() => loadSeats(), [seatsTick]);
  const activeSeatId = useMemo(() => loadActiveSeat(), [seatsTick]);

  // Route extraction.
  const actMatch = hash.match(/^#\/acts\/([\w-]+)(?:\/(\w+))?$/);
  const actSlug = actMatch?.[1];
  const seatParam = actMatch?.[2];
  const act = actBySlug(actSlug);

  // What's "completed"?
  // Act 1 (create-alice) is completed for a seat once that seat has a claim.
  // Treat the Act 1 slug as completed if AT LEAST ONE seat is claimed —
  // it's the act ladder's first checkpoint, not per-seat.
  const completedSlugs = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    if (Object.keys(seats).length > 0) set.add('create-alice');
    return set;
  }, [seats]);

  const goHome = () => {
    window.location.hash = '';
  };

  // Routing decisions:
  //   - no acts in hash:
  //       * no seats claimed → seat picker (Act 1 entry)
  //       * 1+ seats claimed → ask to claim more OR show dashboard placeholder
  //   - #/acts/create-alice/<seatId> → Act 1 for that seat
  //   - other act slugs → "coming soon" placeholder (phase 6f.2+)
  const mainContent: ReactNode = (() => {
    if (act && act.slug === 'create-alice' && seatParam) {
      return <Act1AlicePerson seatId={seatParam} onComplete={goHome} />;
    }
    if (act && act.status === 'not-started') {
      return <ActNotYet act={act} />;
    }
    return (
      <SeatPicker
        seats={seats}
        onPickSeat={(seatId) => {
          window.location.hash = `#/acts/create-alice/${seatId}`;
        }}
      />
    );
  })();

  return (
    <div className="treasury-shell">
      <TopBar seats={seats} activeSeatId={activeSeatId} />
      <div className="treasury-layout">
        <ProgressRail
          activeSlug={act?.slug ?? null}
          completedSlugs={completedSlugs}
        />
        <main className="treasury-main">{mainContent}</main>
        <RightExplainer act={act ?? null} />
      </div>
      <AuditStrip />
    </div>
  );
}

function TopBar({
  seats,
  activeSeatId,
}: {
  seats: Record<string, { personAgent: `0x${string}` }>;
  activeSeatId: string | null;
}) {
  const seatList = orgConfig.seats;
  return (
    <header className="treasury-topbar">
      <a href="#/" className="brand">
        {orgConfig.name} <span className="muted">· Treasury demo</span>
      </a>
      <div className="treasury-topbar__actors">
        {seatList.map((s) => {
          const claimed = !!seats[s.id];
          return (
            <span
              key={s.id}
              className={`actor-pill ${claimed ? 'claimed' : 'open'}`}
              data-testid={`top-actor-${s.id}`}
            >
              <span className="dot" /> {s.name}
            </span>
          );
        })}
        <span className="actor-pill treasury">
          <span className="dot" /> Treasury — not yet
        </span>
      </div>
      <div className="treasury-topbar__right">
        <span className="chain-pill">
          <span className="dot" />
          {config.chainId === 84532 ? 'Base Sepolia' : `Chain ${config.chainId ?? '?'}`}
        </span>
        <PrincipalChip activeSeatId={activeSeatId} seats={seats as never} />
      </div>
    </header>
  );
}

function RightExplainer({ act }: { act: import('./acts').ActDef | null }) {
  return (
    <aside className="treasury-explainer" aria-label="What this act does">
      <p className="eyebrow">What\'s happening</p>
      {act ? (
        <div>
          <h3>{act.title}</h3>
          <p className="muted">{act.oneLiner}</p>
          <p className="status-line">
            <LiveStatusBadge status={act.status} />
            <span className="muted"> · {act.modality}</span>
          </p>
        </div>
      ) : (
        <div>
          <h3>Seat picker</h3>
          <p className="muted">
            Pick a seat to claim. Each seat gets its own passkey and its own Person
            Smart Agent on chain. Once both seats are claimed, the org boots up.
          </p>
          <p className="muted">
            <LiveStatusBadge status="live" /> — passkey enrollment + Person Smart Agent
            deploy land on Base Sepolia (gasless via paymaster).
          </p>
        </div>
      )}
    </aside>
  );
}

function AuditStrip() {
  return (
    <footer className="treasury-audit-strip" aria-label="Audit strip">
      <span className="muted small">
        Audit strip · PROV-O activities land here in phase 6f.9.
      </span>
    </footer>
  );
}

function ActNotYet({ act }: { act: import('./acts').ActDef }) {
  return (
    <section className="card muted">
      <p className="eyebrow">{act.title}</p>
      <h2>This act is queued.</h2>
      <p>{act.oneLiner}</p>
      <p>
        <LiveStatusBadge status={act.status} />
      </p>
      <p>
        Lands in phase 6f.{ACTS.findIndex((a) => a.slug === act.slug) + 1}. Until then,
        you can return to the seat picker and complete Act 1.
      </p>
      <a href="#/">← Back to seat picker</a>
    </section>
  );
}
