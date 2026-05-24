/**
 * ActorCard — renders one person (Alice / Bob): seat name, passkey
 * status, deployed Person Smart Agent address. Used in the seat
 * picker (open vs claimed) and the top bar (current "acting as" actor).
 */

import { useState } from 'react';
import type { SeatDef } from '../../org-config';
import { getPasskeyAuth, getSiweAuth, type SeatClaim } from '../../lib/seats';
import { getPasskeyForSeat } from '../../lib/passkey';
import { shortAddress } from '../../components';
import { NameDisplay } from './NameDisplay';
import { AgentDetailModal } from './AgentDetailModal';

export function ActorCard({
  seat,
  claim,
  variant = 'pickable',
  onClick,
  active,
}: {
  seat: SeatDef;
  claim: SeatClaim | null;
  variant?: 'pickable' | 'compact';
  onClick?: () => void;
  active?: boolean;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const claimed = !!claim;
  const className = [
    'actor-card',
    `actor-card--${variant}`,
    claimed && 'actor-card--claimed',
    !claimed && 'actor-card--open',
    active && 'actor-card--active',
  ]
    .filter(Boolean)
    .join(' ');

  // If the consumer provided an onClick we honour it (e.g., "switch
  // acting-as" in the topbar). Otherwise: claimed seats open the
  // detail modal on click; empty seats stay inert.
  const handleClick = onClick ?? (claim ? () => setDetailOpen(true) : undefined);

  const content = (
    <>
      <div className="actor-card-header">
        <span className="actor-name">{seat.name}</span>
        <span className={`actor-status-pill ${claimed ? 'claimed' : 'open'}`}>
          {claimed ? '✓ claimed' : 'open'}
        </span>
      </div>
      {claim ? (
        <ClaimedBody claim={claim} />
      ) : (
        <div className="actor-card-body">
          <p className="muted">Seat is empty.</p>
          <p className="muted small">Click to claim with a passkey.</p>
        </div>
      )}
      {claim && (
        <p className="muted small" style={{ marginTop: 6 }}>
          ↳ click to view canonical id, name &amp; profile
        </p>
      )}
      <AgentDetailModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        address={claim?.personAgent}
        label={seat.name}
        kind="person"
        seatId={seat.id}
      />
    </>
  );

  // Helper component below.

  if (variant === 'compact') {
    return (
      <div className={className} onClick={handleClick} role={handleClick ? 'button' : undefined}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={!handleClick}
      data-testid={`seat-picker-${seat.id}`}
    >
      {content}
    </button>
  );
}

function ClaimedBody({ claim }: { claim: SeatClaim }) {
  const passkey = getPasskeyAuth(claim);
  const siwe = getSiweAuth(claim);
  // Look up the local passkey mirror to surface the WebAuthn-level
  // name (set in `registerPasskeyForSeat` via `user.name`). Per
  // ADR-0010 the credential is a facet pointing AT the SA; the
  // credential's stored `agentName` is the same `.agent` label the
  // SA's primary name resolves to.
  const passkeyMirror = passkey ? getPasskeyForSeat(claim.seatId) : null;
  const passkeyAgentName = passkeyMirror?.agentName;
  return (
    <div className="actor-card-body">
      <p className="muted">Canonical Smart Agent</p>
      <code title={claim.personAgent}><NameDisplay address={claim.personAgent} bold /></code>
      <p className="muted small" style={{ marginTop: 2 }}>
        {shortAddress(claim.personAgent)}
      </p>
      {passkey && (
        <>
          <p className="muted" style={{ marginTop: 6 }}>Passkey credential (custodian)</p>
          {passkeyAgentName ? (
            <code title={passkey.pia}><strong>{passkeyAgentName}</strong></code>
          ) : (
            <code title={passkey.pia}>{shortAddress(passkey.pia)}</code>
          )}
          <p className="muted small" style={{ marginTop: 2 }}>
            PIA: {shortAddress(passkey.pia)}
          </p>
        </>
      )}
      {siwe && (
        <>
          <p className="muted" style={{ marginTop: 6 }}>Wallet (SIWE) custodian</p>
          <code title={siwe.eoa}>{shortAddress(siwe.eoa)}</code>
        </>
      )}
      <p className="muted small">
        {passkey && siwe ? 'Passkey + wallet enrolled' : passkey ? 'Passkey enrolled' : 'Wallet enrolled'}
        {' · live on Base Sepolia'}
      </p>
    </div>
  );
}
