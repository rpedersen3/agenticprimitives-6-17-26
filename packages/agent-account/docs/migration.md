# Agent Account Migration Notes

## Current Status

`@agenticprimitives/agent-account` is experimental. Factory addresses, module
layout, and SDK methods may change before `1.0`.

## Canonical-Identifier-First

Older integrations sometimes treated the user's EOA or passkey as "the account."

New model ([ADR-0010](../../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)):

```text
credential  →  authenticates as  →  Smart Agent (canonical)
                     ↑
              agent-account owns this address
```

Migrate UI and APIs to display and key off the Smart Agent address. Keep
credentials as signer metadata only.

## CustodyPolicy Extraction

Custody-policy ABIs and SDK helpers moved to `@agenticprimitives/account-custody` (spec
213). Import `custodyPolicyAbi` from `custody`, not `agent-account`.

## Salt From Names

If CREATE2 salt previously included ENS-style names or profile labels, stop.
Redeployed addresses will differ — plan a one-time migration or accept new SAs
for affected users.

## Breaking Change Checklist

Update on every public API change:

1. `README.md` and `docs/api.md`
2. `docs/security.md` when invariants change
3. `capability.manifest.json`
4. `specs/201-agent-account.md`
5. `CLAUDE.md` drift triggers if boundaries move
