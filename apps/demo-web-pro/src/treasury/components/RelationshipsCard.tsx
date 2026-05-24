/**
 * RelationshipsCard — live on-chain custody-graph readout. Renders one
 * row per smart agent (Alice.PSA, Bob.PSA, Org, Treasury); within each
 * row, one inline check per *enrolled identity* (passkey PIA, wallet
 * EOA) the relevant seat has authenticated with. So a "both methods"
 * seat shows two custody checks per target account.
 */

import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { orgConfig } from '../../org-config';
import {
  getIdentities,
  getPasskeyAuth,
  getSiweAuth,
  type SeatClaim,
} from '../../lib/seats';
import type { OrgRecord, TreasuryRecord } from '../../lib/demo-state';
import { readApprovalsRequired, readIsCustodian } from '../../lib/chain-reads';
import { shortAddress } from '../../components';
import { config } from '../../config';
import { NameDisplay } from './NameDisplay';
import { AgentDetailModal, type AgentDetailKind } from './AgentDetailModal';
import { getCachedName } from '../../lib/name-cache';

/**
 * Compact clickable header for an agent — opens the AgentDetailModal
 * with the canonical SA address, naming-service truth, control
 * credentials, and profile. Used wherever the UI renders a friendly
 * label like "Alice", "Acme Construction", or "Treasury".
 */
function AgentHeaderButton({
  label,
  sublabel,
  onClick,
}: {
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open agent detail"
      style={{
        background: 'transparent',
        border: 'none',
        padding: '2px 4px',
        margin: '-2px -4px',
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
        color: '#1d4ed8',
        textDecoration: 'underline',
        textDecorationStyle: 'dotted',
        textUnderlineOffset: 2,
      }}
    >
      {label}
      {sublabel ? <span style={{ marginLeft: 6 }}>{sublabel}</span> : null}
    </button>
  );
}

type CheckMap = Map<string, boolean>;

function checkKey(account: Address, identity: Address): string {
  return `${account.toLowerCase()}|${identity.toLowerCase()}`;
}

interface Probe {
  loaded: boolean;
  checks: CheckMap;
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
    checks: new Map(),
    orgT4Approvals: null,
    treasuryT4Approvals: null,
  });
  const [detail, setDetail] = useState<{
    address: Address;
    label: string;
    kind: AgentDetailKind;
    seatId?: string;
  } | null>(null);

  const aliceSeat = orgConfig.seats[0];
  const bobSeat = orgConfig.seats[1];
  const aliceClaim = aliceSeat ? seats[aliceSeat.id] : undefined;
  const bobClaim = bobSeat ? seats[bobSeat.id] : undefined;

  useEffect(() => {
    const run = async () => {
      const checks: CheckMap = new Map();

      // For each (seat, target_account) pair, check whether each
      // identity of the seat is a custodian on the target. Targets:
      // the seat's own PSA, the Org, and the Treasury (when those exist).
      const pairs: Array<{ seat: SeatClaim; target: Address }> = [];
      if (aliceClaim) pairs.push({ seat: aliceClaim, target: aliceClaim.personAgent });
      if (bobClaim) pairs.push({ seat: bobClaim, target: bobClaim.personAgent });
      if (aliceClaim && org) pairs.push({ seat: aliceClaim, target: org.address });
      if (bobClaim && org) pairs.push({ seat: bobClaim, target: org.address });
      if (aliceClaim && treasury) pairs.push({ seat: aliceClaim, target: treasury.address });
      if (bobClaim && treasury) pairs.push({ seat: bobClaim, target: treasury.address });

      for (const { seat, target } of pairs) {
        for (const id of getIdentities(seat)) {
          try {
            const isCust = await readIsCustodian({ account: target, signer: id });
            checks.set(checkKey(target, id), isCust);
          } catch {
            // tolerate flake — leave undefined, next tick refreshes
          }
        }
      }

      let orgT4Approvals: number | null = null;
      let treasuryT4Approvals: number | null = null;
      if (config.custodyPolicy && org) {
        try {
          orgT4Approvals = await readApprovalsRequired({
            custodyPolicy: config.custodyPolicy,
            account: org.address,
            tier: 4,
          });
        } catch { /* tolerate */ }
      }
      if (config.custodyPolicy && treasury) {
        try {
          treasuryT4Approvals = await readApprovalsRequired({
            custodyPolicy: config.custodyPolicy,
            account: treasury.address,
            tier: 4,
          });
        } catch { /* tolerate */ }
      }

      setProbe({ loaded: true, checks, orgT4Approvals, treasuryT4Approvals });
    };
    void run();
  }, [seats, org?.address, treasury?.address, aliceClaim?.personAgent, bobClaim?.personAgent]);

  if (!aliceClaim && !bobClaim && !org && !treasury) return null;

  const verdictMark = (v: boolean | undefined) =>
    v === true ? '✓' : v === false ? '✗' : '…';
  const verdictColor = (v: boolean | undefined) =>
    v === true ? '#196e2a' : v === false ? '#b6471f' : '#888';

  /**
   * Render every identity of a seat as inline labeled checks against a
   * target account. Each identity gets its own `kind: passkey|wallet`
   * label, short address, and ✓/✗/… mark. Used by every row in the
   * relationships table.
   */
  const renderCustodyLine = (seat: SeatClaim, target: Address) => {
    const passkey = getPasskeyAuth(seat);
    const siwe = getSiweAuth(seat);
    const parts: JSX.Element[] = [];
    if (passkey) {
      const v = probe.checks.get(checkKey(target, passkey.pia));
      parts.push(
        <span key="passkey" style={{ color: verdictColor(v) }}>
          passkey <code title={passkey.pia}>{shortAddress(passkey.pia)}</code> {verdictMark(v)}
        </span>,
      );
    }
    if (siwe) {
      const v = probe.checks.get(checkKey(target, siwe.eoa));
      parts.push(
        <span key="siwe" style={{ color: verdictColor(v) }}>
          wallet <code title={siwe.eoa}>{shortAddress(siwe.eoa)}</code> {verdictMark(v)}
        </span>,
      );
    }
    if (parts.length === 0) {
      return <span className="muted small">no identities enrolled</span>;
    }
    return (
      <span>
        {parts.flatMap((el, i) =>
          i === 0 ? [el] : [<span key={`sep-${i}`} className="muted">{' · '}</span>, el],
        )}
      </span>
    );
  };

  return (
    <section className="relationships-card" data-testid="relationships-card">
      <p className="eyebrow">On-chain state · live read</p>
      <h3>Custody graph</h3>

      <table className="relationships-table">
        <thead>
          <tr>
            <th>Smart Agent</th>
            <th>Address</th>
            <th>Custody (enrolled identities)</th>
          </tr>
        </thead>
        <tbody>
          {aliceClaim && aliceSeat && (
            <tr>
              <td className="relationship-actor">
                <AgentHeaderButton
                  label={`${aliceSeat.name}'s Person Smart Agent`}
                  onClick={() =>
                    setDetail({
                      address: aliceClaim.personAgent,
                      label: aliceSeat.name,
                      kind: 'person',
                      seatId: aliceSeat.id,
                    })
                  }
                />
              </td>
              <td><code><NameDisplay address={aliceClaim.personAgent} /></code></td>
              <td>{renderCustodyLine(aliceClaim, aliceClaim.personAgent)}</td>
            </tr>
          )}
          {bobClaim && bobSeat && (
            <tr>
              <td className="relationship-actor">
                <AgentHeaderButton
                  label={`${bobSeat.name}'s Person Smart Agent`}
                  onClick={() =>
                    setDetail({
                      address: bobClaim.personAgent,
                      label: bobSeat.name,
                      kind: 'person',
                      seatId: bobSeat.id,
                    })
                  }
                />
              </td>
              <td><code><NameDisplay address={bobClaim.personAgent} /></code></td>
              <td>{renderCustodyLine(bobClaim, bobClaim.personAgent)}</td>
            </tr>
          )}
          {org && (
            <tr>
              <td className="relationship-actor">
                <AgentHeaderButton
                  label={orgConfig.name}
                  sublabel={<span className="muted small">(Org Smart Agent)</span>}
                  onClick={() =>
                    setDetail({
                      address: org.address,
                      label: orgConfig.name,
                      kind: 'org',
                    })
                  }
                />
              </td>
              <td><code><NameDisplay address={org.address} /></code></td>
              <td>
                {aliceClaim && (
                  <span>
                    <span className="muted small">{aliceSeat?.name}:</span>{' '}
                    {renderCustodyLine(aliceClaim, org.address)}
                  </span>
                )}
                {aliceClaim && bobClaim && <span className="muted">{' | '}</span>}
                {bobClaim && (
                  <span>
                    <span className="muted small">{bobSeat?.name}:</span>{' '}
                    {renderCustodyLine(bobClaim, org.address)}
                  </span>
                )}
                {probe.orgT4Approvals !== null && (
                  <span className="muted small" style={{ marginLeft: 10 }}>
                    · T4 quorum {probe.orgT4Approvals}
                  </span>
                )}
              </td>
            </tr>
          )}
          {treasury && (
            <tr>
              <td className="relationship-actor">
                <AgentHeaderButton
                  label={getCachedName(treasury.address) ?? 'Treasury'}
                  sublabel={<span className="muted small">(Service Smart Agent)</span>}
                  onClick={() =>
                    setDetail({
                      address: treasury.address,
                      label: getCachedName(treasury.address) ?? 'Treasury',
                      kind: 'treasury',
                    })
                  }
                />
              </td>
              <td><code><NameDisplay address={treasury.address} /></code></td>
              <td>
                {aliceClaim && (
                  <span>
                    <span className="muted small">{aliceSeat?.name}:</span>{' '}
                    {renderCustodyLine(aliceClaim, treasury.address)}
                  </span>
                )}
                {aliceClaim && bobClaim && <span className="muted">{' | '}</span>}
                {bobClaim && (
                  <span>
                    <span className="muted small">{bobSeat?.name}:</span>{' '}
                    {renderCustodyLine(bobClaim, treasury.address)}
                  </span>
                )}
                {probe.treasuryT4Approvals !== null && (
                  <span className="muted small" style={{ marginLeft: 10 }}>
                    · T4 quorum {probe.treasuryT4Approvals}
                  </span>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="muted small">
        Per spec 212 / 213: custody bottoms out at <strong>passkey identities</strong>
        (PIAs derived from each user\'s P-256 pubkey) and <strong>wallet EOAs</strong>.
        Smart agents — Org and Treasury — are NEVER each other\'s custodians; that\'s
        forbidden at the contract level via the ERC-165 marker check in addCustodian.
        Inter-agent authority is modeled separately as stewardship / delegation.
      </p>
      <p className="muted small" style={{ marginTop: 4 }}>
        Click any agent label to see its canonical identifier, naming-service
        state, control credentials, and profile.
      </p>

      <AgentDetailModal
        open={detail !== null}
        onClose={() => setDetail(null)}
        address={detail?.address}
        label={detail?.label ?? ''}
        kind={detail?.kind ?? 'person'}
        seatId={detail?.seatId}
      />
    </section>
  );
}
