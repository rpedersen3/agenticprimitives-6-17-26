// @agenticprimitives/fedcm-idp — the FedCM IdP contract as PURE builders + validators (spec 264 Phase 1;
// ADR-0031). Encodes the browser↔IdP wire shapes as pure, dependency-free functions. NO I/O, NO key, NO
// signing — the demo-sso app hosts the endpoints, owns the session + account list, and signs the assertion
// claims with its existing OIDC key. The deep capability/delegation object is issued by the substrate
// AFTER the assertion (ADR-0031); the assertion here is a THIN identity + intent bootstrap only.
//
// Field names follow the CURRENT (post Chrome 145) W3C/Chrome FedCM contract — verified against the spec +
// Chrome/MDN docs (2026). The known 143→145 breaking changes are reflected: `nonce` arrives inside
// `params` (not top-level); the well-known needs `accounts_endpoint`+`login_url` when a
// `client_metadata_endpoint` is configured; the client error property is `error` (server JSON stays
// `error.code`). Re-verify against a live Chrome before this package graduates from `private:true`.

// ─── /.well-known/web-identity (served from the IdP eTLD+1) ──────────────────
export interface WebIdentityManifest {
  /** The IdP's config URL — the spec limits this to EXACTLY ONE entry. */
  provider_urls: [string];
  /** Required (Chrome 145+) ONLY when the config declares a `client_metadata_endpoint`. */
  accounts_endpoint?: string;
  /** Required (Chrome 145+) ONLY when the config declares a `client_metadata_endpoint`. */
  login_url?: string;
}

/** Build the `/.well-known/web-identity` body. `provider_urls` is a single-element array (spec limit).
 *  Pass `accounts_endpoint` + `login_url` when the config also ships a `client_metadata_endpoint`
 *  (required from Chrome 145). */
export function buildWebIdentity(
  providerConfigUrl: string,
  opts: { accountsEndpoint?: string; loginUrl?: string } = {},
): WebIdentityManifest {
  const m: WebIdentityManifest = { provider_urls: [providerConfigUrl] };
  if (opts.accountsEndpoint) m.accounts_endpoint = opts.accountsEndpoint;
  if (opts.loginUrl) m.login_url = opts.loginUrl;
  return m;
}

// ─── config.json ────────────────────────────────────────────────────────────
export interface FedcmBranding {
  name?: string;
  background_color?: string;
  color?: string;
  icons?: Array<{ url: string; size?: number }>;
}

export interface ProviderConfig {
  accounts_endpoint: string;
  id_assertion_endpoint: string;
  login_url: string;
  client_metadata_endpoint?: string;
  disconnect_endpoint?: string;
  branding?: FedcmBranding;
}

export interface ProviderConfigInput {
  accountsEndpoint: string;
  idAssertionEndpoint: string;
  loginUrl: string;
  clientMetadataEndpoint?: string;
  disconnectEndpoint?: string;
  branding?: FedcmBranding;
}

/** Build the config.json body. Required: accounts/id_assertion/login. Endpoint paths/URLs are supplied by
 *  the app (generic — no hostnames here, ADR-0021). Optional members are omitted when absent. */
export function buildProviderConfig(input: ProviderConfigInput): ProviderConfig {
  const cfg: ProviderConfig = {
    accounts_endpoint: input.accountsEndpoint,
    id_assertion_endpoint: input.idAssertionEndpoint,
    login_url: input.loginUrl,
  };
  if (input.clientMetadataEndpoint) cfg.client_metadata_endpoint = input.clientMetadataEndpoint;
  if (input.disconnectEndpoint) cfg.disconnect_endpoint = input.disconnectEndpoint;
  if (input.branding) cfg.branding = input.branding;
  return cfg;
}

// ─── accounts endpoint ──────────────────────────────────────────────────────
/** A FedCM account row the browser renders in its chooser. For us each row is a signed-in agent the home
 *  session resolves (Person / Organization Agent). `id` MUST be the stable account key — the Smart
 *  Account address (ADR-0010) — never a name (a mutable facet). At least one of name/email/username/tel is
 *  required by the spec; we always provide `name`. */
export interface FedcmAccount {
  id: string;
  name: string;
  email?: string;
  username?: string;
  tel?: string;
  given_name?: string;
  picture?: string;
  /** client_ids this account already approved → the browser may skip the disclosure UI. */
  approved_clients?: string[];
  login_hints?: string[];
  domain_hints?: string[];
}

export interface AccountsResponse {
  accounts: FedcmAccount[];
}

export function buildAccountsResponse(accounts: FedcmAccount[]): AccountsResponse {
  return { accounts };
}

// ─── id_assertion endpoint ──────────────────────────────────────────────────
/** The thin assertion CLAIMS (NOT the authority model). The app signs these into the `token` with its
 *  existing OIDC key; the relying app verifies via the existing JWKS + `(iss, sub)` (ADR-0010). The deep
 *  capability/delegation object is issued by the substrate AFTER this (ADR-0031) — never a scope here. */
export interface AssertionClaims {
  iss: string;
  aud: string;
  /** The Smart Account (CAIP-10) — the canonical subject (ADR-0010). */
  sub: string;
  origin: string;
  nonce: string;
  /** signin | org-create | data-access — bootstraps the substrate step that follows. */
  intent: string;
  agent_did?: string;
  /** Optional: binds this bootstrap to the delegation the SUBSTRATE will issue (spec 264 §VII.6). */
  delegation_request_hash?: string;
  iat?: number;
}

export interface AssertionInput {
  iss: string;
  aud: string;
  sub: string;
  origin: string;
  nonce: string;
  intent?: string;
  agentDid?: string;
  delegationRequestHash?: string;
  /** Stamp at the call site (the package has no clock). */
  iat?: number;
}

/** Build the thin assertion claims. Defaults `intent` to `signin`; omits absent optionals so the signed
 *  token stays minimal (a bootstrap, not an authority object). */
export function buildAssertionClaims(input: AssertionInput): AssertionClaims {
  const claims: AssertionClaims = {
    iss: input.iss,
    aud: input.aud,
    sub: input.sub,
    origin: input.origin,
    nonce: input.nonce,
    intent: input.intent ?? 'signin',
  };
  if (input.agentDid) claims.agent_did = input.agentDid;
  if (input.delegationRequestHash) claims.delegation_request_hash = input.delegationRequestHash;
  if (typeof input.iat === 'number') claims.iat = input.iat;
  return claims;
}

/** Success body. */
export function buildTokenResponse(token: string): { token: string } {
  return { token };
}

/** Multi-step / interactive continuation — the browser opens `url` in a popup; the IdP page finishes with
 *  `IdentityProvider.resolve(token)`. */
export function buildContinueResponse(url: string): { continue_on: string } {
  return { continue_on: url };
}

export interface FedcmErrorResponse {
  error: { code: string; url?: string };
}

/** Error body (`{ error: { code, url? } }`). `code` is an OAuth-style string (invalid_request,
 *  unauthorized_client, access_denied, server_error, temporarily_unavailable) or a custom string; `url`
 *  (optional) is a same-site human-readable error page. */
export function buildErrorResponse(code: string, url?: string): FedcmErrorResponse {
  return url ? { error: { code, url } } : { error: { code } };
}

/** The CORS headers the IdP MUST set on the id_assertion response (credentialed → must echo the exact RP
 *  origin, never `*`). */
export function assertionCorsHeaders(rpOrigin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': rpOrigin,
    'Access-Control-Allow-Credentials': 'true',
  };
}

// ─── Login status + request validation ──────────────────────────────────────
/** The header name the IdP sets to keep the browser's per-IdP login state current. */
export const SET_LOGIN_HEADER = 'Set-Login';

/** `Set-Login: logged-in | logged-out` header value. Without this the browser never calls the accounts
 *  endpoint. (Alternatively the IdP page calls `navigator.login.setStatus(...)`.) */
export function loginStatusHeader(status: 'logged-in' | 'logged-out'): { name: string; value: string } {
  return { name: SET_LOGIN_HEADER, value: status };
}

/** Every credentialed FedCM request carries `Sec-Fetch-Dest: webidentity`. The IdP MUST verify it on the
 *  accounts + id_assertion (+ disconnect) endpoints and reject otherwise — the primary CSRF defense. */
export function isWebIdentityRequest(secFetchDest: string | null | undefined): boolean {
  return (secFetchDest ?? '').trim().toLowerCase() === 'webidentity';
}

/** The id-assertion POST is `application/x-www-form-urlencoded`. Post-145 the RP's `nonce` arrives INSIDE
 *  the `params` JSON (top-level `nonce` is accepted as 143–144 compat). */
export interface AssertionRequest {
  clientId: string;
  accountId: string;
  nonce: string;
  disclosureTextShown: boolean;
  /** The RP's custom params object (our `scope` / `intent` / `delegation_request_hash` ride here). */
  params?: Record<string, unknown>;
}

/** Parse + validate the id-assertion request fields from a flat form map. Returns `null` (→ app returns
 *  400, fail-closed) if a required field (client_id / account_id / nonce) is missing. `params` is parsed
 *  leniently; `nonce` is read from `params.nonce` first (post-145), then a top-level `nonce` (compat). */
export function parseAssertionRequest(form: Record<string, string | undefined>): AssertionRequest | null {
  const clientId = form.client_id?.trim();
  const accountId = form.account_id?.trim();
  let params: Record<string, unknown> | undefined;
  if (form.params) {
    try {
      const p = JSON.parse(form.params) as unknown;
      if (p && typeof p === 'object') params = p as Record<string, unknown>;
    } catch {
      /* lenient — ignore malformed custom params */
    }
  }
  const nonceFromParams = typeof params?.nonce === 'string' ? params.nonce.trim() : undefined;
  const nonce = nonceFromParams || form.nonce?.trim();
  if (!clientId || !accountId || !nonce) return null;
  return {
    clientId,
    accountId,
    nonce,
    disclosureTextShown: (form.disclosure_text_shown ?? '').toLowerCase() === 'true',
    params,
  };
}
