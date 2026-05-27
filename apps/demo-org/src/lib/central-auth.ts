// Popup-based central-auth ceremony (spec 229 + the popup UX design). demo-org opens the
// central auth in a FIRST-PARTY popup (WebAuthn create/get work there; no iframe storage
// partitioning) and receives the result over a strictly origin-validated postMessage
// channel. Redirect is the fallback when the popup is blocked or on mobile.
//
// Security (audit F3/F5): we resolve ONLY on a message from the exact popup window we
// opened, at the exact central-auth origin, whose echoed `state` matches what we generated.
import { CENTRAL_AUTH_ORIGIN } from '../connect-client';

export interface RootKeyMsg {
  credentialIdDigest: string;
  x: string;
  y: string;
}
export type PopupResult =
  | { status: 'success'; name: string; root?: RootKeyMsg }
  | { status: 'cancelled' }
  | { status: 'error'; error: string }
  | { status: 'blocked' };

interface AcMessage {
  type: 'AC_PROGRESS' | 'AC_SUCCESS' | 'AC_ERROR' | 'AC_CANCEL';
  state?: string;
  msg?: string;
  name?: string;
  error?: string;
  root?: RootKeyMsg;
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
 *  `mode=popup`. Resolves 'blocked' if the popup couldn't open (caller should fall back to a
 *  full-page redirect). */
export function openCentralAuthPopup(
  redirectUrl: string,
  expectedState: string,
  onProgress?: (msg: string) => void,
): Promise<PopupResult> {
  const popupUrl = redirectUrl + (redirectUrl.includes('?') ? '&' : '?') + 'mode=popup';
  const w = 480;
  const h = 680;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
  const popup = window.open(popupUrl, 'agentic-connect', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (!popup) return Promise.resolve({ status: 'blocked' });

  return new Promise<PopupResult>((resolve) => {
    let done = false;
    const finish = (r: PopupResult) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedTimer);
      resolve(r);
    };
    const onMessage = (e: MessageEvent) => {
      // Fail-closed (audit F3): only the popup we opened, at the exact central-auth origin.
      if (e.origin !== CENTRAL_AUTH_ORIGIN || e.source !== popup) return;
      const m = e.data as AcMessage | null;
      if (!m || typeof m.type !== 'string') return;
      if (m.type === 'AC_PROGRESS') {
        if (m.msg) onProgress?.(m.msg);
        return;
      }
      if (m.type === 'AC_SUCCESS') {
        if (m.state !== expectedState) return; // replay / cross-binding guard (audit F5)
        try {
          popup.close();
        } catch {
          /* ignore */
        }
        finish({ status: 'success', name: m.name ?? '', root: m.root });
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
    // If the user closes the popup before any result → treat as cancelled.
    const closedTimer = window.setInterval(() => {
      if (popup.closed) finish({ status: 'cancelled' });
    }, 600);
  });
}
