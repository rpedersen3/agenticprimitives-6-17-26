/**
 * Org-config — predefined org + seats the demo opens with.
 *
 * Spec 211 § 4: the demo loads a hard-coded Organization (Acme
 * Construction) with two named seats (Alice, Bob). Visitors claim seats
 * in turn; the org becomes operational once both seats are filled.
 *
 * Override at build time via VITE_ORG_* env vars; defaults are the
 * spec-defined Acme Construction shape so a fresh checkout demos
 * without configuration.
 */

export interface SeatDef {
  /** Stable seat id used as localStorage / passkey index key. */
  id: string;
  /** Display name (mutable cosmetic). */
  name: string;
}

export interface OrgConfig {
  name: string;
  tagline: string;
  seats: SeatDef[];
}

function parseSeatLabels(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const orgName = import.meta.env.VITE_ORG_NAME?.trim() || 'Acme Construction';
const tagline =
  import.meta.env.VITE_ORG_TAGLINE?.trim() || 'Shared treasury demo · two-admin org';
const seatLabels = parseSeatLabels(import.meta.env.VITE_ORG_SEAT_LABELS, ['Alice', 'Bob']);

export const orgConfig: OrgConfig = {
  name: orgName,
  tagline,
  seats: seatLabels.map((name) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
  })),
};
