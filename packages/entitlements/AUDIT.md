# @agenticprimitives/entitlements — audit notes

**Status:** matching engine (spec 277 §10). No VC-proof verification, no status-list, no I/O yet.

## Trust model
- This release decides **authorization shape** (does a credential's scope cover the query?), NOT
  credential **authenticity**. `matchesEntitlement` assumes the credentials handed to it are already
  verified (VC proof) and unrevoked (status list) — those are the additive upstream layer. Until that
  layer lands, callers MUST only feed it credentials from a trusted source.
- Fail-closed: `resolveEntitlements` returns `deny` unless some credential matches on every dimension.

## Security invariants (tested — `test/unit/match.test.ts`)
- **Subset fields** — a field-scoped credential denies any requested field outside its grant; an
  unscoped credential grants all; `allowedFields` is the requested∩granted intersection.
- **Purpose pinning** — a purpose-pinned credential denies a mismatched/absent query purpose.
- **Classification ceiling** — data above the credential's ceiling is denied.
- **Validity window** — before `validFrom` / after `validUntil` → expired.
- **Scope match** — audience/resource/actor/principal must all match; action must be in `actions`.
- **Deny precedence** — a near-miss (wrong field/purpose/class) is reported over `not_found`.

## Not yet enforced (additive — do not assume present)
- VC `proof` verification, `credentialStatus` revocation/suspension, presentations, storage caches.
