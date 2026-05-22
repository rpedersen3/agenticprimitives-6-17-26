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

import { useEffect, useState } from 'react';
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
  loadTreasuryDelegations,
  subscribeTreasuryDelegations,
  type StoredTreasuryDelegation,
} from '../../lib/treasury-delegations';
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
  const [delegations, setDelegations] = useState<StoredTreasuryDelegation[]>([]);

  // Live re-load delegations on change.
  useEffect(() => {
    setDelegations(loadTreasuryDelegations());
    return subscribeTreasuryDelegations(() => setDelegations(loadTreasuryDelegations()));
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
            Active Treasury permissions · Act 5 output{' '}
            <LiveStatusBadge status="simulated" />
          </p>
          <h3>Stewardship delegations</h3>
          {delegations.length === 0 ? (
            <p className="muted">
              No delegations issued yet. Run Act 5 to grant the Person Smart Agents
              standing access to a bounded slice of the Treasury.{' '}
              <a href="#/acts/delegate-treasury">→ Issue delegations</a>
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
              {delegations.map((d) => (
                <div
                  key={d.delegate}
                  style={{
                    padding: 12,
                    background: '#fafafa',
                    borderRadius: 8,
                    border: '1px solid #e6e6ea',
                  }}
                >
                  <p className="eyebrow" style={{ marginTop: 0 }}>
                    Treasury → {d.delegateLabel}
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
