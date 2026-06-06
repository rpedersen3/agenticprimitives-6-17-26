// Spec 265 W4 — read a connected member's YouVersion data through demo-a2a's delegation-gated route,
// presenting the person→JP site grant (the same delegation JP already holds). demo-a2a verifies the
// grant (ERC-1271) + the person's data-scope, uses the KMS-custodied token server-side, and returns ONLY
// the data — the federated token never reaches this app. Mirrors vault-client's CSRF self-heal.
import { ensureCsrfToken, csrfHeaders, refreshCsrfToken } from '../csrf.js';
import type { DelegationWire } from './delegation.js';

// YouVersion's Platform API exposes one user-data resource — highlights, read per Bible chapter.
export type YouVersionType = 'highlights';

const MAX_ATTEMPTS = 4;
const TIMEOUT_MS = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read the member's YouVersion highlights for a Bible chapter via the person→JP grant. `passageId` is a
 *  chapter USFM (e.g. "JHN.3"); `versionId` is a Bible version id (default 111 = NIV). Resolves to the data
 *  array; throws with a recognizable `message` on `scope_not_granted` / `no_youversion_link`. */
export async function readYouVersion(
  type: YouVersionType,
  grant: DelegationWire,
  opts: { versionId?: string; passageId?: string } = {},
): Promise<Array<Record<string, unknown>>> {
  const body = { delegation: grant, requester: grant.delegate, versionId: opts.versionId, passageId: opts.passageId };
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
      const d = j.data as { highlights?: unknown[]; data?: unknown[] } | unknown[] | null;
      const list = (Array.isArray(d) ? d : d?.highlights ?? d?.data ?? []) as Array<Record<string, unknown>>;
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
