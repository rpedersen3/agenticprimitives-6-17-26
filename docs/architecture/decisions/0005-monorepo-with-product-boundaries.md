# ADR-0005 — Monorepo with product boundaries, not polyrepo and not single SDK

**Status:** accepted (2026-05-19)

## Context

Two tempting alternatives to the current design:

- **Polyrepo** (the 1clawAI pattern): one repo per package. Strong "one job per repo" feel; high cross-repo coordination cost; manual version syncing.
- **Single SDK** (the MetaMask DTK pattern): one umbrella package with subpath exports. Simple consumer story; couples release cadence; can't claim "each package usable standalone."

We chose neither.

## Decision

A single pnpm-workspaces monorepo with **independently-publishable** scoped packages under `@agenticprimitives/*`. Specifically:

- 7 packages at v0 (`types` + 6 capability packages), each with its own `package.json`, `capability.manifest.json`, `CLAUDE.md`, `README.md`, `spec.md`.
- Each package has its own versioning (semver, independent bumps).
- Per-package public API surface declared in `capability.manifest.json:publicExports` and enforced by CI.
- One job per package (1claw discipline) without one repo per job (1claw overhead).
- Strict dependency direction (`types → identity-auth → agent-account → ...`); no back-edges.

## Consequences

- A consumer can `pnpm add @agenticprimitives/tool-policy` and get value without inheriting our delegation or MCP opinions.
- Changes that span packages (e.g., a new caveat type that affects `delegation` + `mcp-runtime`) land in one PR with consistent versioning.
- The agent-routing model (`CLAUDE.md` per package) works because each package is a sized loadable unit.
- The cost: more package boilerplate than a single SDK. Mitigated by the manifest + CI guardrails.

## What this rules out

- We will **not** ship a `@agenticprimitives/sdk` facade that re-exports everything as one entry. That would re-introduce the single-SDK coupling we deliberately avoided. (We may add one *later* if 3+ consumers explicitly ask for it — spec 101 §5 records this guard.)
- We will **not** ship one repo per package. The cross-package coordination tax isn't worth it at our scale, and the manifest discipline gives us 90% of the polyrepo discipline benefits inside the monorepo.

## To reverse this

The polyrepo case strengthens only if cross-package coordination cost is approaching zero (e.g., we have 10+ external maintainers per package). The single-SDK case strengthens only if every realistic consumer takes every package. Neither holds.

## References

- [`specs/100-package-boundary-doctrine.md`](../../../specs/100-package-boundary-doctrine.md) §6 (naming) and §9 (Claude routing)
- [`specs/101-v0-package-proposal.md`](../../../specs/101-v0-package-proposal.md) §1 (the 7-package set)
- 1clawAI polyrepo: https://github.com/1clawAI
- MetaMask DTK single-SDK: https://github.com/MetaMask/delegation-toolkit
