/**
 * DisconnectMenu — top-bar dropdown that lets the visitor:
 *   - Disconnect the current seat (release just this seat\'s passkey)
 *   - Reset the demo entirely (release ALL seats + passkeys; back to a
 *     clean seat picker)
 *
 * Both options are "local-only" — the deployed Smart Agents stay on
 * Base Sepolia. Releasing a seat just forgets the local mapping
 * (passkey credential + seat → account address). After a reset, the
 * next visitor (or the same one) re-claims seats by enrolling new
 * passkeys, which deploy NEW Smart Agents.
 *
 * Honesty: the explainer text spells out that on-chain state is not
 * affected — matches spec 211 § 9 live/simulated discipline.
 */

import { useEffect, useRef, useState } from 'react';
import { orgConfig } from '../../org-config';
import {
  releaseSeat,
  loadSeats,
  clearActiveSeat,
  type SeatClaim,
} from '../../lib/seats';
import { clearPasskeyForSeat } from '../../lib/passkey';
import { clearDemoState } from '../../lib/demo-state';
import { clearAllCachedNames } from '../../lib/name-cache';
import { clearDelegations } from '../../lib/delegations';

export function DisconnectMenu({
  activeSeatId,
  seats,
}: {
  activeSeatId: string | null;
  seats: Record<string, SeatClaim>;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<'reset' | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirm(null);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const claimedCount = Object.keys(seats).length;
  if (claimedCount === 0) return null;

  const activeSeat = activeSeatId ? orgConfig.seats.find((s) => s.id === activeSeatId) : null;

  const onDisconnectActive = () => {
    if (!activeSeat) return;
    clearPasskeyForSeat(activeSeat.id);
    releaseSeat(activeSeat.id);
    setOpen(false);
    setConfirm(null);
    window.location.hash = '';
  };

  const onResetAll = () => {
    // Wipe every per-seat passkey first.
    for (const seat of orgConfig.seats) {
      if (seats[seat.id]) {
        clearPasskeyForSeat(seat.id);
        releaseSeat(seat.id);
      }
    }
    clearActiveSeat();
    clearDemoState();         // org + treasury records
    clearAllCachedNames();    // address → .agent name cache
    clearDelegations();       // act-5 delegation envelopes
    // Defensive nuke: any other key under our prefix that we might
    // have missed. Demo state lives entirely under this namespace, so
    // wiping the whole prefix is correct + future-proof for any new
    // storage added later.
    try {
      const prefix = 'agenticprimitives:demo-web-pro:';
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) localStorage.removeItem(k);
      }
    } catch {}
    setOpen(false);
    setConfirm(null);
    // Hard reload guarantees React state + react-query cache + wagmi
    // connector state all reset to a clean boot. Without this, the
    // next claim flow can pick up stale runtime objects (wagmi's
    // connector cache especially) even though localStorage is empty.
    window.location.href = '/';
  };

  return (
    <div className="disconnect-menu" ref={ref}>
      <button
        type="button"
        className="disconnect-menu__trigger"
        onClick={() => {
          setOpen((v) => !v);
          setConfirm(null);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="disconnect-menu-trigger"
        title="Disconnect or reset demo"
      >
        ⋯
      </button>
      {open && (
        <div className="disconnect-menu__panel" role="menu">
          {confirm === null && (
            <>
              {activeSeat && (
                <button
                  type="button"
                  role="menuitem"
                  className="disconnect-menu__item"
                  onClick={onDisconnectActive}
                  data-testid="disconnect-active"
                >
                  <strong>Disconnect {activeSeat.name}</strong>
                  <span className="muted small">
                    Forgets {activeSeat.name}\'s passkey and seat claim on this device. The
                    deployed Smart Agent on Base Sepolia is unaffected.
                  </span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="disconnect-menu__item disconnect-menu__item--danger"
                onClick={() => setConfirm('reset')}
                data-testid="disconnect-reset"
              >
                <strong>Reset demo</strong>
                <span className="muted small">
                  Release all {claimedCount} seat{claimedCount > 1 ? 's' : ''}. Useful to
                  walk a second person through the demo from scratch.
                </span>
              </button>
            </>
          )}
          {confirm === 'reset' && (
            <div className="disconnect-menu__confirm">
              <p>
                <strong>Reset the demo?</strong> All {claimedCount} seat
                {claimedCount > 1 ? 's' : ''} will be released. You\'ll go back to the seat
                picker.
              </p>
              <p className="muted small">
                On-chain state stays. The deployed Smart Agents are still live on Base
                Sepolia — they just become unreachable from this browser.
              </p>
              <div className="disconnect-menu__confirm-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setConfirm(null)}
                  data-testid="disconnect-reset-cancel"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary danger"
                  onClick={onResetAll}
                  data-testid="disconnect-reset-confirm"
                >
                  Yes, reset
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
