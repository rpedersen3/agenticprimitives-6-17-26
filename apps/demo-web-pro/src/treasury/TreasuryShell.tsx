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
import { DisconnectMenu } from './components/DisconnectMenu';
import { RelationshipsCard } from './components/RelationshipsCard';
import { shortAddress } from '../components';
import { Act1AlicePerson } from './acts/Act1AlicePerson';
import { Act2CreateOrg } from './acts/Act2CreateOrg';
import { Act2_5CreateTreasury } from './acts/Act2_5CreateTreasury';
import { Act3BobJoins } from './acts/Act3BobJoins';
import { config } from '../config';
import type { SeatClaim } from '../lib/seats';
import {
  loadDemoState,
  subscribeDemoState,
  type OrgRecord,
  type TreasuryRecord,
} from '../lib/demo-state';

export function TreasuryShell() {
  const [hash, setHash] = useState<string>(typeof window !== 'undefined' ? window.location.hash : '');
  const [seatsTick, setSeatsTick] = useState(0);
  const [demoTick, setDemoTick] = useState(0);

  useEffect(() => {
    const h = () => setHash(window.location.hash);
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  useEffect(() => subscribeSeats(() => setSeatsTick((t) => t + 1)), []);
  useEffect(() => subscribeDemoState(() => setDemoTick((t) => t + 1)), []);

  const seats = useMemo(() => loadSeats(), [seatsTick]);
  const activeSeatId = useMemo(() => loadActiveSeat(), [seatsTick]);
  const demoState = useMemo(() => loadDemoState(), [demoTick]);
  const org: OrgRecord | null = demoState.org ?? null;
  const treasury: TreasuryRecord | null = demoState.treasury ?? null;

  // Route extraction.
  const actMatch = hash.match(/^#\/acts\/([\w-]+)(?:\/(\w+))?$/);
  const actSlug = actMatch?.[1];
  const seatParam = actMatch?.[2];
  const act = actBySlug(actSlug);

  // Progress markers — a slug is "completed" once its on-chain effect
  // is recorded locally.
  // Act 3 (bob-joins) marked complete once Bob has his own PSA AND
  // the Org has been deployed. The actual on-chain "is Bob a custodian"
  // check happens inside the act itself; this is a coarse hint.
  const completedSlugs = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    if (Object.keys(seats).length > 0) set.add('create-alice');
    if (org) set.add('create-org');
    if (treasury) set.add('create-treasury');
    const bobSeat = orgConfig.seats.find((s) => s.id !== 'alice');
    if (org && bobSeat && seats[bobSeat.id]) {
      // optimistic — actual custodian-set verify lives in the act.
      // Once Act 3 completes the user goes back to the seat picker
      // which re-mounts everything; we set this here for the rail icon.
      // (False-positive risk if Bob is claimed but Act 3 not yet run;
      // see Act 3 itself for the truthful chain-read.)
    }
    return set;
  }, [seats, org, treasury]);

  const goHome = () => {
    window.location.hash = '';
  };

  const mainContent: ReactNode = (() => {
    if (act && act.slug === 'create-alice' && seatParam) {
      return <Act1AlicePerson seatId={seatParam} onComplete={goHome} />;
    }
    if (act && act.slug === 'create-org') {
      return <Act2CreateOrg onComplete={goHome} />;
    }
    if (act && act.slug === 'create-treasury') {
      return <Act2_5CreateTreasury onComplete={goHome} />;
    }
    if (act && act.slug === 'bob-joins') {
      return <Act3BobJoins onComplete={goHome} />;
    }
    if (act && act.status === 'not-started') {
      return <ActNotYet act={act} />;
    }
    // No act in the URL → seat picker (Act 1 entry) OR a "what\'s next"
    // hint when Act 1 is done.
    if (Object.keys(seats).length === 0) {
      return (
        <SeatPicker
          seats={seats}
          onPickSeat={(seatId) => {
            window.location.hash = `#/acts/create-alice/${seatId}`;
          }}
        />
      );
    }
    return (
      <NextStepHint
        seats={seats}
        org={org}
        treasury={treasury}
        onPickSeat={(seatId) => {
          window.location.hash = `#/acts/create-alice/${seatId}`;
        }}
      />
    );
  })();

  return (
    <div className="treasury-shell">
      <TopBar
        seats={seats}
        activeSeatId={activeSeatId}
        org={org}
        treasury={treasury}
      />
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
  org,
  treasury,
}: {
  seats: Record<string, SeatClaim>;
  activeSeatId: string | null;
  org: OrgRecord | null;
  treasury: TreasuryRecord | null;
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
        <span
          className={`actor-pill ${org ? 'claimed' : 'open'}`}
          data-testid="top-actor-org"
          title={org ? org.address : 'Run Act 2 to deploy the Organization'}
        >
          <span className="dot" /> {orgConfig.name}
        </span>
        <span
          className={`actor-pill ${treasury ? 'claimed' : 'open'}`}
          data-testid="top-actor-treasury"
          title={treasury ? treasury.address : 'Run Act 2.5 to deploy the Treasury'}
        >
          <span className="dot" /> Treasury
        </span>
      </div>
      <div className="treasury-topbar__right">
        <span className="chain-pill">
          <span className="dot" />
          {config.chainId === 84532 ? 'Base Sepolia' : `Chain ${config.chainId ?? '?'}`}
        </span>
        <PrincipalChip activeSeatId={activeSeatId} seats={seats} />
        <DisconnectMenu activeSeatId={activeSeatId} seats={seats} />
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

function NextStepHint({
  seats,
  org,
  treasury,
  onPickSeat,
}: {
  seats: Record<string, SeatClaim>;
  org: OrgRecord | null;
  treasury: TreasuryRecord | null;
  onPickSeat: (seatId: string) => void;
}) {
  const claimedCount = Object.keys(seats).length;
  const openSeats = orgConfig.seats.filter((s) => !seats[s.id]);
  const allSeatsClaimed = openSeats.length === 0;

  // Spec 211 § 4: "Both seats need admins for the treasury to
  // activate." Only after every seat has a Person Smart Agent does
  // the next-step CTA point at the Org/Treasury/Act-3 path.
  let nextHref: string | null = null;
  let nextLabel = '';
  if (allSeatsClaimed) {
    if (!org) {
      nextHref = '#/acts/create-org';
      nextLabel = `Create ${orgConfig.name} →`;
    } else if (!treasury) {
      nextHref = '#/acts/create-treasury';
      nextLabel = 'Create Acme Treasury →';
    } else {
      nextHref = '#/acts/bob-joins';
      nextLabel = 'Bring Bob aboard the Org (Act 3) →';
    }
  }

  const headline = (() => {
    if (!allSeatsClaimed) {
      return `${claimedCount} of ${orgConfig.seats.length} seats claimed. ${openSeats[0]?.name} still needs a passkey.`;
    }
    if (!org) return 'Both seats claimed. Ready to deploy the Organization.';
    if (!treasury) return 'Org live. Treasury still needs to be deployed.';
    return 'Org + Treasury live. Continue with Act 3.';
  })();

  const subtext = (() => {
    if (!allSeatsClaimed) {
      return `Per spec 211 § 4 the Organization doesn\'t boot until every admin seat has a Person Smart Agent on chain. Claim the remaining seat${openSeats.length > 1 ? 's' : ''} below.`;
    }
    if (!org) return `${orgConfig.name} deploys with both ${orgConfig.seats.map((s) => s.name).join(' + ')}\'s Person Smart Agents on board (Alice as initial custodian; Bob added via Act 3).`;
    if (!treasury) return `Acme Treasury is the second Smart Agent — owned by ${orgConfig.name}, separate identity from the Org.`;
    return 'Schedule + apply the AddCustodian(Bob) change on the Org.';
  })();

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">{orgConfig.name}</p>
        <h1>{headline}</h1>
        <p>{subtext}</p>
      </div>

      <div className="next-step-grid">
        {/* Always show the open-seat claim buttons first when seats remain. */}
        {openSeats.map((seat) => (
          <button
            key={seat.id}
            type="button"
            className="next-step-card primary"
            onClick={() => onPickSeat(seat.id)}
            data-testid={`next-step-claim-${seat.id}`}
          >
            Claim the {seat.name} seat →
          </button>
        ))}
        {/* Org/Treasury/Act-3 only available once every seat is claimed. */}
        {nextHref && (
          <a
            className={`next-step-card ${openSeats.length === 0 ? 'primary' : 'secondary'}`}
            href={nextHref}
          >
            {nextLabel}
          </a>
        )}
      </div>

      <RelationshipsCard seats={seats} org={org} treasury={treasury} />
    </section>
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
