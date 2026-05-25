# Identity Auth Migration Notes

## Current Status

Experimental. JWT claim shapes and auth method modules may evolve; coordinate
with `delegation` when claim fields change.

## From EOA-As-Identity To Smart-Agent-As-Identity

Old: JWT `sub` = user EOA or email.

New ([ADR-0010](../../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)):

```ts
// Primary subject = canonical Smart Agent address
{ sub: '0x…', signer: '0x…' /* EOA or passkey-derived */, … }
```

Migrate authorization checks in apps and `delegation` readers to expect SA
address as principal.

## From Name-In-Salt To Auth-Scope Salt

Stop passing `.agent` labels into `deriveSaltFromLabel` if those labels came from
name registration. Use stable auth inputs (email, internal user id) instead.

## Session Vs Delegation Session

If migrating "session encryption" or "session key" features, route to
`delegation` (`SessionRow`), not this package. This package's session is a signed
JWT only ([ADR-0002](../../../docs/architecture/decisions/0002-session-lifecycle-in-delegation.md)).

## Breaking Change Checklist

1. `README.md`, `docs/api.md`
2. `docs/security.md`
3. `capability.manifest.json`
4. `specs/200-connect-auth.md`
5. Notify `delegation` consumers if `JwtClaims` changes
