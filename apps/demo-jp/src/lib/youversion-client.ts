// Spec 265 W4 — read a connected member's YouVersion data through demo-a2a's delegation-gated route,
// presenting the person→JP site grant (the same delegation JP already holds). demo-a2a verifies the
// grant (ERC-1271) + the person's data-scope, uses the KMS-custodied token server-side, and returns ONLY
// the data — the federated token never reaches this app. Mirrors vault-client's CSRF self-heal.
import { ensureCsrfToken, csrfHeaders, refreshCsrfToken } from '../csrf.js';
import type { DelegationWire } from './delegation.js';

export type YouVersionType = 'highlights' | 'notes' | 'bookmarks' | 'saved_verses';

const MAX_ATTEMPTS = 4;
const TIMEOUT_MS = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read the member's YouVersion `type` via the person→JP grant. Resolves to the data array; throws with
 *  a recognizable `message` on `scope_not_granted` / `no_youversion_link`. */
export async function readYouVersion(type: YouVersionType, grant: DelegationWire): Promise<Array<Record<string, unknown>>> {
  const body = { delegation: grant, requester: grant.delegate };
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await ensureCsrfToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let r: Response;
    try {
      r = await fetch(`/a2a/mcp/youversion/${type}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new Error(`youversion ${type} timed out — please retry.`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const j = (await r.json().catch(() => null)) as { ok?: boolean; data?: unknown; error?: string } | null;
    if (r.ok && j?.ok === true) {
      const d = j.data as { highlights?: unknown[]; notes?: unknown[]; bookmarks?: unknown[]; saved_verses?: unknown[]; data?: unknown[] } | unknown[] | null;
      const list = (Array.isArray(d) ? d : d?.highlights ?? d?.notes ?? d?.bookmarks ?? d?.saved_verses ?? d?.data ?? []) as Array<Record<string, unknown>>;
      return list;
    }
    lastErr = new Error(j?.error ?? `youversion ${type} failed (HTTP ${r.status})`);
    // Contract errors (the person hasn't granted this scope, or no YouVersion link) — do NOT retry.
    const err = j?.error ?? '';
    if (err.startsWith('scope_not_granted') || err === 'no_youversion_link') throw lastErr;
    // Transient: CSRF (refresh+retry) or a 5xx / still-confirming grant SA.
    const transient = r.status === 403 || r.status >= 500;
    if (!transient || attempt === MAX_ATTEMPTS) throw lastErr;
    if (r.status === 403) { try { await refreshCsrfToken(); } catch { /* next ensureCsrfToken retries */ } }
    await sleep(300 * attempt);
  }
  throw lastErr ?? new Error('youversion read failed');
}
