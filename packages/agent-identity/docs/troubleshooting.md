# Agent Identity Troubleshooting

## `ProfileHashMismatchError`

The fetched JSON's `profileContentHash` does not match the on-chain
`metadata-hash` record.

Check:

- profile was edited off-chain without updating chain
- wrong agent address passed to `fetchProfile`
- non-canonical JSON (extra keys, different number formatting)

Recompute with `profileContentHash` locally before publishing.

## `InvalidCaip10Error` On Encode

Common causes:

- namespace not in `CAIP10_NAMESPACE_ALLOWLIST`
- malformed `eip155` address (missing `0x`, wrong length)

Use `parseCaip10` for read paths when accepting external input.

## `InvalidProfileError`

Card fails schema validation for its `type`. Confirm required sub-objects exist
(`mcpServer` block for `type: 'mcpServer'`, etc.).

## Client Throws `I Phase 2` / `I Phase 4`

Expected in Phase 1. Use pure helpers (`canonicalProfileJson`,
`profileContentHash`, `buildCaip10Address`) until client methods are wired.

## Confused With `identity-auth` "Profile"

`identity-auth` JWT profile = session user metadata (private).
`agent-identity` AgentCard = public agent manifest (facet).

Route session claims to `identity-auth`; route AgentCard to this package.

## Confused With Naming

| Need | Package |
| --- | --- |
| Resolve `alice.agent` → address | `agent-naming` |
| Publish AgentCard for `0x…` | `agent-identity` |
| Set `nativeId` on name records | `agent-naming/records` |

Compose at the app: resolve name, then `fetchProfile(address)`.

## Endpoint Verification Fails

Confirm the declared method matches deployed infrastructure (DNS TXT record,
signed URL endpoint, etc.). Verification does not fix broken `mcpEndpoint`
naming records — it proves control, not reachability.
