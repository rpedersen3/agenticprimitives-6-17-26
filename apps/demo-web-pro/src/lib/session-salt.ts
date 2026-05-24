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

/**
 * Generate a decimal-uint256 salt. The worker's /session/direct-deploy
 * validator expects `salt` to be a decimal-string uint256 — anything
 * else (hyphens, hex, etc.) returns `bad_input`. We compose:
 *   high  = ms-since-epoch  (≈ 13 digits, fits in uint53)
 *   low   = 64-bit random
 *   salt  = (high << 64) | low — well inside uint256.
 */
function generate(): string {
  const high = BigInt(Date.now());
  // Math.random gives 53 bits; shift+combine to ~64 bits.
  const r1 = BigInt(Math.floor(Math.random() * 0x1_0000_0000));
  const r2 = BigInt(Math.floor(Math.random() * 0x1_0000_0000));
  const low = (r1 << 32n) | r2;
  return ((high << 64n) | low).toString(10);
}

export function getSessionSalt(): string {
  if (typeof localStorage === 'undefined') return generate();
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    // Guard: if any prior version stored a non-decimal salt
    // (e.g. v21's "1716...-a3f8") replace it so the worker accepts it.
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
