# Identity Auth API

Human-readable guide to `capability.manifest.json` exports.

## Sessions

- `mintSession(claims)` — sign JWT for cookie storage.
- `verifySession(token)` — verify and parse JWT.
- `SESSION_COOKIE` — default cookie name constant.
- `SESSION_TTL_SECONDS` — default TTL.

## CSRF

- `csrfTokenFor(sessionId, origin)` — mint CSRF token.
- `verifyCsrf(token, sessionId, origin)` — validate with exact origin match.

## Salt (CREATE2 Inputs)

- `deriveSaltFromLabel(label)` — keccak-truncated salt from auth-scope label.
- `deriveSaltFromEmail(email, rotation)` — salt from email + rotation counter.

Used by apps with `AgentAccountClient.getAddress` — **not** for `.agent` names.

## Signature Verification

- `verifyUserSignature` / `verifyUserSignatureView` — universal signature validator.
- `isErc6492Wrapped` — detect ERC-6492 wrapped signatures.
- `ERC1271_MAGIC`, `ERC6492_MAGIC` — magic value constants.
- `universalSignatureValidatorAbi`
- `VerifyUserSignatureArgs`, `UniversalValidatorClient`

## WebAuthn (Root Re-Exports; Prefer `/passkey`)

- `P256_N`, `base64urlEncode`, `base64urlDecode`
- `parseDerSignature`, `normaliseLowS`
- `buildWebAuthnAssertion`, `hashToWebAuthnChallenge`
- `parseAttestationObject`, `parseAuthData`
- `WebAuthnAssertion`, `ParsedAttestation`

On-chain wire encoding: `@agenticprimitives/agent-account`
(`encodeWebAuthnSignature`).

## Signer Types

- `Signer`, `PasskeySigner`, `EOASigner`, `KMSSigner`
- `PasskeyAssertion`
- `TypedDataDomain`, `TypedDataTypes`

## Session Types

- `JwtClaims`, `AuthenticatedUser`, `AuthMethod`
- `Address`, `Hex`

## Auth Method Subpaths

Import ceremonies from dedicated subpaths for tree-shaking:

- `@agenticprimitives/connect-auth/passkey` — signup/login helpers.
- `@agenticprimitives/connect-auth/siwe` — Sign-In with Ethereum.
- `@agenticprimitives/connect-auth/google` — Google OAuth.

Subpath exports are not duplicated in the root manifest list; document them
here for discoverability.
