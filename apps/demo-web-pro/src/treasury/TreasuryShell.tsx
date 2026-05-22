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
import {
  loadSeats,
  loadActiveSeat,
  subscribeSeats,
  migrateSeatsAddPersonIdentity,
} from '../lib/seats';
import { getPasskeyForSeat } from '../lib/passkey';
import { passkeyIdentity } from '@agenticprimitives/custody';
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
import { Act4TwoPersonControl } from './acts/Act4TwoPersonControl';
import { config } from '../config';
import type { SeatClaim } from '../lib/seats';
import {
  loadDemoState,
  subscribeDemoState,
  clearStrandedOrg,
  clearStrandedTreasury,
  type OrgRecord,
  type TreasuryRecord,
} from '../lib/demo-state';
import {
  readAccountFactory,
  readApprovalsRequired,
  readBalance,
  readIsCustodian,
  readPaymasterDeposit,
} from '../lib/chain-reads';
import { formatEther } from 'viem';

export function TreasuryShell() {
  const [hash, setHash] = useState<string>(typeof window !== 'undefined' ? window.location.hash : '');
  const [seatsTick, setSeatsTick] = useState(0);
  const [demoTick, setDemoTick] = useState(0);
  const [strandedNotice, setStrandedNotice] = useState<string | null>(null);

  useEffect(() => {
    const h = () => setHash(window.location.hash);
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  useEffect(() => subscribeSeats(() => setSeatsTick((t) => t + 1)), []);
  useEffect(() => subscribeDemoState(() => setDemoTick((t) => t + 1)), []);

  // Phase 6f.4 migration — pre-pivot SeatClaim records have no
  // `personIdentity` field; derive it from the locally-stored passkey
  // on first load so Acts 3/4 + UI cards can rely on it.
  useEffect(() => {
    migrateSeatsAddPersonIdentity((seatId) => {
      const pk = getPasskeyForSeat(seatId);
      if (!pk) return null;
      return passkeyIdentity(pk.pubKeyX, pk.pubKeyY);
    });
  }, []);

  // Phase 6f.4 guard — after a contracts redeploy, any Org or Treasury
  // saved in localStorage from the previous deploy is "stranded":
  // CREATE2-deterministic addresses don't change with the proxy code,
  // so the saved address still has bytecode on chain, but the current
  // CustodyPolicy isn't installed on it. Every admin action would
  // revert with `NotInstalledOn`. Detect by comparing each saved
  // account's `.factory()` view to the current config and auto-clear.
  useEffect(() => {
    const verify = async () => {
      const currentFactory = config.factoryAddress?.toLowerCase();
      if (!currentFactory) return;
      const state = loadDemoState();
      const findings: string[] = [];

      if (state.org) {
        const f = await readAccountFactory(state.org.address);
        if (f && f.toLowerCase() !== currentFactory) {
          findings.push(
            `Org at ${state.org.address.slice(0, 10)}… was deployed by factory ${f.slice(0, 10)}…; cleared.`,
          );
          clearStrandedOrg();
        }
      }
      if (state.treasury) {
        const f = await readAccountFactory(state.treasury.address);
        if (f && f.toLowerCase() !== currentFactory) {
          findings.push(
            `Treasury at ${state.treasury.address.slice(0, 10)}… was deployed by factory ${f.slice(0, 10)}…; cleared.`,
          );
          clearStrandedTreasury();
        }
      }
      if (findings.length > 0) {
        setStrandedNotice(
          `Cleared stranded demo state (factory changed since last visit). ${findings.join(' ')} Re-run the affected acts.`,
        );
      }
    };
    void verify();
    // Intentionally only on first mount: a redeploy changes the
    // factory immutable address baked into config.factoryAddress, so
    // the comparison is stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // is observable via a public-RPC read. The local-only checks (seat
  // claimed, Org/Treasury deployed) are coarse hints we fill in
  // immediately; the deeper checks (Bob on Org, Bob on Treasury, Org
  // T4=2) are loaded asynchronously and merged in.
  const [chainCompletedSlugs, setChainCompletedSlugs] = useState<Set<string>>(new Set());
  useEffect(() => {
    const probe = async () => {
      if (!config.custodyPolicy) return;
      const bobSeat = orgConfig.seats.find((s) => s.id !== 'alice');
      const bobClaim = bobSeat ? seats[bobSeat.id] : null;
      const next = new Set<string>();
      try {
        // Act 3: Bob's PIA is a custodian of the Org.
        if (org && bobClaim?.personIdentity) {
          const bobOnOrg = await readIsCustodian({
            account: org.address,
            signer: bobClaim.personIdentity,
          });
          if (bobOnOrg) next.add('bob-joins');
        }
        // Act 4: Bob's PIA is a custodian of Treasury AND Org's T4 = 2.
        if (org && treasury && bobClaim?.personIdentity) {
          const [bobOnTreasury, orgT4] = await Promise.all([
            readIsCustodian({
              account: treasury.address,
              signer: bobClaim.personIdentity,
            }),
            readApprovalsRequired({
              custodyPolicy: config.custodyPolicy,
              account: org.address,
              tier: 4,
            }),
          ]);
          if (bobOnTreasury && orgT4 >= 2) next.add('two-person-control');
        }
      } catch {
        // tolerate flake — refresh on next tick
      }
      setChainCompletedSlugs(next);
    };
    void probe();
    const interval = setInterval(probe, 15_000);
    return () => clearInterval(interval);
  }, [seats, org, treasury]);

  const completedSlugs = useMemo<Set<string>>(() => {
    const set = new Set<string>(chainCompletedSlugs);
    if (Object.keys(seats).length > 0) set.add('create-alice');
    if (org) set.add('create-org');
    if (treasury) set.add('create-treasury');
    return set;
  }, [seats, org, treasury, chainCompletedSlugs]);

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
    if (act && act.slug === 'two-person-control') {
      return <Act4TwoPersonControl onComplete={goHome} />;
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
        completedSlugs={completedSlugs}
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
      {strandedNotice && (
        <div
          className="stranded-banner"
          role="status"
          data-testid="stranded-banner"
          style={{
            background: '#fff4e6',
            border: '1px solid #f5b66c',
            padding: '8px 14px',
            color: '#7a3e00',
            fontSize: '0.875rem',
          }}
        >
          <strong>Heads up:</strong> {strandedNotice}{' '}
          <button
            type="button"
            onClick={() => setStrandedNotice(null)}
            style={{ marginLeft: 8, background: 'transparent', border: 'none', color: '#7a3e00', cursor: 'pointer', textDecoration: 'underline' }}
          >
            dismiss
          </button>
        </div>
      )}
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
        <GasReadout />
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

/**
 * Compact ETH-balance readout for the top bar — paymaster deposit at the
 * EntryPoint (sponsors all gasless userOps) + deployer EOA balance (the
 * relayer that pays for `cast send paymaster.deposit{...}` top-ups + raw
 * contract deploys). Visible at all times so the demo operator sees when
 * either is running low *before* userOps start failing with AA31.
 */
function GasReadout() {
  const [paymasterWei, setPaymasterWei] = useState<bigint | null>(null);
  const [deployerWei, setDeployerWei] = useState<bigint | null>(null);
  const [topupBusy, setTopupBusy] = useState(false);
  const [topupMsg, setTopupMsg] = useState<string | null>(null);

  const refresh = async () => {
    try {
      if (config.entryPoint && config.smartAgentPaymaster) {
        const dep = await readPaymasterDeposit(
          config.entryPoint,
          config.smartAgentPaymaster,
        );
        setPaymasterWei(dep);
      }
      if (config.deployer) {
        const bal = await readBalance(config.deployer);
        setDeployerWei(bal);
      }
    } catch {
      // tolerate flake — next tick will retry
    }
  };

  useEffect(() => {
    void refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTopup = async () => {
    if (topupBusy) return;
    if (!config.demoA2aUrl) {
      setTopupMsg('demo-a2a URL not configured.');
      return;
    }
    setTopupBusy(true);
    setTopupMsg(null);
    try {
      const { ensureCsrfToken, csrfHeaders } = await import('../lib/csrf');
      await ensureCsrfToken();
      const base = config.demoA2aUrl.replace(/\/$/, '');
      const res = await fetch(`${base}/admin/topup-paymaster`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({}),
      });
      const raw = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Non-JSON response (e.g. Cloudflare "Internal Server Error" page) —
        // surface what we got so the operator sees the actual failure.
        setTopupMsg(`Topup HTTP ${res.status}: ${raw.slice(0, 80)}`);
        return;
      }
      if (res.ok && body.ok === true) {
        setTopupMsg(`Topped up ${formatEther(BigInt(String(body.amountWei)))} ETH ✓`);
        await refresh();
      } else {
        setTopupMsg(
          `Topup failed: ${typeof body.detail === 'string' ? body.detail : String(body.error ?? 'unknown')}`,
        );
      }
    } catch (e) {
      setTopupMsg(`Topup error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTopupBusy(false);
      setTimeout(() => setTopupMsg(null), 8000);
    }
  };

  if (!config.entryPoint && !config.deployer) return null;

  const fmt = (wei: bigint | null) =>
    wei === null ? '…' : `${Number(formatEther(wei)).toFixed(4)} ETH`;
  const low = (wei: bigint | null, floor: bigint) =>
    wei !== null && wei < floor;

  return (
    <span
      className="gas-readout"
      style={{
        display: 'inline-flex',
        gap: 10,
        padding: '4px 10px',
        background: '#f5f5f7',
        borderRadius: 6,
        fontSize: '0.78rem',
        color: '#444',
        alignItems: 'center',
      }}
    >
      <button
        type="button"
        onClick={onTopup}
        disabled={topupBusy}
        title={topupBusy
          ? 'Topup in flight…'
          : 'Click to move up to 0.002 ETH from the deployer EOA into the paymaster\'s EntryPoint deposit. Capped: refuses if paymaster already ≥ 0.005 ETH; rate-limited to one call per 30s.'}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          font: 'inherit',
          color: low(paymasterWei, 500_000_000_000_000n) ? '#b6471f' : undefined,
          cursor: topupBusy ? 'progress' : 'pointer',
          textDecoration: 'underline dotted',
          textUnderlineOffset: 2,
        }}
        data-testid="gas-readout-topup"
      >
        ⛽ paymaster {fmt(paymasterWei)}
      </button>
      <span
        title="Deployer EOA balance — the key that funds paymaster topups. When this runs low, refill the EOA via a faucet."
        style={{ color: low(deployerWei, 1_000_000_000_000_000n) ? '#b6471f' : undefined }}
      >
        🧰 deployer {fmt(deployerWei)}
      </span>
      {topupMsg && (
        <span style={{ marginLeft: 6, color: topupMsg.includes('✓') ? '#196e2a' : '#b6471f' }}>
          {topupMsg}
        </span>
      )}
    </span>
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
  completedSlugs,
  onPickSeat,
}: {
  seats: Record<string, SeatClaim>;
  org: OrgRecord | null;
  treasury: TreasuryRecord | null;
  completedSlugs: Set<string>;
  onPickSeat: (seatId: string) => void;
}) {
  const claimedCount = Object.keys(seats).length;
  const openSeats = orgConfig.seats.filter((s) => !seats[s.id]);
  const allSeatsClaimed = openSeats.length === 0;
  const bobOnOrg = completedSlugs.has('bob-joins');
  const twoPersonControl = completedSlugs.has('two-person-control');

  let nextHref: string | null = null;
  let nextLabel = '';
  if (allSeatsClaimed) {
    if (!org) {
      nextHref = '#/acts/create-org';
      nextLabel = `Create ${orgConfig.name} →`;
    } else if (!treasury) {
      nextHref = '#/acts/create-treasury';
      nextLabel = 'Create Acme Treasury →';
    } else if (!bobOnOrg) {
      nextHref = '#/acts/bob-joins';
      nextLabel = 'Bring Bob aboard the Org (Act 3) →';
    } else if (!twoPersonControl) {
      nextHref = '#/acts/two-person-control';
      nextLabel = 'Set 2-of-2 control (Act 4) →';
    }
  }

  const headline = (() => {
    if (!allSeatsClaimed) {
      return `${claimedCount} of ${orgConfig.seats.length} seats claimed. ${openSeats[0]?.name} still needs a passkey.`;
    }
    if (!org) return 'Both seats claimed. Ready to deploy the Organization.';
    if (!treasury) return 'Org live. Treasury still needs to be deployed.';
    if (!bobOnOrg) return 'Org + Treasury live. Continue with Act 3.';
    if (!twoPersonControl) return 'Bob is on the Org. Continue with Act 4 to require 2-of-2.';
    return 'All admin acts complete. Act 5 (delegation) is queued.';
  })();

  const subtext = (() => {
    if (!allSeatsClaimed) {
      return `Per spec 211 § 4 the Organization doesn\'t boot until every admin seat has a Person Smart Agent on chain. Claim the remaining seat${openSeats.length > 1 ? 's' : ''} below.`;
    }
    if (!org) return `${orgConfig.name} deploys with Alice\'s passkey identity as initial custodian; Bob\'s passkey is added in Act 3.`;
    if (!treasury) return `Acme Treasury is the second Smart Agent — authorized by ${orgConfig.name}, but custodied by passkey identities.`;
    if (!bobOnOrg) return 'Schedule + apply the AddPasskeyCredential(Bob) change on the Org.';
    if (!twoPersonControl) return 'Add Bob\'s passkey to the Treasury + raise the Org\'s T4 quorum to 2-of-2. Alice signs both admin changes.';
    return 'Inter-agent stewardship (Treasury → Person Agents) ships in phase 6f.5.';
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
