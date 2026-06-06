// @agenticprimitives/fedcm-idp — the FedCM IdP contract as PURE builders + validators (spec 264 Phase 1;
// ADR-0031). This package encodes the browser↔IdP wire shapes (the `.well-known/web-identity` manifest,
// the provider config, the accounts list, the thin id-assertion claims, and the request validators) as
// pure, dependency-free functions. It performs NO I/O, holds NO key, and signs NOTHING — the demo-sso app
// hosts the endpoints, owns the session + the account list, and signs the assertion claims with its
// existing OIDC key. The deep capability/delegation object is issued by the substrate AFTER the assertion
// (ADR-0031); the assertion here is a THIN identity + intent bootstrap only.
//
// NOTE (draft): the FedCM IdP field names below follow the W3C/Chrome contract, which had breaking changes
// across Chrome 143→145 (structured JSON, endpoint validation). Verify against the current FedCM spec +
// a live Chrome before marking this package `stable` / publishable (spec 264 Phase 1b).

// ─── /.well-known/web-identity ──────────────────────────────────────────────
export interface WebIdentityManifest {
  /** Absolute URLs of this origin's FedCM provider config(s). */
  provider_urls: string[];
}

/** Build the `/.well-known/web-identity` body that declares this origin's FedCM config URL(s). */
export function buildWebIdentity(providerConfigUrls: string[]): WebIdentityManifest {
  return { provider_urls: providerConfigUrls };
}

// ─── /fedcm/config.json ─────────────────────────────────────────────────────
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

/** Build the `/fedcm/config.json` body. Endpoint paths/URLs are supplied by the app (generic — no
 *  hostnames here, ADR-0021). Optional members are omitted when absent. */
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

// ─── /fedcm/accounts ────────────────────────────────────────────────────────
/** A FedCM account row the browser renders in its account chooser. For us, each row is a signed-in agent
 *  the home session resolves (Person Agent / Organization Agent). `id` MUST be the stable account key —
 *  the Smart Account address (ADR-0010) — never a name (which is a mutable facet). */
export interface FedcmAccount {
  id: string;
  name: string;
  email?: string;
  given_name?: string;
  picture?: string;
  /** client_ids this account has already approved → the browser can skip the disclosure UI. */
  approved_clients?: string[];
  /** Hints (e.g. the handle) the RP may have passed via `loginHint`. */
  login_hints?: string[];
}

export interface AccountsResponse {
  accounts: FedcmAccount[];
}

export function buildAccountsResponse(accounts: FedcmAccount[]): AccountsResponse {
  return { accounts };
}

// ─── /fedcm/assertion — the THIN identity+intent assertion (spec 264) ────────
/** The thin assertion CLAIMS (NOT the authority model). The app signs these into the `token` with its
 *  existing OIDC key; the relying app verifies via the existing JWKS + `(iss, sub)` (ADR-0010). The deep
 *  capability/delegation object is issued by the substrate AFTER this (ADR-0031) — never as a scope here. */
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

/** Build the thin assertion claims. Defaults `intent` to `signin`. Omits optional members when absent so
 *  the signed token stays minimal (a bootstrap, not an authority object). */
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

// ─── Request validation ─────────────────────────────────────────────────────
/** Every FedCM credentialed request from the browser carries `Sec-Fetch-Dest: webidentity`. The IdP MUST
 *  reject requests without it (a non-FedCM caller). Pass the header value (case-insensitive). */
export function isWebIdentityRequest(secFetchDest: string | null | undefined): boolean {
  return (secFetchDest ?? '').trim().toLowerCase() === 'webidentity';
}

/** The id-assertion POST is form-encoded: `client_id`, `account_id`, `nonce`, `disclosure_text_shown`,
 *  and (optional) `params` (JSON — our custom `scope`/`intent`/`delegation_request_hash`). */
export interface AssertionRequest {
  clientId: string;
  accountId: string;
  nonce: string;
  disclosureTextShown: boolean;
  params?: Record<string, unknown>;
}

/** Parse + validate the id-assertion request fields from a flat form map. Returns `null` if a required
 *  field is missing (the caller returns 400 — fail-closed). `params` is parsed leniently (ignored if not
 *  valid JSON). */
export function parseAssertionRequest(form: Record<string, string | undefined>): AssertionRequest | null {
  const clientId = form.client_id?.trim();
  const accountId = form.account_id?.trim();
  const nonce = form.nonce?.trim();
  if (!clientId || !accountId || !nonce) return null;
  let params: Record<string, unknown> | undefined;
  if (form.params) {
    try {
      const p = JSON.parse(form.params) as unknown;
      if (p && typeof p === 'object') params = p as Record<string, unknown>;
    } catch {
      /* lenient — ignore malformed custom params */
    }
  }
  return {
    clientId,
    accountId,
    nonce,
    disclosureTextShown: (form.disclosure_text_shown ?? '').toLowerCase() === 'true',
    params,
  };
}
