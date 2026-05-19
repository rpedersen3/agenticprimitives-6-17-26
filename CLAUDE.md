# agenticprimitives — Claude Code guide

This is a pnpm-workspace monorepo packaging four standalone capabilities extracted from `smart-agent` (branch `003-intent-marketplace-proposal`, located at `/home/barb/smart-agent`).

## Repo principles

- **Each package is independently usable.** A consumer should be able to `pnpm add @agenticprimitives/auth` alone and get value, without pulling delegation/KMS/MCP. Cross-package dependencies are explicit and one-directional (see below).
- **Specs precede code.** Every package owns a `spec.md`. Implementation must keep the spec in sync — if behaviour changes, the spec changes in the same PR.
- **TypeScript-first.** All packages are TS, ESM, target Node ≥ 20.
- **Don't fork smart-agent.** Pull the *patterns*, not the full code. We re-shape for reusability; keep package surfaces small and runtime-agnostic where possible.

## Dependency direction

```
auth          (no deps on other ap/* packages)
   ↑
delegation    (depends on auth's types only)
   ↑
kms           (depends on delegation for session→delegation binding)
   ↑
mcp-resources (depends on delegation; optionally kms)
```

Never introduce a cycle. If you need something the other direction, raise a type into a shared `types` package rather than adding a back-edge.

## Source-of-truth for behaviour

When implementing or modifying a package, the corresponding `specs/00X-*.md` is the contract. The `smart-agent` repo at `/home/barb/smart-agent` is the *reference implementation* — useful to read for context, but its layout, naming, and assumptions don't bind us.

## Modeled after

The product/repo structure draws from [1clawAI](https://github.com/1clawAI): each capability is a clearly-named, clearly-bounded, separately-publishable package. We use a single monorepo instead of polyrepo to keep development friction low.
