/**
 * Passkey gesture gate (WebAuthn transient-activation fix).
 *
 * A custody ceremony signs a SCHEDULE hash and then — after the schedule tx
 * mines and the ETA is read back (the apply hash depends on that ETA, so it
 * can't be pre-signed) — an APPLY hash; Act 4 also chains a SECOND
 * schedule→apply round-trip for the Org. Every passkey assertion past the first
 * runs seconds after the click that started the act, in a fresh task with no
 * transient user activation left, so browsers that enforce activation for
 * WebAuthn (Safari/WebKit, increasingly Chrome) reject `navigator.credentials.get()`
 * with `NotAllowedError` ("The operation either timed out or was not allowed").
 *
 * The gate re-acquires activation: on that error the ceremony calls
 * `runWithPasskeyGesture(label, () => assertWithPasskey(...))`, the single mounted
 * `<PasskeyGate/>` renders a "Continue with passkey" button, and the user's click
 * runs the assertion thunk SYNCHRONOUSLY inside the click handler. That last part
 * is essential: WebKit requires `credentials.get()` to be invoked in the
 * user-gesture task itself — calling it in a microtask after a resolved promise
 * (e.g. `await gate; await get()`) still fails. So the gate executes the thunk in
 * its onClick rather than just resolving a promise the ceremony then awaits.
 * Happy-path browsers never hit the gate, so working acts are unchanged.
 */
import { useSyncExternalStore } from 'react';

interface PendingGesture {
  label: string;
  /** Invoked by the gate button's onClick — runs the assertion thunk in-gesture. */
  run: () => void;
}

let pending: PendingGesture | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** True when the thrown error is the WebAuthn lost-activation / cancel / timeout `NotAllowedError`. */
export function isWebAuthnNotAllowed(e: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'NotAllowedError') ||
    (e instanceof Error && e.name === 'NotAllowedError')
  );
}

/**
 * Run a passkey assertion that needs a fresh user gesture. Shows the gate; when
 * the user taps, `fn` (which must call `navigator.credentials.get()` as its first
 * async step) runs SYNCHRONOUSLY inside that click handler so the assertion has
 * transient activation. Resolves/rejects with the assertion's result.
 *
 * Sequential by construction (a ceremony signs one assertion at a time), so a
 * single pending slot is sufficient.
 */
export function runWithPasskeyGesture<T>(label: string, fn: () => Promise<T>): Promise<T> {
  // Defensive: if the gate UI isn't mounted (no subscriber), run the assertion
  // directly rather than hang forever waiting on a tap that can never come. Every
  // in-app passkey assertion runs under TreasuryShell, where <PasskeyGate/> IS
  // mounted, so this only guards stray/early call sites.
  if (listeners.size === 0) return fn();
  return new Promise<T>((resolve, reject) => {
    pending = {
      label,
      run: () => {
        pending = null;
        emit();
        // fn() is invoked here, in the gate button's click handler, so the
        // credentials.get() inside it runs with fresh user activation (WebKit).
        try {
          fn().then(resolve, reject);
        } catch (e) {
          reject(e);
        }
      },
    };
    emit();
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Hook for the mounted gate component: the current pending gesture (or null). */
export function usePendingPasskeyGesture(): { label: string; run: () => void } | null {
  const snap = useSyncExternalStore(
    subscribe,
    () => pending,
    () => pending,
  );
  if (!snap) return null;
  return { label: snap.label, run: snap.run };
}
