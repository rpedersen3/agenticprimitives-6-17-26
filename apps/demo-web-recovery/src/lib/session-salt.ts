/**
 * session-salt.ts — a per-demo-session random value mixed into every
 * CREATE2 salt so each fresh run deploys NEW Smart Agents (and the
 * forced-unique name walk hands out the next free label: sam → sam2 …).
 *
 * Ported from demo-web-pro. Without it, deploying with a fixed `salt:0`
 * makes the SA address deterministic over the credential — re-connecting
 * the SAME wallet (SIWE) re-derives the SAME address with its OLD name,
 * so the demo can't "start over". The salt is:
 *   - generated once per session, persisted to localStorage (stable
 *     across page reloads within a session so addresses don't drift),
 *   - wiped by the Reset flow (prefix-wide localStorage sweep) so the
 *     next session gets fresh addresses + fresh unique names.
 */

const STORAGE_KEY = 'agenticprimitives:demo-web-recovery:session-salt';

/**
 * Decimal-uint256 salt. The worker's /session/direct-deploy validator
 * requires a decimal-string uint256. Compose ms-epoch (high) with 64
 * random bits (low) — well inside uint256.
 */
function generate(): string {
  const high = BigInt(Date.now());
  const r1 = BigInt(Math.floor(Math.random() * 0x1_0000_0000));
  const r2 = BigInt(Math.floor(Math.random() * 0x1_0000_0000));
  const low = (r1 << 32n) | r2;
  return ((high << 64n) | low).toString(10);
}

export function getSessionSalt(): string {
  if (typeof localStorage === 'undefined') return generate();
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && /^\d+$/.test(existing)) return existing;
    const fresh = generate();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return generate();
  }
}

export function clearSessionSalt(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // unavailable storage — non-fatal
  }
}
