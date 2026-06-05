// @agenticprimitives/browser-identity — the browser-integration ADAPTER seam (spec 264 Phase 0; ADR-0031).
//
// FedCM (and, later, the Digital Credentials API) are browser-FACING federation adapters over the
// agenticprimitives AUTHORITY substrate — they are NOT the substrate, and the posture is FedCM-FIRST,
// not FedCM-ONLY. This package owns ONLY the generic, transport-agnostic selector + feature-detect that
// decides WHICH browser sign-in path to run. It never imports an app, a transport SDK, or the substrate;
// the concrete sign-in strategies (the FedCM RP path, the home popup/redirect fallback) are INJECTED by
// the consumer, and this package never inspects their result. The deep capability/delegation object is
// issued by the substrate AFTER sign-in — never here (ADR-0031).

/** Is the browser's FedCM API available? (`navigator.credentials.get({ identity })`.)
 *  Feature-detect ONLY — we never assume support; an unsupported browser uses the fallback (ADR-0031:
 *  FedCM-first, not FedCM-only; FedCM is MDN "Limited availability"). Safe during SSR (returns false). */
export function fedcmAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials &&
    typeof navigator.credentials.get === 'function' &&
    // The interface the FedCM spec exposes; absent in non-supporting browsers.
    typeof (globalThis as { IdentityCredential?: unknown }).IdentityCredential !== 'undefined'
  );
}

/** A sign-in strategy: an async thunk producing the CONSUMER's own connect result `T`. The consumer
 *  injects its concrete strategies; this package only chooses between them, staying generic (no app /
 *  transport / substrate imports — ADR-0021 + the package-boundary doctrine). */
export type SignInStrategy<T> = () => Promise<T>;

export interface ChooseSignInOptions<T> {
  /** The browser-native FedCM path (spec 264 Phase 1+). OMIT it while FedCM isn't wired yet — the
   *  fallback runs, so the seam is in place with ZERO behaviour change (Phase 0). */
  fedcm?: SignInStrategy<T>;
  /** The GUARANTEED fallback — the home popup/redirect (spec 259). Always required: it is the path that
   *  works in every browser, so it is never optional. */
  fallback: SignInStrategy<T>;
  /** Force a path. `'auto'` (default) feature-detects FedCM; `'fedcm'` / `'fallback'` pin it (tests,
   *  opt-out, staged rollout). */
  prefer?: 'auto' | 'fedcm' | 'fallback';
}

/** Pick the browser sign-in path: the FedCM strategy when the browser supports it AND it was provided,
 *  else the spec-259 fallback (FedCM-first, not FedCM-only — ADR-0031). The result type `T` is the
 *  consumer's own; this never inspects it. */
export async function chooseSignIn<T>(opts: ChooseSignInOptions<T>): Promise<T> {
  if (opts.prefer === 'fallback') return opts.fallback();
  const useFedcm = opts.prefer === 'fedcm' || (!!opts.fedcm && fedcmAvailable());
  if (useFedcm && opts.fedcm) return opts.fedcm();
  return opts.fallback();
}
