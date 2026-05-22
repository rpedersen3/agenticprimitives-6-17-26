/**
 * ActorCard — renders one person (Alice / Bob): seat name, passkey
 * status, deployed Person Smart Agent address. Used in the seat
 * picker (open vs claimed) and the top bar (current "acting as" actor).
 */

import type { SeatDef } from '../../org-config';
import type { SeatClaim } from '../../lib/seats';
import { shortAddress } from '../../components';

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

  const content = (
    <>
      <div className="actor-card-header">
        <span className="actor-name">{seat.name}</span>
        <span className={`actor-status-pill ${claimed ? 'claimed' : 'open'}`}>
          {claimed ? '✓ claimed' : 'open'}
        </span>
      </div>
      {claim ? (
        <div className="actor-card-body">
          <p className="muted">Person Smart Agent</p>
          <code>{shortAddress(claim.personAgent)}</code>
          {claim.personIdentity && (
            <>
              <p className="muted" style={{ marginTop: 6 }}>Passkey identity (custodian)</p>
              <code title={claim.personIdentity}>{shortAddress(claim.personIdentity)}</code>
            </>
          )}
          <p className="muted small">Passkey enrolled · live on Base Sepolia</p>
        </div>
      ) : (
        <div className="actor-card-body">
          <p className="muted">Seat is empty.</p>
          <p className="muted small">Click to claim with a passkey.</p>
        </div>
      )}
    </>
  );

  if (variant === 'compact') {
    return (
      <div className={className} onClick={onClick} role={onClick ? 'button' : undefined}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={claimed && !onClick}
      data-testid={`seat-picker-${seat.id}`}
    >
      {content}
    </button>
  );
}
