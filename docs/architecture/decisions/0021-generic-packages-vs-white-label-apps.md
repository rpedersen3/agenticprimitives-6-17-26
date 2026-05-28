# ADR-0021 — Packages are generic trust building blocks; white-label / vertical / deployment code lives in apps

**Status:** Accepted (2026-05-28; broadened from the original "no deployment-domain
code in packages").
**Related:** [ADR-0010](./0010-smart-agent-canonical-identifier.md) (the address is the
identity; names/origins/branding are facets), [spec 234](../../../specs/234-white-label-agentic-trust-site.md)
(the white-label Agentic Trust Site this rule protects), [spec 229](../../../specs/229-personal-central-auth.md)
+ [spec 231](../../../specs/231-personal-subdomain-endpoint.md) + [spec 232](../../../specs/232-demo-sso-vercel-nextjs-migration.md)
(per-person subdomains + the SSO/A2A split), the package-boundary doctrine (root
CLAUDE.md “Package boundaries”).

---

## Context

The product is a **white-label central Agentic Trust Site** (`demo-sso-next`) that
multiple **relying apps** (`demo-org` = the Faith App / Impact Portal, plus
community/service apps) integrate with (spec 234). A given deployment is a
**vertical white-label** — e.g. a **faith** org — with its own branding, copy,
onboarding steps, enabled trust services, and domains.

That white-label/vertical material is genuinely useful, but it is **not** a
property of the reusable capability packages. If branding, faith content, vertical
onboarding logic, or concrete hostnames leak into `packages/*`, the packages stop
being a generic substrate: a different vertical (or a second deployment) can't
reuse them without editing library code, and "which white-label is this" smears
across layers. The diagram's own principle: *the site is a reusable control plane;
domain-specific apps are **configured**, not hardcoded; generic trust building
blocks + domain-specific extension modules.*

## Decision

**`packages/*` are GENERIC, reusable trust building blocks. All white-label /
vertical / deployment-specific code lives at the app layer (`apps/*`), via
app-level config/extension modules.** Packages MUST NOT contain:

- **Branding / vertical content** — faith vocabulary (church, ministry,
  congregation, discipleship, parish, denomination, gospel, scripture, sermon),
  product/white-label names, marketing copy, logos, themes.
- **Vertical-specific flows** — faith-specific onboarding steps, impact-portal
  features, "which apps a faith org connects" — these are app config, not library.
- **Deployment specifics** — concrete hostnames (`impact-agent.me`/`.io`), the
  `demo.agent` subregistry, hosting providers (`*.pages.dev`, `*.workers.dev`,
  `vercel`), host/subdomain parsing.

**Allowed in packages:** the generic primitives only — agent accounts, custody,
delegation, naming (the `.agent` TLD protocol), profiles, ontology, connect/SSO
token + convergence logic, MCP/A2A runtime contracts. Generic placeholders in
docs (`<handle>.<connect-domain>`, `app.example`) are fine.

**The white-label is data, not code-in-packages** (spec 234): a deployment's
branding, copy, onboarding, enabled services, and domains are an **app-level
config object** the apps consume; the packages take that config as input, never
embed it.

## Enforcement

`pnpm check:no-domain-in-packages` (`scripts/check-no-domain-in-packages.ts`) scans
`packages/*/src/**` and fails the build on the automatable subset: concrete
hostnames / hosting providers + the `demo.agent` subregistry + faith-vertical
vocabulary. Wired into `pnpm check:all`. The broader "no branding / no vertical
flow in packages" is doctrine, enforced by review + the per-package CLAUDE.md
boundaries + `check:forbidden-terms`.

## Consequences

- Packages stay reusable across verticals + deployments; a new white-label (faith,
  community, service) is an **app config change**, not a library edit.
- The white-label config schema + theming + onboarding config live in
  `apps/demo-sso-next` (spec 234), consumed by the generic core.
- Host-context / subdomain / domain literals correctly live in `apps/*`
  (`src/lib/domain.ts`) — intentional deployment glue, not a DRY violation.
- Adding a hostname, faith term, or branding string to a package is a hard error.
