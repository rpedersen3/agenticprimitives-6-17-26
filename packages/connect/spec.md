# Spec — @agenticprimitives/connect

The authoritative spec is [`specs/224-agentic-connect.md`](../../specs/224-agentic-connect.md)
(broker model, AgentSession shape, token design §4, redirect/response §4a, entry
flows + convergence §5, OIDC §6, WebAuthn §7, step-up §8, anti-patterns §9).

Decision record: [ADR-0014 — Connect is an SSO broker at a central origin](../../docs/architecture/decisions/0014-connect-is-an-sso-broker.md).
Subject + no-owner: [ADR-0016](../../docs/architecture/decisions/0016-canonical-agent-id-is-the-sso-subject.md).
OIDC/social = login facet: [ADR-0017](../../docs/architecture/decisions/0017-oidc-social-is-a-login-facet-not-custody.md).
Security controls CN-1…CN-12: [`docs/audits/sso-wave-audit-findings.md`](../../docs/audits/sso-wave-audit-findings.md).

This file is the per-package pointer required by `check:package-docs`; do not
duplicate the spec here — edit spec 224.
