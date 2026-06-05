// Popup-based central-auth ceremony (spec 257 Phase 1 Wave 2 — ported VERBATIM from
// demo-org's audit-hardened `src/lib/central-auth.ts`; the cross-app-duplication pattern the
// repo already uses). demo-gs opens the central auth in a FIRST-PARTY popup (WebAuthn
// create/get work there; no iframe storage partitioning) and receives the result over a
// strictly origin-validated postMessage channel. Redirect is the fallback when the popup is
// blocked or on mobile (greenfield screen 11, ADR-0013 explicit fallback).
//
// Security (audit F3/F5): we resolve ONLY on a message from the exact popup window we
// opened, at the exact central-auth origin, whose echoed `state` matches what we generated.
// The OP (spec 230) returns a single OIDC authorization CODE over the popup channel; the
// relying site exchanges it at /token. No tokens/delegations travel in the message or URL.
//
// The broker side (demo-sso-next `useEnrollReq.ts`) already speaks this exact protocol — it
// detects `?mode=popup` + `window.opener` and posts `{type:'AC_SUCCESS', state, code}` to the
// exact relying origin, then `window.close()`. This file is the relying-side counterpart only.
export type PopupResult =
  | { status: 'success'; code: string }
  | { status: 'cancelled' }
  | { status: 'error'; error: string }
  | { status: 'blocked' };

interface AcMessage {
  type: 'AC_PROGRESS' | 'AC_SUCCESS' | 'AC_ERROR' | 'AC_CANCEL';
  state?: string;
  msg?: string;
  error?: string;
  code?: string;
  /** AC_PROGRESS only: the popup is about to redirect to the OAuth IdP (its opener will be severed
   *  by COOP). Tells the opener to stop trusting `popup.closed` and wait for the relay channel. */
  idp?: boolean;
}

/** Same-origin BroadcastChannel the popup uses to hand the OIDC code back when its opener was
 *  severed by the OAuth IdP (Google COOP) — see main.tsx `relayPopupCodeIfNeeded` + the broker's
 *  `ac_relay` marker. Only demo-gs windows (this origin) can read it; the listener still validates
 *  `state` so a relayed code can't cross-bind to a different in-flight connect. */
export const RELAY_CHANNEL = 'demo-gs-connect-relay';

interface RelayMessage {
  kind?: string;
  state?: string;
  code?: string;
}

/** Prefer a redirect on mobile / narrow viewports (a popup opens as a tab there). */
export function preferRedirect(): boolean {
  return (
    (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches) ||
    /Mobi|Android/i.test(navigator.userAgent)
  );
}

/** Open the central auth in a popup and resolve when it posts a result. `redirectUrl` is the
 *  URL the caller already built (with name + enroll public key + `state`); we append
 *  `mode=popup`. `expectedOrigin` is the RESOLVED central-auth origin for this name (spec 229
 *  §4) — messages are accepted ONLY from it (audit F3), so the check follows the per-person
 *  origin, not a module constant. Resolves 'blocked' if the popup couldn't open (caller should
 *  fall back to a full-page redirect). */
export function openCentralAuthPopup(
  redirectUrl: string,
  expectedState: string,
  expectedOrigin: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<PopupResult> {
  const popupUrl = redirectUrl + (redirectUrl.includes('?') ? '&' : '?') + 'mode=popup';
  const w = 480;
  const h = 680;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
  const popup = window.open(popupUrl, 'agentic-connect', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (!popup) return Promise.resolve({ status: 'blocked' });

  // The popup hands the code back over a same-origin channel when the OAuth IdP severed its opener
  // (so postMessage can't reach us). Validate `state` exactly as the postMessage path does.
  const relay = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(RELAY_CHANNEL) : null;

  return new Promise<PopupResult>((resolve) => {
    let done = false;
    // The broker sets COOP (`same-origin-allow-popups`), which SEVERS our cross-origin handle to the
    // popup the moment it loads the broker — so `popup.closed` reads `true` even while the popup is
    // alive, and postMessage from the popup can't reach us. We therefore CANNOT poll `popup.closed`
    // for cancel: success arrives over the same-origin relay channel (or postMessage if the opener
    // ever survives), and an abandoned popup resolves via the absolute timeout below.
    const finish = (r: PopupResult) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      if (relay) { relay.onmessage = null; try { relay.close(); } catch { /* ignore */ } }
      clearTimeout(abandonTimeout);
      resolve(r);
    };
    // Parent-side Cancel: the only reliable way to abort an in-flight popup under COOP (the opener's
    // `popup.closed` handle is severed, so we can't observe a window-close, and there's no channel a
    // window-close can signal back on). The relying app wires a visible "Cancel" affordance to an
    // AbortController; aborting closes the popup (best-effort) and resolves cancelled immediately.
    const onAbort = () => { try { popup.close(); } catch { /* ignore */ } finish({ status: 'cancelled' }); };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (relay) {
      relay.onmessage = (e: MessageEvent) => {
        const m = e.data as RelayMessage | null;
        if (!m || m.kind !== 'ac-relay') return;
        if (m.state !== expectedState || !m.code) return; // replay / cross-binding guard (audit F5)
        try { popup.close(); } catch { /* ignore */ }
        finish({ status: 'success', code: m.code });
      };
    }
    const onMessage = (e: MessageEvent) => {
      // Fail-closed (audit F3): only the popup we opened, at the exact central-auth origin.
      if (e.origin !== expectedOrigin || e.source !== popup) return;
      const m = e.data as AcMessage | null;
      if (!m || typeof m.type !== 'string') return;
      if (m.type === 'AC_PROGRESS') {
        if (m.msg) onProgress?.(m.msg);
        return;
      }
      if (m.type === 'AC_SUCCESS') {
        if (m.state !== expectedState) return; // replay / cross-binding guard (audit F5)
        if (!m.code) return;
        try {
          popup.close();
        } catch {
          /* ignore */
        }
        finish({ status: 'success', code: m.code });
        return;
      }
      if (m.type === 'AC_ERROR') {
        try {
          popup.close();
        } catch {
          /* ignore */
        }
        finish({ status: 'error', error: m.error ?? 'enrollment failed' });
        return;
      }
      if (m.type === 'AC_CANCEL') {
        try {
          popup.close();
        } catch {
          /* ignore */
        }
        finish({ status: 'cancelled' });
      }
    };
    window.addEventListener('message', onMessage);
    // Abandon safety net: with our handle severed (COOP) we can't observe the popup closing, so a
    // popup that never returns a result resolves as cancelled after this window instead of hanging
    // the caller's button forever. The parent-side Cancel above is the fast path; this is the backstop
    // for an abandoned popup. A success/decline that DOES come back (relay/postMessage) clears it.
    const abandonTimeout = window.setTimeout(() => finish({ status: 'cancelled' }), 2 * 60 * 1000);
  });
}
