/**
 * Seat state — which seats are claimed, what their deployed Person
 * Smart Agent address is, and who the visitor is "acting as" right now.
 *
 * Persisted in localStorage so a refresh / new-tab keeps the demo's
 * state across visits. This is intentionally demo-only — production
 * would model this server-side.
 *
 * Phase 6f.4 extension: each seat carries a polymorphic `authMethods`
 * list — every method is one human signer authority bound to this
 * seat. Mix freely:
 *   - passkey only
 *   - SIWE only (a connected EOA wallet)
 *   - both (passkey + EOA — registered as TWO custodians on chain)
 */

import type { Address, Hex } from 'viem';

const STORAGE_KEY = 'agenticprimitives:demo-web-recovery:seats';
const ACTIVE_SEAT_KEY = 'agenticprimitives:demo-web-recovery:active-seat';

export type PasskeyAuth = {
  kind: 'passkey';
  /** keccak256(credentialId) — local-storage key into DemoPasskey + on-chain passkey storage. */
  credentialIdDigest: Hex;
  /** P-256 public key X — needed to pack v=2 quorum slots without round-tripping passkey.ts. */
  pubKeyX: bigint;
  /** P-256 public key Y. */
  pubKeyY: bigint;
  /** Passkey-Identity-Address = keccak256(abi.encode(x, y)) cast to address. Custodian identity. */
  pia: Address;
};

export type SiweAuth = {
  kind: 'siwe';
  /** The wallet EOA. Custodian identity. */
  eoa: Address;
};

export type AuthMethod = PasskeyAuth | SiweAuth;

export interface SeatClaim {
  seatId: string;
  /** Person Smart Agent address (CREATE2-deterministic from the chosen auth methods + salt). */
  personAgent: Address;
  /** Non-empty list of human-signer authorities for this seat. */
  authMethods: AuthMethod[];
  /** ISO timestamp of when the seat was claimed. */
  claimedAt: string;
}

// ─── Auth-method accessors ───────────────────────────────────────────

export function getPasskeyAuth(seat: SeatClaim): PasskeyAuth | undefined {
  return seat.authMethods.find((m): m is PasskeyAuth => m.kind === 'passkey');
}

export function getSiweAuth(seat: SeatClaim): SiweAuth | undefined {
  return seat.authMethods.find((m): m is SiweAuth => m.kind === 'siwe');
}

/**
 * Convenience: every custodian identity registered for this seat. The
 * Org / Treasury custody set should include every one of these
 * (since the operator chose "register both" at seat-claim time when
 * both methods were enrolled).
 */
export function getIdentities(seat: SeatClaim): Address[] {
  return seat.authMethods.map((m) => (m.kind === 'passkey' ? m.pia : m.eoa));
}

/**
 * Which method should sign quorum slots for admin actions? Passkey
 * preferred (gasless, no wallet popup); SIWE only if no passkey.
 * Matches the locked-in 2026-05-22 product decision.
 */
export function getSigningMethod(seat: SeatClaim): AuthMethod | undefined {
  return getPasskeyAuth(seat) ?? getSiweAuth(seat);
}

// ─── Store ───────────────────────────────────────────────────────────

type SeatRecord = Record<string, SeatClaim>;

// PasskeyAuth carries bigint pubKeyX/Y. JSON can't represent bigints
// natively, so we tag them on the way out and revive on the way in.
// Tag format: `{ __bigint: "<base10>" }` — chosen over plain strings so
// we never accidentally revive an address field as a bigint.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeBigInts(v: any): any {
  if (typeof v === 'bigint') return { __bigint: v.toString() };
  if (Array.isArray(v)) return v.map(serializeBigInts);
  if (v && typeof v === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = serializeBigInts(v[k]);
    return out;
  }
  return v;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reviveBigInts(v: any): any {
  if (v && typeof v === 'object') {
    if (typeof v.__bigint === 'string' && Object.keys(v).length === 1) {
      return BigInt(v.__bigint);
    }
    if (Array.isArray(v)) return v.map(reviveBigInts);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = reviveBigInts(v[k]);
    return out;
  }
  return v;
}

function readRecord(): SeatRecord {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return reviveBigInts(parsed) as SeatRecord;
  } catch {
    return {};
  }
}

function writeRecord(record: SeatRecord): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeBigInts(record)));
  // Notify same-tab listeners (storage event only fires across tabs).
  window.dispatchEvent(new Event('seats:update'));
}

export function loadSeats(): SeatRecord {
  return readRecord();
}

/**
 * Phase 6f.4 migration — back-fill `authMethods` on pre-pivot SeatClaim
 * records. Pre-pivot records had `personIdentity` + `credentialIdDigest`
 * flat fields; we look up the seat's local passkey for its pubKey, then
 * synthesise a PasskeyAuth method so existing claims survive the bundle
 * upgrade.
 */
export function migrateSeatsToAuthMethods(
  lookupPasskey: (seatId: string) => { credentialIdDigest: Hex; pubKeyX: bigint; pubKeyY: bigint } | null,
): void {
  const record = readRecord();
  let changed = false;
  for (const [seatId, claim] of Object.entries(record)) {
    const c = claim as Partial<SeatClaim> & {
      personIdentity?: Address;
      credentialIdDigest?: Hex;
    };
    if (Array.isArray(c.authMethods) && c.authMethods.length > 0) continue;
    const pk = lookupPasskey(seatId);
    if (!pk) continue;
    const pia = c.personIdentity ?? deriveLegacyPia(pk.pubKeyX, pk.pubKeyY);
    const migrated: SeatClaim = {
      seatId: c.seatId ?? seatId,
      personAgent: c.personAgent!,
      claimedAt: c.claimedAt ?? new Date().toISOString(),
      authMethods: [
        {
          kind: 'passkey',
          credentialIdDigest: pk.credentialIdDigest,
          pubKeyX: pk.pubKeyX,
          pubKeyY: pk.pubKeyY,
          pia,
        },
      ],
    };
    record[seatId] = migrated;
    changed = true;
  }
  if (changed) writeRecord(record);
}

// Replicated locally to avoid cross-package import cycle just for migration.
function deriveLegacyPia(x: bigint, y: bigint): Address {
  // Mirror `passkeyIdentity` from @agenticprimitives/account-custody. Kept inline
  // so this migration helper can run before the package is initialised.
  // The shape is: address(uint160(uint256(keccak256(abi.encode(x, y))))).
  // We can't compute keccak here without a hashing lib, so callers MUST
  // pass through `c.personIdentity` (which is already the on-chain PIA)
  // — this fallback only fires for the impossible case where the legacy
  // record has the passkey storage entry but no `personIdentity` field,
  // which never happens with records written by current code.
  void x; void y;
  throw new Error('migrateSeatsToAuthMethods: legacy record missing personIdentity');
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
