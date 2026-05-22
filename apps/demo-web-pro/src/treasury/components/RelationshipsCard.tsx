/**
 * RelationshipsCard — verifies on chain who controls what, so the
 * visitor can confirm the demo state matches the spec\'s
 * agent-centric picture (spec 211 § 3 / spec 212 / spec 213).
 *
 * Phase 6f.4 pivot: custody bottoms out at the PASSKEY IDENTITY
 * (PIA) of each human. Smart agents (Org, Treasury) NEVER appear in
 * each other\'s custodian sets — the ERC-165 marker on AgentAccount
 * forbids it. Person.PSA, Org, and Treasury all use PIA-as-custodian.
 *
 * Reads (all public-RPC, no signing):
 *   - Each Person.PSA   → isCustodian(seat.personIdentity)
 *   - Org               → isCustodian(alicePIA), isCustodian(bobPIA)
 *   - Treasury          → isCustodian(alicePIA), isCustodian(bobPIA)
 */

import { useEffect, useState } from 'react';
import { orgConfig } from '../../org-config';
import type { SeatClaim } from '../../lib/seats';
import type { OrgRecord, TreasuryRecord } from '../../lib/demo-state';
import { readApprovalsRequired, readIsCustodian } from '../../lib/chain-reads';
import { shortAddress } from '../../components';
import { config } from '../../config';

interface Probe {
  loaded: boolean;
  aliceCustodianOfAlicePSA: boolean | null;
  bobCustodianOfBobPSA: boolean | null;
  aliceCustodianOfOrg: boolean | null;
  bobCustodianOfOrg: boolean | null;
  aliceCustodianOfTreasury: boolean | null;
  bobCustodianOfTreasury: boolean | null;
  orgT4Approvals: number | null;
  treasuryT4Approvals: number | null;
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
    aliceCustodianOfAlicePSA: null,
    bobCustodianOfBobPSA: null,
    aliceCustodianOfOrg: null,
    bobCustodianOfOrg: null,
    aliceCustodianOfTreasury: null,
    bobCustodianOfTreasury: null,
    orgT4Approvals: null,
    treasuryT4Approvals: null,
  });

  const aliceSeat = orgConfig.seats[0];
  const bobSeat = orgConfig.seats[1];
  const aliceClaim = aliceSeat ? seats[aliceSeat.id] : undefined;
  const bobClaim = bobSeat ? seats[bobSeat.id] : undefined;

  useEffect(() => {
    const run = async () => {
      const result: Probe = {
        loaded: true,
        aliceCustodianOfAlicePSA: null,
        bobCustodianOfBobPSA: null,
        aliceCustodianOfOrg: null,
        bobCustodianOfOrg: null,
        aliceCustodianOfTreasury: null,
        bobCustodianOfTreasury: null,
        orgT4Approvals: null,
        treasuryT4Approvals: null,
      };
      if (aliceClaim) {
        result.aliceCustodianOfAlicePSA = await readIsCustodian({
          account: aliceClaim.personAgent,
          signer: aliceClaim.personIdentity,
        });
      }
      if (bobClaim) {
        result.bobCustodianOfBobPSA = await readIsCustodian({
          account: bobClaim.personAgent,
          signer: bobClaim.personIdentity,
        });
      }
      if (org && aliceClaim) {
        result.aliceCustodianOfOrg = await readIsCustodian({
          account: org.address,
          signer: aliceClaim.personIdentity,
        });
      }
      if (org && bobClaim) {
        result.bobCustodianOfOrg = await readIsCustodian({
          account: org.address,
          signer: bobClaim.personIdentity,
        });
      }
      if (treasury && aliceClaim) {
        result.aliceCustodianOfTreasury = await readIsCustodian({
          account: treasury.address,
          signer: aliceClaim.personIdentity,
        });
      }
      if (treasury && bobClaim) {
        result.bobCustodianOfTreasury = await readIsCustodian({
          account: treasury.address,
          signer: bobClaim.personIdentity,
        });
      }
      if (config.custodyPolicy && org) {
        try {
          result.orgT4Approvals = await readApprovalsRequired({
            custodyPolicy: config.custodyPolicy,
            account: org.address,
            tier: 4,
          });
        } catch { /* tolerate */ }
      }
      if (config.custodyPolicy && treasury) {
        try {
          result.treasuryT4Approvals = await readApprovalsRequired({
            custodyPolicy: config.custodyPolicy,
            account: treasury.address,
            tier: 4,
          });
        } catch { /* tolerate */ }
      }
      setProbe(result);
    };
    void run();
  }, [
    seats,
    org?.address,
    treasury?.address,
    aliceClaim?.personAgent,
    aliceClaim?.personIdentity,
    bobClaim?.personAgent,
    bobClaim?.personIdentity,
  ]);

  if (!aliceClaim && !bobClaim && !org && !treasury) return null;

  const verdictDot = (v: boolean | null): 'live' | 'no' | 'pending' =>
    v === true ? 'live' : v === false ? 'no' : 'pending';
  const verdictMark = (v: boolean | null) =>
    v === true ? '✓' : v === false ? '✗' : '…';

  return (
    <section className="relationships-card" data-testid="relationships-card">
      <p className="eyebrow">On-chain state · live read</p>
      <h3>Custody graph</h3>

      <table className="relationships-table">
        <thead>
          <tr>
            <th>Smart Agent</th>
            <th>Address</th>
            <th>Custody (passkey identities)</th>
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
                <RelationshipDot kind={verdictDot(probe.aliceCustodianOfAlicePSA)} />
                {aliceSeat.name}\'s passkey identity{' '}
                <code title={aliceClaim.personIdentity}>{shortAddress(aliceClaim.personIdentity)}</code>{' '}
                {verdictMark(probe.aliceCustodianOfAlicePSA)}
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
                <RelationshipDot kind={verdictDot(probe.bobCustodianOfBobPSA)} />
                {bobSeat.name}\'s passkey identity{' '}
                <code title={bobClaim.personIdentity}>{shortAddress(bobClaim.personIdentity)}</code>{' '}
                {verdictMark(probe.bobCustodianOfBobPSA)}
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
                <RelationshipDot kind={verdictDot(probe.aliceCustodianOfOrg)} />
                {aliceSeat?.name}\'s passkey {verdictMark(probe.aliceCustodianOfOrg)}
                {bobClaim && (
                  <>
                    {' · '}
                    <RelationshipDot kind={verdictDot(probe.bobCustodianOfOrg)} />
                    {bobSeat?.name}\'s passkey {verdictMark(probe.bobCustodianOfOrg)}
                  </>
                )}
                {probe.orgT4Approvals !== null && (
                  <span className="muted small" style={{ marginLeft: 10 }}>
                    · T4 quorum {probe.orgT4Approvals}-of-{(probe.aliceCustodianOfOrg ? 1 : 0) + (probe.bobCustodianOfOrg ? 1 : 0)}
                  </span>
                )}
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
                <RelationshipDot kind={verdictDot(probe.aliceCustodianOfTreasury)} />
                {aliceSeat?.name}\'s passkey {verdictMark(probe.aliceCustodianOfTreasury)}
                {bobClaim && (
                  <>
                    {' · '}
                    <RelationshipDot kind={verdictDot(probe.bobCustodianOfTreasury)} />
                    {bobSeat?.name}\'s passkey {verdictMark(probe.bobCustodianOfTreasury)}
                  </>
                )}
                {probe.treasuryT4Approvals !== null && (
                  <span className="muted small" style={{ marginLeft: 10 }}>
                    · T4 quorum {probe.treasuryT4Approvals}-of-{(probe.aliceCustodianOfTreasury ? 1 : 0) + (probe.bobCustodianOfTreasury ? 1 : 0)}
                  </span>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="muted small">
        Per spec 212 / 213: custody bottoms out at <strong>passkey identities</strong>
        (PIAs derived from each user\'s P-256 pubkey). Smart agents — Org and Treasury —
        are NEVER each other\'s custodians; that\'s forbidden at the contract level via the
        ERC-165 marker check in <code>addCustodian</code>. Inter-agent authority is modeled
        separately as stewardship / delegation.
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
