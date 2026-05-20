# demo-web-pro — Claude guide

## What this app is

The canonical home for **cross-cutting capability** demos — features that thread through ≥ 3 packages and carry their own threat model. Each capability has a guide co-located in `docs/<capability>/` + interactive flows under `src/flows/<capability>/`.

**Not** the simple SIWE → read-profile demo. That lives in [`apps/demo-web`](../demo-web/) (different audience: fast onboarding / marketing). This app is for **evaluators** who want to see hybrid recovery, threshold approval, org treasury, and recovery flows end-to-end.

## Layout

```
apps/demo-web-pro/
├── CLAUDE.md                       ← you are here
├── docs/
│   └── multi-sig/
│       ├── guide.md                ← developer tutorial
│       └── flows/
│           ├── hybrid-recovery.md  ← per-use-case walkthroughs
│           ├── threshold-approval.md
│           ├── org-treasury.md
│           ├── steward-attenuation.md
│           └── recovery.md
└── src/
    ├── main.tsx
    ├── App.tsx                     ← gallery + hash router
    └── flows/                      ← one subdir per use case
        ├── hybrid-recovery/        ← lands 6c.5
        ├── threshold-approval/     ← lands 6c.5
        ├── org-treasury/           ← lands 6c.5 + 6e
        ├── steward-attenuation/    ← post-H5 (cross-delegation)
        └── recovery/               ← lands post-6c.2-e (T6 Recovery flow)
```

## Capabilities demoed here

| Capability | Spec | Demo guide | Flow dirs |
| --- | --- | --- | --- |
| **Multi-sig + threshold policy** | [`specs/207`](../../specs/207-smart-account-threshold-policy.md) | [`docs/multi-sig/guide.md`](docs/multi-sig/guide.md) | `src/flows/{hybrid-recovery, threshold-approval, org-treasury, steward-attenuation, recovery}/` |
| **Treasury** (queued, phase 6e) | TBD | `docs/treasury/guide.md` (TBD) | `src/flows/treasury/` |
| **Argument-level caveats** (queued, [`specs/208`](../../specs/208-argument-level-caveats.md)) | spec 208 | `docs/argument-caveats/guide.md` (TBD) | `src/flows/argument-caveats/` |

When you add a flow:

1. Land the corresponding spec in `specs/2XX-*.md` first (spec-first doctrine).
2. Add `docs/<capability>/flows/<use-case>.md` walkthrough.
3. Add `src/flows/<use-case>/` implementation referencing the walkthrough.
4. Update `App.tsx` `USE_CASES` array (badge: `stub` → `in-flight` → `live`).
5. Update `docs/architecture/cross-cutting-capabilities.md` (top-level index).
6. Update each participating package's `CLAUDE.md` "Capabilities this package participates in" section.
7. Run `pnpm check:cross-cutting-capabilities` to confirm all four artifacts wired.

## Doctrine pinned to this app

- **Multi-sig is safety + recovery, not a "ceremony."** Every flow's UI copy + permission cards reflect this: "2 approvals required to let Agent X spend up to 10 USDC/day" — NEVER "sign this hash."
- **Hybrid is the default consumer mode.** Even within `demo-web-pro`, when a flow creates an account it defaults to hybrid. `single` mode is reserved for the simpler `demo-web`.
- **Permission UX is security.** Every caveat-bearing delegation issues a permission card. Argument-level caveats (spec 208) make these cards more specific over time.
- **One AgentAccount substrate.** No flow forks the account contract. Mode is policy state on the same contract.

## Running this app

```bash
pnpm dev                              # everything (a2a + mcp + this app + demo-web)
pnpm --filter @agenticprimitives-demo/web-pro dev    # just this app on port 5273
```

Port `5273` (deliberately different from `demo-web`'s 5173 so both run side-by-side in dev).

## Related

- [Top-level cross-cutting capability index](../../docs/architecture/cross-cutting-capabilities.md)
- [`apps/demo-web`](../demo-web/) — simple demo (single mode, fast wow path)
- [`apps/demo-a2a`](../demo-a2a/) — a2a Worker this app talks to
- [`apps/demo-mcp`](../demo-mcp/) — MCP Worker this app talks to (also home of the audit demo guide)

## Generated files (ignore)

`dist/`, `node_modules/`, `.wrangler/`.
