/**
 * RelationshipsCard — verifies on chain who controls what, so the
 * visitor can confirm the demo state matches the spec\'s
 * agent-centric picture (spec 211 § 3 / spec 212).
 *
 * Reads (all public-RPC, no signing):
 *   - Each seat → Person Smart Agent (from local seats)
 *   - Org's mode + custodian count + isCustodian(Alice/Bob)
 *   - Treasury's mode + custodian count + isCustodian(Org)
 *
 * Renders the four-agent graph as a compact table with
 * green/yellow/red dots per relationship.
 */

import { useEffect, useState } from 'react';
import { orgConfig } from '../../org-config';
import type { SeatClaim } from '../../lib/seats';
import type { OrgRecord, TreasuryRecord } from '../../lib/demo-state';
import { readIsCustodian } from '../../lib/chain-reads';
import { shortAddress } from '../../components';

interface Probe {
  loaded: boolean;
  aliceCustodianOfOrg: boolean | null;
  bobCustodianOfOrg: boolean | null;
  orgCustodianOfTreasury: boolean | null;
}

export function RelationshipsCard({
  seats,
  org,
  treasury,
}: {
  seats: Record<string, SeatClaim>;
  org: OrgRecord | null;
  treasury: TreasuryRecord | null;
}) {
  const [probe, setProbe] = useState<Probe>({
    loaded: false,
    aliceCustodianOfOrg: null,
    bobCustodianOfOrg: null,
    orgCustodianOfTreasury: null,
  });

  const aliceSeat = orgConfig.seats[0];
  const bobSeat = orgConfig.seats[1];
  const aliceClaim = aliceSeat ? seats[aliceSeat.id] : undefined;
  const bobClaim = bobSeat ? seats[bobSeat.id] : undefined;

  useEffect(() => {
    const run = async () => {
      const result: Probe = {
        loaded: true,
        aliceCustodianOfOrg: null,
        bobCustodianOfOrg: null,
        orgCustodianOfTreasury: null,
      };
      if (org && aliceClaim) {
        result.aliceCustodianOfOrg = await readIsCustodian({
          account: org.address,
          signer: aliceClaim.personAgent,
        });
      }
      if (org && bobClaim) {
        result.bobCustodianOfOrg = await readIsCustodian({
          account: org.address,
          signer: bobClaim.personAgent,
        });
      }
      if (org && treasury) {
        result.orgCustodianOfTreasury = await readIsCustodian({
          account: treasury.address,
          signer: org.address,
        });
      }
      setProbe(result);
    };
    void run();
  }, [
    seats,
    org?.address,
    treasury?.address,
    aliceClaim?.personAgent,
    bobClaim?.personAgent,
  ]);

  if (!aliceClaim && !bobClaim && !org && !treasury) return null;

  return (
    <section className="relationships-card" data-testid="relationships-card">
      <p className="eyebrow">On-chain state · live read</p>
      <h3>Custody graph</h3>

      <table className="relationships-table">
        <thead>
          <tr>
            <th>Smart Agent</th>
            <th>Address</th>
            <th>Custody</th>
          </tr>
        </thead>
        <tbody>
          {aliceClaim && aliceSeat && (
            <tr>
              <td className="relationship-actor">
                {aliceSeat.name}\'s Person Smart Agent
              </td>
              <td><code>{shortAddress(aliceClaim.personAgent)}</code></td>
              <td>
                <RelationshipDot kind="passkey" />
                Custodian: {aliceSeat.name}\'s passkey
              </td>
            </tr>
          )}
          {bobClaim && bobSeat && (
            <tr>
              <td className="relationship-actor">
                {bobSeat.name}\'s Person Smart Agent
              </td>
              <td><code>{shortAddress(bobClaim.personAgent)}</code></td>
              <td>
                <RelationshipDot kind="passkey" />
                Custodian: {bobSeat.name}\'s passkey
              </td>
            </tr>
          )}
          {org && (
            <tr>
              <td className="relationship-actor">
                {orgConfig.name}{' '}
                <span className="muted small">(Org Smart Agent)</span>
              </td>
              <td><code>{shortAddress(org.address)}</code></td>
              <td>
                <RelationshipDot kind={probe.aliceCustodianOfOrg ? 'live' : probe.loaded ? 'no' : 'pending'} />
                Custodian: {aliceSeat?.name}\'s PSA{' '}
                {probe.aliceCustodianOfOrg ? '✓' : probe.loaded ? '✗' : '…'}
                {' · '}
                <RelationshipDot kind={probe.bobCustodianOfOrg ? 'live' : probe.loaded ? 'no' : 'pending'} />
                Custodian: {bobSeat?.name}\'s PSA{' '}
                {probe.bobCustodianOfOrg ? '✓' : probe.loaded ? '✗' : '…'}
              </td>
            </tr>
          )}
          {treasury && (
            <tr>
              <td className="relationship-actor">
                Acme Treasury{' '}
                <span className="muted small">(Service Smart Agent)</span>
              </td>
              <td><code>{shortAddress(treasury.address)}</code></td>
              <td>
                <RelationshipDot kind={probe.orgCustodianOfTreasury ? 'live' : probe.loaded ? 'no' : 'pending'} />
                Custodian: {orgConfig.name}{' '}
                {probe.orgCustodianOfTreasury ? '✓' : probe.loaded ? '✗' : '…'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="muted small">
        Per spec 212 / 213: a <strong>custodian</strong> is whichever entity holds custody
        authority over a Smart Agent. For Person Smart Agents that\'s a <em>passkey</em>
        (a key, not an agent). For higher-tier Smart Agents the custodian is itself a
        <em> Smart Agent</em> — Person Smart Agents are custodians of {orgConfig.name},
        and {orgConfig.name} is the custodian of the Treasury. Authority chains agent →
        agent → agent; users never appear in the chain.
      </p>
    </section>
  );
}

function RelationshipDot({ kind }: { kind: 'live' | 'no' | 'pending' | 'passkey' }) {
  const cls =
    kind === 'live'
      ? 'rel-dot rel-dot--live'
      : kind === 'no'
        ? 'rel-dot rel-dot--no'
        : kind === 'pending'
          ? 'rel-dot rel-dot--pending'
          : 'rel-dot rel-dot--key';
  return <span className={cls} aria-hidden />;
}
