/**
 * session-salt.ts — a per-demo-session random string mixed into every
 * CREATE2 salt computation across the act ladder.
 *
 * Why: previously Act 1 used a hardcoded `salt: '0'` and Act 2 / Act
 * 2.5 derived their salts from `(name, founderIdentity, versionTag)`.
 * All three were deterministic over the user's MetaMask EOA. After
 * `Reset demo → re-claim with the same EOA`, every CREATE2 address
 * was identical to the previous session — Alice's PSA already
 * had a primary `.agent` name, Acme Construction already had its
 * custodian set, Treasury was already deployed, etc. The user
 * couldn't actually "start over" without changing wallets.
 *
 * Fix: a session salt generated on first read, persisted to
 * localStorage so multiple page loads within the same demo session
 * reuse the same address space, then wiped by the Reset flow so the
 * next session gets fresh addresses across every Act.
 *
 * Pattern:
 *   - `getSessionSalt()` — lazy-init + cache + persist.
 *   - `clearSessionSalt()` — called by DisconnectMenu's `onResetAll`
 *     (also covered by the prefix-wide sweep, but explicit for
 *     clarity).
 *
 * The salt value itself is just a string — Act 1 passes it as the
 * CREATE2 salt directly; Acts 2 / 2.5 mix it into their SALT_VERSION
 * tag. The chain doesn't care about format.
 */

const STORAGE_KEY = 'agenticprimitives:demo-web-pro:session-salt';

function generate(): string {
  // Time-bucketed + random — collision-proof for one user across
  // hundreds of resets, and stable across in-session reloads.
  return `${Date.now()}-${Math.floor(Math.random() * 1e12).toString(16)}`;
}

export function getSessionSalt(): string {
  if (typeof localStorage === 'undefined') return generate();
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
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
