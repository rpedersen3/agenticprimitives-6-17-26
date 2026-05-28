# ADR-0021 — No deployment-domain code in packages (domain logic is app-level only)

**Status:** Accepted (2026-05-28).
**Related:** [ADR-0010](./0010-smart-agent-canonical-identifier.md) (the address is the
identity; names/origins are facets), [spec 229](../../../specs/229-personal-central-auth.md)
+ [spec 231](../../../specs/231-personal-subdomain-endpoint.md) + [spec 232](../../../specs/232-demo-sso-vercel-nextjs-migration.md)
(per-person subdomains + the SSO/A2A domain split), the package-boundary doctrine
(root CLAUDE.md “Package boundaries”; `tool-policy`/`types` are transport-agnostic).

---

## Context

The deployment is increasingly **domain-centric**: people get per-person subdomains
(`<handle>.impact-agent.me` for SSO, `<handle>.impact-agent.io` for A2A), names live
under a `demo.agent` permissionless subregistry, and hosting spans Cloudflare Pages /
Workers and Vercel. That domain knowledge is genuinely useful — but it is a
**deployment concern**, not a property of the reusable capability packages.

If concrete hostnames, the `demo.agent` subregistry, hosting-provider strings, or
host/subdomain parsing leak into `packages/*`, the packages stop being portable: a
second deployment (different domains, different host) can't reuse them without
editing library code, and "where is this deployed" becomes smeared across layers.
An audit on 2026-05-28 found only minor leaks — all in doc-comment examples
(`agent-profile` `AUTH_ORIGIN`, an `agent-naming` ABI comment, a `connect-auth`
SIWE example) — confirming the boundary is real and worth pinning before it erodes.

## Decision

**Deployment-domain code lives ONLY at the app layer (`apps/*`); `packages/*` are
domain- and deployment-agnostic.** Concretely, packages MUST NOT contain:

- concrete hostnames — `impact-agent.me`, `impact-agent.io`, any real origin;
- the demo `.agent` **subregistry** (`demo.agent`) — a deployment's child registry;
- hosting-provider strings — `*.pages.dev`, `*.workers.dev`, `vercel` / `cname.vercel-dns`;
- subdomain/host parsing or "which domain serves this agent" routing.

Apps own all of the above and **pass values in** (config / env / function args).
Each app SHOULD centralize its domain literals in one module (e.g.
`apps/<app>/src/lib/domain.ts`) rather than scattering them.

**Allowed in packages:** the `.agent` **TLD** itself (`AGENT_TLD`, owned by
`agent-naming`) — that is the naming *protocol*, not a deployment domain — and
generic placeholders in docs (`<handle>.<connect-domain>`, `app.example`).

## Enforcement

`pnpm check:no-domain-in-packages` (`scripts/check-no-domain-in-packages.ts`) scans
`packages/*/src/**` for the forbidden patterns and fails the build on any hit. Wired
into `pnpm check:all`. Tests/fixtures are out of scope of the scan (they may use
example data), but shipped source must be clean.

## Consequences

- Packages stay reusable across deployments; a new domain is an app-config change.
- The host-context / subdomain logic (`parseAgentSubdomain`, `agentNameForLabel`,
  the `origins.ts` wildcard matcher, `host.ts`) correctly lives in `apps/*` and is
  duplicated there if needed — that duplication is intentional (it's deployment
  glue), not a DRY violation to "fix" by hoisting into a package.
- Adding a domain literal to a package is now a hard error, not a review nit.
