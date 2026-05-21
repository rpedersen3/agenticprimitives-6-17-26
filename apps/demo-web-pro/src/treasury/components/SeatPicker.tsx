/**
 * Seat picker — first screen for a fresh visitor (spec 211 § 4).
 *
 * Lists each seat from org-config. Claimed seats are shown
 * inert-with-checkmark. Clicking an open seat starts the passkey
 * enrollment + Person Smart Agent deploy flow (Act 1) for that seat.
 */

import { orgConfig } from '../../org-config';
import type { SeatClaim } from '../../lib/seats';
import { ActorCard } from './ActorCard';

export function SeatPicker({
  seats,
  onPickSeat,
}: {
  seats: Record<string, SeatClaim>;
  onPickSeat: (seatId: string) => void;
}) {
  return (
    <section className="seat-picker" data-testid="seat-picker">
      <div className="hero">
        <p className="eyebrow">{orgConfig.name}</p>
        <h1>Pick a seat to begin.</h1>
        <p>{orgConfig.tagline}</p>
      </div>

      <div className="seat-picker__grid">
        {orgConfig.seats.map((seat) => (
          <ActorCard
            key={seat.id}
            seat={seat}
            claim={seats[seat.id] ?? null}
            variant="pickable"
            onClick={seats[seat.id] ? undefined : () => onPickSeat(seat.id)}
          />
        ))}
      </div>

      <p className="seat-picker__footnote muted">
        Both seats need passkeys for the treasury to activate. Each visit, you can claim
        a seat or switch to one you\'ve already claimed.
      </p>
    </section>
  );
}
