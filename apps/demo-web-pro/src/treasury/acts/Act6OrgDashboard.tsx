/**
 * Act 6 — Acme Construction Control Dashboard (spec 211 § Act 6).
 *
 * Read-only stitched panel showing the four-agent picture, the Treasury
 * delegations issued in Act 5, and pending scheduled admin changes from
 * the CustodyPolicy. All reads are 🟢 LIVE — no simulation.
 *
 * Panels:
 *   1. Org card           — address, custodians, T4 quorum, list of service agents
 *   2. Treasury card      — address, custodians, balance, T4 quorum,
 *                            actedOnBehalfOf Org (PROV-O attestation)
 *   3. Person Smart Agents — Alice + Bob, with all enrolled identities
 *   4. Active treasury permissions — permission cards from Act 5
 *   5. Pending admin changes — last few unexecuted ScheduledChanges on
 *                              Org + Treasury, with eta countdown
 */

import { useEffect, useState, type JSX } from 'react';
import { formatEther, type Address } from 'viem';
import { orgConfig } from '../../org-config';
import {
  getPasskeyAuth,
  getSiweAuth,
  loadSeats,
} from '../../lib/seats';
import { loadOrg, loadTreasury } from '../../lib/demo-state';
import {
  readApprovalsRequired,
  readBalance,
  readIsCustodian,
  readScheduledChange,
  readScheduledChangeCount,
} from '../../lib/chain-reads';
import {
  loadAllDelegations,
  loadDelegationsByKind,
  findDelegation,
  subscribeDelegations,
  clearDelegations,
  type StoredDelegation,
} from '../../lib/delegations';
import { shortAddress } from '../../components';
import { LiveStatusBadge } from '../components/LiveStatusBadge';
import { config } from '../../config';

interface PendingChange {
  account: Address;
  accountLabel: string;
  changeId: bigint;
  action: number;
  eta: bigint;
  executed: boolean;
  cancelled: boolean;
}

const ACTION_LABELS: Record<number, string> = {
  0: 'AddCustodian',
  1: 'RemoveCustodian',
  2: 'AddPasskeyCredential',
  3: 'RemovePasskeyCredential',
  4: 'RotateCustodian',
  5: 'AddTrustee',
  6: 'RemoveTrustee',
  7: 'StartRecovery',
  15: 'ChangeApprovalsRequired',
};

export function Act6OrgDashboard() {
  const seats = loadSeats();
  const org = loadOrg();
  const treasury = loadTreasury();
  const aliceSeat = orgConfig.seats[0]!;
  const bobSeat = orgConfig.seats[1]!;
  const aliceClaim = seats[aliceSeat.id];
  const bobClaim = seats[bobSeat.id];

  const [orgT4, setOrgT4] = useState<number | null>(null);
  const [treasuryT4, setTreasuryT4] = useState<number | null>(null);
  const [treasuryBalance, setTreasuryBalance] = useState<bigint | null>(null);
  const [custodyChecks, setCustodyChecks] = useState<Map<string, boolean>>(new Map());
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [delegations, setDelegations] = useState<StoredDelegation[]>([]);
  const [fetchInFlight, setFetchInFlight] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [fetchedRecords, setFetchedRecords] = useState<Record<string, any>>({});
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({});

  // Live re-load delegations on change.
  useEffect(() => {
    setDelegations(loadAllDelegations());
    return subscribeDelegations(() => setDelegations(loadAllDelegations()));
  }, []);

  useEffect(() => {
    const refresh = async () => {
      const newChecks = new Map<string, boolean>();
      const orgT4Promise = config.custodyPolicy && org
        ? readApprovalsRequired({ custodyPolicy: config.custodyPolicy, account: org.address, tier: 4 })
        : Promise.resolve<number | null>(null);
      const treasuryT4Promise = config.custodyPolicy && treasury
        ? readApprovalsRequired({ custodyPolicy: config.custodyPolicy, account: treasury.address, tier: 4 })
        : Promise.resolve<number | null>(null);
      const balancePromise = treasury ? readBalance(treasury.address) : Promise.resolve<bigint | null>(null);

      // Custody checks: every (target × identity) pair.
      const identitiesByLabel: Array<{ identity: Address; label: string; seatId: string }> = [];
      if (aliceClaim) {
        const p = getPasskeyAuth(aliceClaim);
        const s = getSiweAuth(aliceClaim);
        if (p) identitiesByLabel.push({ identity: p.pia, label: `${aliceSeat.name} passkey`, seatId: aliceSeat.id });
        if (s) identitiesByLabel.push({ identity: s.eoa, label: `${aliceSeat.name} wallet`, seatId: aliceSeat.id });
      }
      if (bobClaim) {
        const p = getPasskeyAuth(bobClaim);
        const s = getSiweAuth(bobClaim);
        if (p) identitiesByLabel.push({ identity: p.pia, label: `${bobSeat.name} passkey`, seatId: bobSeat.id });
        if (s) identitiesByLabel.push({ identity: s.eoa, label: `${bobSeat.name} wallet`, seatId: bobSeat.id });
      }
      const targets: Array<{ address: Address; label: string }> = [];
      if (org) targets.push({ address: org.address, label: 'org' });
      if (treasury) targets.push({ address: treasury.address, label: 'treasury' });

      const checkPromises = targets.flatMap((t) =>
        identitiesByLabel.map(async (id) => {
          try {
            const ok = await readIsCustodian({ account: t.address, signer: id.identity });
            newChecks.set(`${t.address.toLowerCase()}|${id.identity.toLowerCase()}`, ok);
          } catch { /* tolerate */ }
        }),
      );

      // Pending scheduled changes — last 5 from each of Org + Treasury.
      const pendingList: PendingChange[] = [];
      const scanFor = async (account: Address, label: string) => {
        if (!config.custodyPolicy) return;
        try {
          const last = await readScheduledChangeCount({ custodyPolicy: config.custodyPolicy, account });
          const from = last;
          const to = last > 5n ? last - 5n : 0n;
          for (let id = from; id > to; id--) {
            const sc = await readScheduledChange({
              custodyPolicy: config.custodyPolicy,
              account,
              changeId: id,
            });
            if (!sc.executed && !sc.cancelled && sc.eta > 0n) {
              pendingList.push({
                account,
                accountLabel: label,
                changeId: id,
                action: sc.action,
                eta: sc.eta,
                executed: sc.executed,
                cancelled: sc.cancelled,
              });
            }
          }
        } catch { /* tolerate */ }
      };
      const pendingPromises: Promise<void>[] = [];
      if (org) pendingPromises.push(scanFor(org.address, 'Org'));
      if (treasury) pendingPromises.push(scanFor(treasury.address, 'Treasury'));

      const [orgT4Val, treasuryT4Val, balVal] = await Promise.all([
        orgT4Promise,
        treasuryT4Promise,
        balancePromise,
      ]);
      await Promise.all(checkPromises);
      await Promise.all(pendingPromises);

      setOrgT4(orgT4Val);
      setTreasuryT4(treasuryT4Val);
      setTreasuryBalance(balVal);
      setCustodyChecks(newChecks);
      setPending(pendingList);
    };
    void refresh();
    const interval = setInterval(refresh, 20_000);
    return () => clearInterval(interval);
  }, [org?.address, treasury?.address, aliceClaim?.personAgent, bobClaim?.personAgent]);

  if (!org || !treasury) {
    return (
      <section className="card">
        <h2>Act 6 — Org Dashboard</h2>
        <p className="muted">
          Need Org + Treasury deployed before this dashboard is meaningful. Walk Acts 1 → 4.
        </p>
        <a href="#/" className="primary">← Back</a>
      </section>
    );
  }

  const verdictMark = (v: boolean | undefined) =>
    v === true ? '✓' : v === false ? '✗' : '…';

  const fmtEth = (wei: bigint | null) =>
    wei === null ? '…' : `${Number(formatEther(wei)).toFixed(4)} ETH`;

  const renderIdentitiesForTarget = (target: Address) => {
    const rows: JSX.Element[] = [];
    const seatsToShow: Array<{ name: string; claim: ReturnType<typeof getPasskeyAuth> extends infer T ? T : never }> = [];
    void seatsToShow;
    [aliceClaim, bobClaim].forEach((claim, i) => {
      if (!claim) return;
      const seatName = i === 0 ? aliceSeat.name : bobSeat.name;
      const p = getPasskeyAuth(claim);
      const s = getSiweAuth(claim);
      if (p) {
        const v = custodyChecks.get(`${target.toLowerCase()}|${p.pia.toLowerCase()}`);
        rows.push(
          <li key={`${target}-${seatName}-p`}>
            {seatName} passkey <code>{shortAddress(p.pia)}</code>{' '}
            <span style={{ color: v ? '#196e2a' : '#b6471f' }}>{verdictMark(v)}</span>
          </li>,
        );
      }
      if (s) {
        const v = custodyChecks.get(`${target.toLowerCase()}|${s.eoa.toLowerCase()}`);
        rows.push(
          <li key={`${target}-${seatName}-s`}>
            {seatName} wallet <code>{shortAddress(s.eoa)}</code>{' '}
            <span style={{ color: v ? '#196e2a' : '#b6471f' }}>{verdictMark(v)}</span>
          </li>,
        );
      }
    });
    return <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{rows}</ul>;
  };

  return (
    <section>
      <div className="hero">
        <p className="eyebrow">Act 6 · Read-only · <LiveStatusBadge status="live" /></p>
        <h1>{orgConfig.name} control dashboard</h1>
        <p>
          Live snapshot of the four-agent picture, the Treasury\'s stewardship
          delegations from Act 5, and any pending custody changes. All on-chain
          reads through {config.rpcUrl ? 'Alchemy' : 'the public RPC'}.
        </p>
      </div>

      <div className="dashboard-grid" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
        <section className="card">
          <p className="eyebrow">Acme Construction · Org Smart Agent</p>
          <h3>{orgConfig.name}</h3>
          <dl className="kv">
            <dt>Address</dt>
            <dd><code title={org.address}>{shortAddress(org.address)}</code></dd>
            <dt>T4 quorum</dt>
            <dd>{orgT4 === null ? '…' : `${orgT4} of N`}</dd>
            <dt>Service agents</dt>
            <dd>1 (Acme Treasury)</dd>
          </dl>
          <p className="muted small">Custodians:</p>
          {renderIdentitiesForTarget(org.address)}
        </section>

        <section className="card">
          <p className="eyebrow">Acme Treasury · Service Smart Agent</p>
          <h3>Acme Treasury</h3>
          <dl className="kv">
            <dt>Address</dt>
            <dd><code title={treasury.address}>{shortAddress(treasury.address)}</code></dd>
            <dt>Balance</dt>
            <dd>{fmtEth(treasuryBalance)}</dd>
            <dt>T4 quorum</dt>
            <dd>{treasuryT4 === null ? '…' : `${treasuryT4} of N`}</dd>
            <dt>PROV-O</dt>
            <dd className="muted small">
              <code>:acmeTreasury</code> prov:actedOnBehalfOf <code>:acmeConstruction</code>
            </dd>
          </dl>
          <p className="muted small">Custodians:</p>
          {renderIdentitiesForTarget(treasury.address)}
        </section>

        {[aliceClaim, bobClaim].map((claim, i) => {
          if (!claim) return null;
          const seat = i === 0 ? aliceSeat : bobSeat;
          const passkey = getPasskeyAuth(claim);
          const siwe = getSiweAuth(claim);
          return (
            <section key={seat.id} className="card">
              <p className="eyebrow">Person Smart Agent</p>
              <h3>{seat.name}</h3>
              <dl className="kv">
                <dt>Address</dt>
                <dd><code title={claim.personAgent}>{shortAddress(claim.personAgent)}</code></dd>
                {passkey && (
                  <>
                    <dt>Passkey PIA</dt>
                    <dd><code title={passkey.pia}>{shortAddress(passkey.pia)}</code></dd>
                  </>
                )}
                {siwe && (
                  <>
                    <dt>Wallet EOA</dt>
                    <dd><code title={siwe.eoa}>{shortAddress(siwe.eoa)}</code></dd>
                  </>
                )}
                <dt>Enrolled methods</dt>
                <dd>
                  {[passkey && 'passkey', siwe && 'wallet'].filter(Boolean).join(' + ') || '—'}
                </dd>
              </dl>
            </section>
          );
        })}

        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <p className="eyebrow">
            Delegation-gated capabilities · live MCP-style flows{' '}
            <LiveStatusBadge status="live" />
          </p>
          <h3>Exercise the delegations</h3>
          <p className="muted small">
            Each button posts the matching delegation envelope to the worker. The worker
            recomputes the EIP-712 hash, calls{' '}
            <code>delegator.isValidSignature(hash, sig)</code> via ERC-1271, checks the
            timestamp caveat, and returns mock data tied to the delegator address. Caveats
            are bound by the off-chain envelope; on-chain enforcer invocation lights up
            with the USDC redeem path (next slice).
          </p>
          <DelegationActions
            aliceClaim={aliceClaim}
            bobClaim={bobClaim}
            org={org}
            aliceSeat={aliceSeat}
            bobSeat={bobSeat}
            fetchInFlight={fetchInFlight}
            setFetchInFlight={setFetchInFlight}
            fetchedRecords={fetchedRecords}
            setFetchedRecords={setFetchedRecords}
            fetchErrors={fetchErrors}
            setFetchErrors={setFetchErrors}
          />
        </section>

        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <p className="eyebrow">
            OAuth ingress · public MCP client over <code>/mcp</code>{' '}
            <LiveStatusBadge status="live" />
          </p>
          <h3>Same data, via the OAuth ingress (spec 277 Phase 6)</h3>
          <p className="muted small">
            The other way in. Instead of the demo-a2a relay + delegation envelope, the browser acts
            as a <strong>public HTTP MCP client</strong>: it mints a demo bearer token straight from
            demo-mcp&apos;s <code>/oauth/token</code> and presents it to <code>POST /mcp</code>. The
            token carries only a <em>reference + hash</em> to an Agentic Grant Bundle (stored
            encrypted in the vault); demo-mcp re-runs the real authority chain — entitlement → one-time
            DecryptGrant/KAS → required fail-hard audit → projected decrypt — server-side off the
            bundle&apos;s principal. OAuth is ingress only, never the authority.
          </p>
          <OAuthMcpActions
            aliceClaim={aliceClaim}
            bobClaim={bobClaim}
            org={org}
            aliceSeat={aliceSeat}
            bobSeat={bobSeat}
            fetchInFlight={fetchInFlight}
            setFetchInFlight={setFetchInFlight}
            fetchedRecords={fetchedRecords}
            setFetchedRecords={setFetchedRecords}
            fetchErrors={fetchErrors}
            setFetchErrors={setFetchErrors}
          />
        </section>

        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <p className="eyebrow">
            Active permissions · Act 5 output{' '}
            <LiveStatusBadge status="live" />
          </p>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>Issued delegations</h3>
            {delegations.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Wipe all stored delegations? You\'ll need to re-run Act 5 to re-issue them.')) {
                    clearDelegations();
                  }
                }}
                style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                data-testid="clear-delegations"
                title="Wipe localStorage delegations. Useful when re-issuing after a signing-format fix."
              >
                Wipe stored delegations
              </button>
            )}
          </div>
          {delegations.length === 0 ? (
            <p className="muted">
              No delegations issued yet. Run Act 5 to mint the six-delegation surface.{' '}
              <a href="#/acts/delegate-treasury">→ Issue delegations</a>
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
              {delegations.map((d) => (
                <div
                  key={`${d.kind}-${d.delegator}-${d.delegate}`}
                  style={{
                    padding: 12,
                    background: '#fafafa',
                    borderRadius: 8,
                    border: '1px solid #e6e6ea',
                  }}
                >
                  <p className="eyebrow" style={{ marginTop: 0 }}>
                    {d.delegatorLabel} → {d.delegateLabel}
                    <span className="muted small" style={{ marginLeft: 6 }}>· {d.kind}</span>
                  </p>
                  <p className="muted small">
                    Hash <code title={d.delegationHash}>{shortAddress(d.delegationHash)}</code>
                    {' · '}expires {d.summary.expiry}
                  </p>
                  <p style={{ fontWeight: 600, marginBottom: 4 }}>Can</p>
                  <ul style={{ marginTop: 0, paddingLeft: 18 }}>
                    {d.summary.actions.map((a, idx) => (
                      <li key={idx}>{a}</li>
                    ))}
                  </ul>
                  <p style={{ fontWeight: 600, marginBottom: 4 }}>Limits</p>
                  <ul style={{ marginTop: 0, paddingLeft: 18 }}>
                    {d.summary.limits.map((l, idx) => (
                      <li key={idx}>{l}</li>
                    ))}
                  </ul>
                  <p style={{ fontWeight: 600, marginBottom: 4 }}>Cannot</p>
                  <ul style={{ marginTop: 0, paddingLeft: 18 }}>
                    {d.summary.notPermitted.map((l, idx) => (
                      <li key={idx}>{l}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <p className="eyebrow">Pending scheduled admin changes · live read</p>
          <h3>Pending changes</h3>
          {pending.length === 0 ? (
            <p className="muted">No pending changes — everything scheduled has been applied or cancelled.</p>
          ) : (
            <table className="relationships-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Change id</th>
                  <th>Action</th>
                  <th>Eta</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => {
                  const etaDate = new Date(Number(p.eta) * 1000);
                  return (
                    <tr key={`${p.account}-${p.changeId}`}>
                      <td>{p.accountLabel}{' '}<code>{shortAddress(p.account)}</code></td>
                      <td>{p.changeId.toString()}</td>
                      <td>{ACTION_LABELS[p.action] ?? `action ${p.action}`}</td>
                      <td className="muted small">{etaDate.toISOString().replace('T', ' ').slice(0, 19)} UTC</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </section>
  );
}

// ─── Delegation actions panel ─────────────────────────────────────────

interface SeatLite {
  personAgent: Address;
}

interface DelegationActionsProps {
  aliceClaim?: SeatLite;
  bobClaim?: SeatLite;
  org: { address: Address };
  aliceSeat: { name: string };
  bobSeat: { name: string };
  fetchInFlight: string | null;
  setFetchInFlight: (k: string | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchedRecords: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setFetchedRecords: (m: Record<string, any>) => void;
  fetchErrors: Record<string, string>;
  setFetchErrors: (m: Record<string, string>) => void;
}

function DelegationActions(p: DelegationActionsProps) {
  if (!p.aliceClaim || !p.bobClaim) {
    return <p className="muted">Need both seats claimed first.</p>;
  }
  const callMcp = async (args: {
    label: string;
    endpoint: '/mcp/person/pii' | '/mcp/org/sensitive';
    delegatorKind: 'pii-read' | 'org-sensitive';
    delegator: Address;
    delegate: Address;
  }) => {
    const baseUrl = config.demoA2aUrl;
    if (!baseUrl) {
      p.setFetchErrors({ ...p.fetchErrors, [args.label]: 'demo-a2a URL not configured' });
      return;
    }
    const delegation = findDelegation({
      kind: args.delegatorKind,
      delegator: args.delegator,
      delegate: args.delegate,
    });
    if (!delegation) {
      p.setFetchErrors({
        ...p.fetchErrors,
        [args.label]: `No matching ${args.delegatorKind} delegation stored. Run Act 5.`,
      });
      return;
    }
    p.setFetchInFlight(args.label);
    p.setFetchErrors({ ...p.fetchErrors, [args.label]: '' });
    try {
      const { ensureCsrfToken, csrfHeaders } = await import('../../lib/csrf');
      await ensureCsrfToken();
      const base = baseUrl.replace(/\/$/, '');
      // Stringify with bigint → string for the salt field.
      const body = JSON.stringify({
        delegation: {
          delegator: delegation.delegation.delegator,
          delegate: delegation.delegation.delegate,
          authority: delegation.delegation.authority,
          caveats: delegation.delegation.caveats.map((c) => ({
            enforcer: c.enforcer,
            terms: c.terms,
            args: c.args ?? '0x',
          })),
          salt: delegation.delegation.salt.toString(),
          signature: delegation.delegation.signature,
        },
        requester: args.delegate,
      });
      const res = await fetch(`${base}${args.endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body,
      });
      const raw = await res.text();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        p.setFetchErrors({ ...p.fetchErrors, [args.label]: `HTTP ${res.status}: ${raw.slice(0, 100)}` });
        return;
      }
      if (!res.ok || parsed.ok !== true) {
        p.setFetchErrors({
          ...p.fetchErrors,
          [args.label]:
            typeof parsed.detail === 'string'
              ? parsed.detail
              : typeof parsed.error === 'string'
                ? parsed.error
                : `HTTP ${res.status}`,
        });
        return;
      }
      p.setFetchedRecords({ ...p.fetchedRecords, [args.label]: parsed });
    } catch (e) {
      p.setFetchErrors({ ...p.fetchErrors, [args.label]: e instanceof Error ? e.message : String(e) });
    } finally {
      p.setFetchInFlight(null);
    }
  };

  // Buttons grouped by SUBJECT (the data owner). Each subject can be
  // accessed by the subject themselves (self-delegation) or by another
  // agent that holds a delegation issued by the subject.
  const buttons = [
    // ── Subject: Alice's PII ────────────────────────────────────
    {
      key: 'alice-pii-as-alice',
      group: `${p.aliceSeat.name}'s PII`,
      label: `${p.aliceSeat.name} reads her own PII`,
      description: `self-delegation · ${p.aliceSeat.name}.PSA → ${p.aliceSeat.name}.PSA`,
      go: () =>
        callMcp({
          label: `${p.aliceSeat.name} PII (self)`,
          endpoint: '/mcp/person/pii',
          delegatorKind: 'pii-read',
          delegator: p.aliceClaim!.personAgent,
          delegate: p.aliceClaim!.personAgent,
        }),
      recordKey: `${p.aliceSeat.name} PII (self)`,
    },
    {
      key: 'alice-pii-as-bob',
      group: `${p.aliceSeat.name}'s PII`,
      label: `${p.bobSeat.name} reads ${p.aliceSeat.name}'s PII`,
      description: `cross-person · ${p.aliceSeat.name}.PSA → ${p.bobSeat.name}.PSA`,
      go: () =>
        callMcp({
          label: `${p.aliceSeat.name} PII (via ${p.bobSeat.name})`,
          endpoint: '/mcp/person/pii',
          delegatorKind: 'pii-read',
          delegator: p.aliceClaim!.personAgent,
          delegate: p.bobClaim!.personAgent,
        }),
      recordKey: `${p.aliceSeat.name} PII (via ${p.bobSeat.name})`,
    },
    // ── Subject: Bob's PII ──────────────────────────────────────
    {
      key: 'bob-pii-as-bob',
      group: `${p.bobSeat.name}'s PII`,
      label: `${p.bobSeat.name} reads his own PII`,
      description: `self-delegation · ${p.bobSeat.name}.PSA → ${p.bobSeat.name}.PSA`,
      go: () =>
        callMcp({
          label: `${p.bobSeat.name} PII (self)`,
          endpoint: '/mcp/person/pii',
          delegatorKind: 'pii-read',
          delegator: p.bobClaim!.personAgent,
          delegate: p.bobClaim!.personAgent,
        }),
      recordKey: `${p.bobSeat.name} PII (self)`,
    },
    {
      key: 'bob-pii-as-alice',
      group: `${p.bobSeat.name}'s PII`,
      label: `${p.aliceSeat.name} reads ${p.bobSeat.name}'s PII`,
      description: `cross-person · ${p.bobSeat.name}.PSA → ${p.aliceSeat.name}.PSA`,
      go: () =>
        callMcp({
          label: `${p.bobSeat.name} PII (via ${p.aliceSeat.name})`,
          endpoint: '/mcp/person/pii',
          delegatorKind: 'pii-read',
          delegator: p.bobClaim!.personAgent,
          delegate: p.aliceClaim!.personAgent,
        }),
      recordKey: `${p.bobSeat.name} PII (via ${p.aliceSeat.name})`,
    },
    // ── Subject: Org sensitive data ─────────────────────────────
    {
      key: 'org-alice',
      group: 'Org sensitive data',
      label: `${p.aliceSeat.name} reads Org sensitive data`,
      description: `Org → ${p.aliceSeat.name}.PSA · org-sensitive`,
      go: () =>
        callMcp({
          label: `Org data (${p.aliceSeat.name})`,
          endpoint: '/mcp/org/sensitive',
          delegatorKind: 'org-sensitive',
          delegator: p.org.address,
          delegate: p.aliceClaim!.personAgent,
        }),
      recordKey: `Org data (${p.aliceSeat.name})`,
    },
    {
      key: 'org-bob',
      group: 'Org sensitive data',
      label: `${p.bobSeat.name} reads Org sensitive data`,
      description: `Org → ${p.bobSeat.name}.PSA · org-sensitive`,
      go: () =>
        callMcp({
          label: `Org data (${p.bobSeat.name})`,
          endpoint: '/mcp/org/sensitive',
          delegatorKind: 'org-sensitive',
          delegator: p.org.address,
          delegate: p.bobClaim!.personAgent,
        }),
      recordKey: `Org data (${p.bobSeat.name})`,
    },
  ];

  // Bucket buttons by their `group` (subject) so the UI reads
  // "Alice's PII can be fetched two ways: by Alice, or by Bob".
  const groups = new Map<string, typeof buttons>();
  for (const b of buttons) {
    const list = groups.get(b.group) ?? [];
    list.push(b);
    groups.set(b.group, list);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {Array.from(groups.entries()).map(([groupName, groupButtons]) => (
        <div key={groupName}>
          <p className="eyebrow" style={{ marginTop: 0, marginBottom: 6 }}>
            Subject: <strong>{groupName}</strong>
          </p>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {groupButtons.map((b) => {
              const busy = p.fetchInFlight === b.label;
              const record = p.fetchedRecords[b.recordKey];
              const err = p.fetchErrors[b.recordKey];
              return (
                <div
                  key={b.key}
                  style={{
                    padding: 10,
                    background: '#fafafa',
                    borderRadius: 8,
                    border: '1px solid #e6e6ea',
                  }}
                >
                  <p className="muted small" style={{ margin: 0 }}>
                    {b.description}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void b.go()}
                    style={{ marginTop: 6 }}
                  >
                    {busy ? 'Fetching…' : b.label}
                  </button>
                  {err && (
                    <p className="err" style={{ marginTop: 6, fontSize: '0.8rem' }}>
                      {err}
                    </p>
                  )}
                  {record && (
                    <pre
                      style={{
                        marginTop: 6,
                        fontSize: '0.75rem',
                        background: '#fff',
                        padding: 8,
                        borderRadius: 6,
                        overflowX: 'auto',
                        maxHeight: 220,
                      }}
                    >
                      {JSON.stringify(record.record, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p className="muted small">
        Both routes — self-delegation and cross-person delegation — go through the same
        Person MCP tool. The MCP doesn\'t care WHO is calling, only that a valid delegation
        from the subject exists for the principal. That\'s spec 212\'s "every access flows
        through a delegation" rule in practice.
      </p>
    </div>
  );
}

// ─── OAuth ingress actions panel (spec 277 Phase 6) ───────────────────
//
// The SAME PII/org data, fetched the OTHER way: as a public HTTP MCP client over
// the OAuth ingress, NOT through the demo-a2a relay + delegation envelope. The
// browser mints a demo token straight from demo-mcp's `/oauth/token` (the
// authorization-server stand-in) and presents it as a Bearer to `POST /mcp`. The
// token only carries a ref+hash to a grant bundle; demo-mcp re-runs the real
// authority chain (entitlement → KAS → required audit → decrypt) server-side off
// the bundle's principal. No delegation, no MAC, no session cookie — it talks to
// demo-mcp cross-origin (CORS), which is exactly what an external MCP client does.

interface OAuthMcpActionsProps {
  aliceClaim?: SeatLite;
  bobClaim?: SeatLite;
  org: { address: Address };
  aliceSeat: { name: string };
  bobSeat: { name: string };
  fetchInFlight: string | null;
  setFetchInFlight: (k: string | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchedRecords: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setFetchedRecords: (m: Record<string, any>) => void;
  fetchErrors: Record<string, string>;
  setFetchErrors: (m: Record<string, string>) => void;
}

function OAuthMcpActions(p: OAuthMcpActionsProps) {
  if (!p.aliceClaim || !p.bobClaim) {
    return <p className="muted">Need both seats claimed first.</p>;
  }
  const callOAuthMcp = async (args: {
    label: string;
    principal: Address;
    tool: 'get_pii' | 'get_org_sensitive';
    fields?: string[];
  }) => {
    const mcpUrl = config.demoMcpUrl;
    if (!mcpUrl) {
      p.setFetchErrors({ ...p.fetchErrors, [args.label]: 'demo-mcp URL not configured (VITE_DEMO_MCP_URL)' });
      return;
    }
    const base = mcpUrl.replace(/\/$/, '');
    p.setFetchInFlight(args.label);
    p.setFetchErrors({ ...p.fetchErrors, [args.label]: '' });
    try {
      // 1. Mint a demo bearer token for the principal (authorization-server stand-in).
      const tokRes = await fetch(`${base}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ principal: args.principal, scope: 'mcp:invoke vault:read vault:pii:read' }),
      });
      const tok = (await tokRes.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
      if (!tokRes.ok || !tok.access_token) {
        p.setFetchErrors({ ...p.fetchErrors, [args.label]: `mint failed: ${tok.error_description ?? tok.error ?? `HTTP ${tokRes.status}`}` });
        return;
      }
      // 2. Call the bearer-gated /mcp route (no relay, no MAC, no cookie).
      const res = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.access_token}` },
        body: JSON.stringify({ tool: args.tool, args: args.fields ? { fields: args.fields } : {} }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = (await res.json().catch(() => ({}))) as any;
      if (!res.ok || parsed.ok !== true) {
        p.setFetchErrors({
          ...p.fetchErrors,
          [args.label]: typeof parsed.error === 'string' ? parsed.error : `HTTP ${res.status}`,
        });
        return;
      }
      p.setFetchedRecords({ ...p.fetchedRecords, [args.label]: parsed });
    } catch (e) {
      p.setFetchErrors({ ...p.fetchErrors, [args.label]: e instanceof Error ? e.message : String(e) });
    } finally {
      p.setFetchInFlight(null);
    }
  };

  const buttons = [
    {
      key: 'oauth-alice-pii',
      label: `Read ${p.aliceSeat.name}'s PII via OAuth /mcp`,
      description: `public MCP client · mint token for ${p.aliceSeat.name}.PSA → POST /mcp get_pii`,
      go: () => callOAuthMcp({ label: `OAuth · ${p.aliceSeat.name} PII`, principal: p.aliceClaim!.personAgent, tool: 'get_pii' }),
      recordKey: `OAuth · ${p.aliceSeat.name} PII`,
    },
    {
      key: 'oauth-bob-pii',
      label: `Read ${p.bobSeat.name}'s PII via OAuth /mcp`,
      description: `public MCP client · mint token for ${p.bobSeat.name}.PSA → POST /mcp get_pii`,
      go: () => callOAuthMcp({ label: `OAuth · ${p.bobSeat.name} PII`, principal: p.bobClaim!.personAgent, tool: 'get_pii' }),
      recordKey: `OAuth · ${p.bobSeat.name} PII`,
    },
    {
      key: 'oauth-org',
      label: 'Read Org sensitive data via OAuth /mcp',
      description: 'public MCP client · mint token for Org → POST /mcp get_org_sensitive',
      go: () => callOAuthMcp({ label: 'OAuth · Org data', principal: p.org.address, tool: 'get_org_sensitive' }),
      recordKey: 'OAuth · Org data',
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
      {buttons.map((b) => {
        const busy = p.fetchInFlight === b.label;
        const record = p.fetchedRecords[b.recordKey];
        const err = p.fetchErrors[b.recordKey];
        return (
          <div key={b.key} style={{ padding: 10, background: '#fafafa', borderRadius: 8, border: '1px solid #e6e6ea' }}>
            <p className="muted small" style={{ margin: 0 }}>{b.description}</p>
            <button type="button" disabled={busy} onClick={() => void b.go()} style={{ marginTop: 6 }}>
              {busy ? 'Minting + calling…' : b.label}
            </button>
            {err && <p className="err" style={{ marginTop: 6, fontSize: '0.8rem' }}>{err}</p>}
            {record && (
              <pre style={{ marginTop: 6, fontSize: '0.75rem', background: '#fff', padding: 8, borderRadius: 6, overflowX: 'auto', maxHeight: 220 }}>
                {JSON.stringify(record.record, null, 2)}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Keep loadDelegationsByKind from being tree-shaken if unused elsewhere — it's referenced
// indirectly by future panels.
void loadDelegationsByKind;
