# @agenticprimitives/related-agents — AUDIT

**Surface:** pure shape + caveat builders. No network, no storage, no signing, no on-chain calls.

## Invariants

- **RA-1 — never an on-chain edge.** This package emits a holder-resident credential + delegation
  caveats only. It MUST NOT import or call `agent-relationships` / any registry write. (ADR-0025.)
- **RA-2 — self-issued + private.** `buildRelatedAgentCredential` sets `roles.issuer == roles.holder`
  and `participants.visibility` defaults to `private`. Public requires an explicit override by the app.
- **RA-3 — no vocabulary.** `purpose` / `requestedBy` are opaque strings; no vertical terms, hostnames,
  or branding may be hardcoded here (ADR-0021; `check:no-domain-in-packages` + `check:forbidden-terms`).
- **RA-4 — deployment-agnostic caveats.** `relatedAgentReadCaveats` takes enforcer addresses as args;
  no enforcer address is hardcoded.

## Checklist

- [x] License (MIT) + AUDIT.md + README.md + `publishConfig.access=public`.
- [x] No `apps/*` / MCP / transport imports; only `types` + `verifiable-credentials` + `delegation`.
- [x] Unit tests: credential self-issued + private; proofHash determinism; caveat-set shape.
