/**
 * Top-bar "Acting as Alice ▼" chip. Lets the visitor switch between
 * claimed seats. Spec 211 § 4: "the switcher lets the visitor play
 * Alice + Bob in turn." When opened, the dropdown shows every seat
 * with its Smart Agent address and enrolled identities (PIA, EOA).
 */

import { useEffect, useRef, useState } from 'react';
import { orgConfig, type SeatDef } from '../../org-config';
import { setActiveSeat, getPasskeyAuth, getSiweAuth, type SeatClaim } from '../../lib/seats';
import { shortAddress } from '../../components';

type SeatDefLike = SeatDef;

export function PrincipalChip({
  activeSeatId,
  seats,
}: {
  activeSeatId: string | null;
  seats: Record<string, SeatClaim>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on click-outside.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const claimedSeats = orgConfig.seats.filter((s) => seats[s.id]);
  if (claimedSeats.length === 0) return null;

  const activeSeat: SeatDefLike =
    orgConfig.seats.find((s) => s.id === activeSeatId) ?? claimedSeats[0]!;

  return (
    <div className="principal-chip" ref={rootRef}>
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
        <div
          className="principal-chip__menu"
          role="listbox"
          style={{
            // Restate width here so the richer rows fit; class still
            // controls position + chrome.
            minWidth: 320,
          }}
        >
          {claimedSeats.map((s) => {
            const claim = seats[s.id]!;
            const passkey = getPasskeyAuth(claim);
            const siwe = getSiweAuth(claim);
            const isActive = s.id === activeSeat.id;
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={isActive ? 'is-active' : ''}
                onClick={() => {
                  setActiveSeat(s.id);
                  setOpen(false);
                }}
                data-testid={`principal-chip-option-${s.id}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 4,
                  padding: '8px 12px',
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <strong>{s.name}</strong>
                  {isActive && <span className="muted small">· active</span>}
                </span>
                <span className="muted small" style={{ fontSize: '0.72rem' }}>
                  Smart Agent <code>{shortAddress(claim.personAgent)}</code>
                </span>
                {passkey && (
                  <span className="muted small" style={{ fontSize: '0.72rem' }}>
                    Passkey PIA <code title={passkey.pia}>{shortAddress(passkey.pia)}</code>
                  </span>
                )}
                {siwe && (
                  <span className="muted small" style={{ fontSize: '0.72rem' }}>
                    Wallet EOA <code title={siwe.eoa}>{shortAddress(siwe.eoa)}</code>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
