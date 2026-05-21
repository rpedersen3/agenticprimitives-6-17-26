/**
 * Top-bar "Acting as Alice ▼" chip. Lets the visitor switch between
 * claimed seats. Spec 211 § 4: "the switcher lets the visitor play
 * Alice + Bob in turn."
 */

import { useState } from 'react';
import { orgConfig, type SeatDef } from '../../org-config';
import type { SeatClaim } from '../../lib/seats';
import { setActiveSeat } from '../../lib/seats';

type SeatDefLike = SeatDef;

export function PrincipalChip({
  activeSeatId,
  seats,
}: {
  activeSeatId: string | null;
  seats: Record<string, SeatClaim>;
}) {
  const [open, setOpen] = useState(false);

  const claimedSeats = orgConfig.seats.filter((s) => seats[s.id]);
  if (claimedSeats.length === 0) return null;

  const activeSeat: SeatDefLike =
    orgConfig.seats.find((s) => s.id === activeSeatId) ?? claimedSeats[0]!;

  return (
    <div className="principal-chip">
      <button
        type="button"
        className="principal-chip__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="principal-chip-trigger"
      >
        <span className="muted">Acting as</span>{' '}
        <strong>{activeSeat.name}</strong>
        <span className="chevron" aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <ul className="principal-chip__menu" role="listbox">
          {claimedSeats.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={s.id === activeSeat.id ? 'is-active' : ''}
                onClick={() => {
                  setActiveSeat(s.id);
                  setOpen(false);
                }}
                role="option"
                aria-selected={s.id === activeSeat.id}
                data-testid={`principal-chip-option-${s.id}`}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
