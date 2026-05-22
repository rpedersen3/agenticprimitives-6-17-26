/**
 * Seat state — which seats are claimed, what their deployed Person
 * Smart Agent address is, and who the visitor is "acting as" right now.
 *
 * Persisted in localStorage so a refresh / new-tab keeps the demo's
 * state across visits. This is intentionally demo-only — production
 * would model this server-side.
 */

import type { Address } from 'viem';

const STORAGE_KEY = 'agenticprimitives:demo-web-pro:seats';
const ACTIVE_SEAT_KEY = 'agenticprimitives:demo-web-pro:active-seat';

export interface SeatClaim {
  seatId: string;
  /**
   * Person Smart Agent address (the deployed AgentAccount). Used as
   * the userOp sender + gas-paying intermediary; NOT the human's
   * custody identity (that's `personIdentity` below).
   */
  personAgent: Address;
  /**
   * Person Smart Agent's PIA — the Passkey-Identity-Address derived
   * from the seat's passkey pubkey. Phase 6f.4 pivot: PIA is the
   * canonical custodian identity (registered as a custodian on
   * Person.PSA, Org, Treasury). All custody-action targets that
   * identify this human should use `personIdentity`, never
   * `personAgent`.
   */
  personIdentity: Address;
  /** keccak256 of the credentialId — the on-chain passkey index. */
  credentialIdDigest: `0x${string}`;
  /** ISO timestamp of when the seat was claimed. */
  claimedAt: string;
}

type SeatRecord = Record<string, SeatClaim>;

function readRecord(): SeatRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as SeatRecord;
  } catch {
    return {};
  }
}

function writeRecord(record: SeatRecord): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  // Notify same-tab listeners (storage event only fires across tabs).
  window.dispatchEvent(new Event('seats:update'));
}

export function loadSeats(): SeatRecord {
  return readRecord();
}

/**
 * Phase 6f.4 migration — back-fill `personIdentity` on pre-pivot
 * SeatClaim records that pre-date the field. `derivePia(seatId)` is
 * injected because `passkeyIdentity` lives in `@agenticprimitives/custody`
 * and the passkey storage lives in `lib/passkey.ts`; injection keeps
 * `seats.ts` free of cross-module coupling.
 *
 * Idempotent — only writes if at least one seat needed patching.
 */
export function migrateSeatsAddPersonIdentity(
  derivePia: (seatId: string) => Address | null,
): void {
  const record = readRecord();
  let changed = false;
  for (const [seatId, claim] of Object.entries(record)) {
    if (!(claim as Partial<SeatClaim>).personIdentity) {
      const pia = derivePia(seatId);
      if (pia) {
        record[seatId] = { ...claim, personIdentity: pia };
        changed = true;
      }
    }
  }
  if (changed) writeRecord(record);
}

export function getSeatClaim(seatId: string): SeatClaim | null {
  return readRecord()[seatId] ?? null;
}

export function claimSeat(claim: SeatClaim): void {
  const record = readRecord();
  record[claim.seatId] = claim;
  writeRecord(record);
}

export function releaseSeat(seatId: string): void {
  const record = readRecord();
  delete record[seatId];
  writeRecord(record);
  if (loadActiveSeat() === seatId) {
    clearActiveSeat();
  }
}

export function loadActiveSeat(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SEAT_KEY);
  } catch {
    return null;
  }
}

export function setActiveSeat(seatId: string): void {
  localStorage.setItem(ACTIVE_SEAT_KEY, seatId);
  window.dispatchEvent(new Event('seats:update'));
}

export function clearActiveSeat(): void {
  localStorage.removeItem(ACTIVE_SEAT_KEY);
  window.dispatchEvent(new Event('seats:update'));
}

/**
 * Subscribe to seat-state changes. Fires on both same-tab updates
 * (synthetic `seats:update` event) and cross-tab updates (browser
 * `storage` event for STORAGE_KEY / ACTIVE_SEAT_KEY).
 */
export function subscribeSeats(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === ACTIVE_SEAT_KEY) listener();
  };
  window.addEventListener('seats:update', listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('seats:update', listener);
    window.removeEventListener('storage', onStorage);
  };
}
