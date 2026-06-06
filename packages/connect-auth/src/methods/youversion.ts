// YouVersion Platform OIDC auth method — a thin binding over the generic OIDC implementation in
// `./google` (authorization-code + PKCE/S256 + state + nonce + RS256 id_token verification against the
// provider JWKS). YouVersion differs from Google in two ways, pre-set here so callers can't get them
// wrong: it is a PUBLIC PKCE client (NO client_secret) and it does not assert `email_verified`. The
// (iss, sub) facet model is identical. Endpoints: developers.youversion.com/sign-in-apis.
import {
  beginLogin as beginOidcLogin,
  completeLogin as completeOidcLogin,
  YOUVERSION_OIDC,
  oidcFacetId,
  type BeginLoginInput,
  type BeginLoginResult,
  type CompleteLoginInput,
  type CompleteLoginResult,
  type OidcPrincipal,
} from './google';

export { oidcFacetId, YOUVERSION_OIDC };
export type { BeginLoginResult, CompleteLoginResult, OidcPrincipal };

/** Start the YouVersion login — forces the YouVersion provider config. */
export function beginLogin(input: Omit<BeginLoginInput, 'config'>): BeginLoginResult {
  return beginOidcLogin({ ...input, config: YOUVERSION_OIDC });
}

/** Complete the YouVersion login: public PKCE (no `client_secret`), no `email_verified` requirement, and
 *  no `nonce` requirement (YouVersion's multi-leg /authorize→/callback→/token flow doesn't round-trip the
 *  authorize nonce into the id_token; PKCE binds the exchange instead). */
export function completeLogin(
  input: Omit<CompleteLoginInput, 'config' | 'clientSecret' | 'requireEmailVerified' | 'requireNonce'>,
): Promise<CompleteLoginResult> {
  return completeOidcLogin({ ...input, config: YOUVERSION_OIDC, requireEmailVerified: false, requireNonce: false });
}
