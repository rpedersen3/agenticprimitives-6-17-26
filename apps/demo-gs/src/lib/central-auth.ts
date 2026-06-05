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
    // Once the popup tells us it's leaving for the OAuth IdP, STOP trusting `popup.closed`: an IdP
    // with COOP (Google) severs our handle, making `popup.closed` read `true` even though the popup
    // is alive on the IdP — the result then comes back over the relay channel (or postMessage when
    // the opener survives). We switch to an absolute timeout so an abandoned popup still resolves.
    let leftForIdp = false;
    const finish = (r: PopupResult) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      if (relay) { relay.onmessage = null; try { relay.close(); } catch { /* ignore */ } }
      clearInterval(closedTimer);
      clearTimeout(idpTimeout);
      resolve(r);
    };
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
        // The broker signals `idp:true` right before redirecting the popup to the OAuth provider —
        // from here `popup.closed` is unreliable (COOP severance), so disable the closed→cancel poll.
        if (m.idp) leftForIdp = true;
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
    // If the user closes the popup before any result → cancelled. Suppressed once the popup left for
    // the IdP (severance makes `popup.closed` lie); the absolute timeout below covers that case.
    const closedTimer = window.setInterval(() => {
      if (!leftForIdp && popup.closed) finish({ status: 'cancelled' });
    }, 600);
    // Safety net: an abandoned popup that already left for the IdP (no relay, no close we can see)
    // resolves as cancelled after this window rather than hanging the caller's button forever.
    const idpTimeout = window.setTimeout(() => finish({ status: 'cancelled' }), 5 * 60 * 1000);
  });
}
