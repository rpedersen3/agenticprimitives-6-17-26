# ADR-0017 — OIDC / social login is a control facet, not custody authority; step-up required

**Status:** Accepted (2026-05-25).
**Related:** [spec 224](../../../specs/224-agentic-connect.md), [spec 200](../../../specs/200-connect-auth.md), [ADR-0011](./0011-credential-recovery-and-re-association.md), [ADR-0016](./0016-canonical-agent-id-is-the-sso-subject.md).

---

## Context

Agentic Connect will accept OIDC / social providers (Google, etc.) as an entry
flow so people can sign in without first owning a wallet or passkey. There is a
strong temptation to treat "signed in with Google" as equivalent to controlling
the Smart Agent — i.e. to let an OIDC login authorize custody changes, spend, or
delegation issuance. That would make a social IdP a single point of takeover for
the canonical identity, defeating ADR-0010/0011's whole premise that the SA's
authority is governed by its on-chain custody policy.

## Decision

> **An OIDC / social identity is a *login facet* that authenticates a session at
> a stated assurance level. It is NOT custody authority. Any custody-class
> action requires step-up to a custody-grade credential governed by the on-chain
> policy.**

- OIDC login yields an `AgentSession` with a **lower `Assurance`** than a
  passkey/SIWE control credential. The session is enough to read, to act within
  pre-authorized low-risk bounds, and to *initiate* flows — not to move value or
  rotate credentials.
- **Custody-class actions** (credential add/replace/remove, custody-policy
  changes, high-risk spend, delegation issuance above a threshold) require
  **step-up**: re-authentication with a custody-grade credential (passkey/SIWE/
  hardware) that the on-chain custody policy recognizes. The step-up is
  evaluated on-chain, not by Connect.
- The OIDC subject is recorded in `identity-directory` as a **facet with
  evidence** (issuer + subject claim + assurance), exactly like any other
  credential facet — never as the identity itself.
- Connect's OIDC implementation MUST use PKCE + `state` + `nonce`, validate
  issuer + audience, and bind the resulting session to the
  `CanonicalAgentId`, not to the raw OIDC `sub`.

### Forbidden

- Authorizing custody changes, credential rotation, or above-threshold
  value movement from an OIDC-only session.
- Treating the OIDC `sub` claim as the canonical agent id (it is a facet key
  into the directory, resolved to a `CanonicalAgentId`).
- Skipping PKCE/state/nonce or audience validation in the OIDC flow.

## Consequences

**Positive:** social login lowers onboarding friction without making a social
IdP a takeover vector; assurance levels make the security posture explicit and
machine-checkable; step-up keeps custody authority on-chain.

**Negative:** the product must implement and clearly communicate two tiers
(login vs. custody-grade) and the step-up UX; `Assurance` must be threaded
through every authorization decision; an OIDC subject that resolves to zero
agents needs an explicit "no agent yet — bootstrap" path (spec 224 convergence
rules).

## Cross-references

- [spec 224 — Agentic Connect](../../../specs/224-agentic-connect.md) (entry flows, step-up, assurance)
- [spec 200 — connect-auth](../../../specs/200-connect-auth.md) (OIDC method impl)
- [ADR-0011](./0011-credential-recovery-and-re-association.md) (credential recovery is custody-governed)
