// @agenticprimitives/fedcm-rp — the RELYING-PARTY side of FedCM (spec 264 Phase 1; ADR-0031). A thin,
// dependency-free wrapper over `navigator.credentials.get({ identity })` that returns the IdP token. It is
// the FedCM strategy a consumer injects into `@agenticprimitives/browser-identity`'s `chooseSignIn`
// (FedCM-first, not FedCM-only). The token is a THIN identity bootstrap; the deep capability/delegation
// object is obtained from the substrate AFTER this token (ADR-0031), never decoded from a FedCM scope.
//
// Shapes follow the CURRENT (post Chrome 145) FedCM RP contract: `configURL` + `clientId`, and the
// RP's `nonce` + custom params travel INSIDE `params` (top-level `nonce` was removed in 145). The
// `identity` request member is not in the standard DOM lib, so we call through a permissive cast.

export interface FedcmProvider {
  /** The IdP config URL (e.g. https://www.example/fedcm/config.json). */
  configURL: string;
  /** The IdP-issued client id for this relying app. */
  clientId: string;
  /** Custom params — `nonce` (post-145) + our `scope` / `intent` / `delegation_request_hash` ride here. */
  params?: Record<string, unknown>;
  loginHint?: string;
  domainHint?: string;
  /** Subset of name/email/picture/username/tel the RP wants (Chrome 132+). */
  fields?: string[];
}

export interface FedcmGetOptions {
  /** One or MORE providers in a single call (Chrome 136+ multi-IdP). When `mode:'active'` it MUST be a
   *  single provider (the browser rejects otherwise). */
  providers: FedcmProvider[];
  /** Dialog framing: 'signin'(default) | 'signup' | 'use' | 'continue'. */
  context?: 'signin' | 'signup' | 'use' | 'continue';
  /** 'passive'(default) may auto-initiate; 'active' needs a user gesture. */
  mode?: 'passive' | 'active';
  /** 'optional'(default) | 'required' | 'silent' — controls auto-reauthn. */
  mediation?: 'optional' | 'required' | 'silent';
  signal?: AbortSignal;
}

export interface FedcmResult {
  /** The IdP token (our thin assertion JWT). */
  token: string;
  /** Which provider authenticated (multi-IdP). */
  configURL?: string;
  /** True if the browser auto-reauthenticated. */
  isAutoSelected?: boolean;
}

/** Feature-detect FedCM (`'IdentityCredential' in window`). Mirrors `browser-identity.fedcmAvailable()`;
 *  callers should gate on it (the spec-259 fallback handles non-FedCM browsers). SSR-safe. */
export function fedcmSupported(): boolean {
  return typeof window !== 'undefined' && 'IdentityCredential' in window;
}

/** Run the FedCM RP ceremony and return the IdP token (+ which provider). Throws if unsupported, if the
 *  user dismisses, or on any FedCM error — the caller's `chooseSignIn` fallback (spec 259) is the safety
 *  net, so callers gate on `fedcmSupported()` and treat a throw as "use the fallback". */
export async function fedcmGet(opts: FedcmGetOptions): Promise<FedcmResult> {
  if (!fedcmSupported()) throw new Error('FedCM is not supported in this browser');
  const request = {
    identity: {
      providers: opts.providers.map((p) => ({
        configURL: p.configURL,
        clientId: p.clientId,
        ...(p.params ? { params: p.params } : {}),
        ...(p.loginHint ? { loginHint: p.loginHint } : {}),
        ...(p.domainHint ? { domainHint: p.domainHint } : {}),
        ...(p.fields ? { fields: p.fields } : {}),
      })),
      ...(opts.context ? { context: opts.context } : {}),
      ...(opts.mode ? { mode: opts.mode } : {}),
    },
    ...(opts.mediation ? { mediation: opts.mediation } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
  // `identity` is not in the standard DOM `CredentialRequestOptions`; call through a permissive cast.
  const get = navigator.credentials.get.bind(navigator.credentials) as (o: unknown) => Promise<unknown>;
  const cred = (await get(request)) as { token?: string; configURL?: string; isAutoSelected?: boolean } | null;
  if (!cred) throw new Error('FedCM returned no credential');
  if (!cred.token) throw new Error('FedCM credential had no token');
  return { token: cred.token, configURL: cred.configURL, isAutoSelected: cred.isAutoSelected };
}
