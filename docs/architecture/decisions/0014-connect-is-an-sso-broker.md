# ADR-0014 — Agentic Connect is an SSO broker at a central origin

**Status:** Accepted (2026-05-25).
**Related:** [spec 224](../../../specs/224-agentic-connect.md), [ADR-0010](./0010-smart-agent-canonical-identifier.md), [ADR-0016](./0016-canonical-agent-id-is-the-sso-subject.md), [spec 220](../../../specs/220-agent-identity-bootstrap.md).

---

## Context

`@agenticprimitives/connect` provides single-sign-on across relying websites:
a user proves a credential once and receives an `AgentSession` bound to their
canonical Smart Agent. The headline credential is a **passkey**, and WebAuthn
public-key credentials are **scoped to a relying-party (RP) origin** — a
credential created for origin A cannot be discovered or asserted by origin B.
If every relying website ran its own passkey ceremony, each would be a separate
RP and users would re-enroll per site. That defeats SSO.

## Decision

> **Connect is an SSO *broker* hosted on one central origin, not a component
> embedded in arbitrary relying websites.**

- Passkey/SIWE/OIDC ceremonies run on the **Connect origin** (e.g.
  `connect.<host>`). Relying sites open Connect via redirect/popup and receive
  an `AgentSession` (a signed token) back — they never run the ceremony.
- The passkey RP id is the Connect origin, so one enrollment works for every
  relying site.
- `connect` core is a **state machine + token issuer**, transport-agnostic; the
  broker app (`apps/demo-sso`) is the hosted origin. The package does not assume
  a specific web framework.

### Forbidden

- Embedding the passkey ceremony in each relying website (per-site RP → no SSO).
- A relying site receiving raw credential material instead of an `AgentSession`.

## Consequences

**Positive:** one credential enrollment serves all relying sites; the security
surface (challenge generation, origin validation, OIDC secret handling) is
centralized and auditable; relying sites integrate by redirect, not by trusting
embedded crypto.

**Negative:** the Connect origin is a trust concentration — it must be operated
with the same rigor as an IdP (rate limits, origin allowlist, key rotation).
Cross-origin token delivery needs careful `redirect_uri`/audience binding (see
[ADR-0016](./0016-canonical-agent-id-is-the-sso-subject.md) + spec 224 security
section).

## Cross-references

- [spec 224 — Agentic Connect](../../../specs/224-agentic-connect.md)
- WebAuthn RP-origin scoping; OAuth 2.0 / OIDC redirect-URI + audience binding.
