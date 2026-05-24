# Identity Auth Troubleshooting

## `verifySession` Fails

- expired TTL (`SESSION_TTL_SECONDS`)
- wrong signing secret or key rotation without dual-verify window
- malformed cookie value

## CSRF Rejected

- origin header does not **exactly** match allowlisted origin (scheme + host + port)
- token not bound to current session id

## WebAuthn Ceremony Fails

- challenge reused (not one-shot)
- RP ID / origin mismatch with deployment URL
- passkey not enrolled on the target Smart Agent yet (custodian lookup empty)

## Multiple Smart Agents For One Credential

Expected when the same passkey is custodian on multiple SAs. App MUST prompt
user to pick; session primary subject must be the chosen SA address.

## Salt / Address Mismatch With `agent-account`

Ensure salt uses `deriveSaltFromEmail` or `deriveSaltFromLabel` — not namehash,
not profile hash. If salt source changed, counterfactual address will change.

## Confused `identity-auth` With `agent-identity`

| Symptom | Fix |
| --- | --- |
| Putting AgentCard in JWT | Public profile → `agent-identity`; JWT carries SA + optional display name |
| "Profile" in session | Use `AuthenticatedUser` for app session; AgentCard is separate |

## Confused Auth With Custody

Adding a replacement passkey after loss is **custody** (`RecoverAccount`), not
a new signup that mints a new SA. Session subject stays the same SA.

## Import Pulls Entire Auth Stack

Use subpath imports:

```ts
import * as passkey from '@agenticprimitives/identity-auth/passkey';
```

instead of importing unused methods from the root entry.
