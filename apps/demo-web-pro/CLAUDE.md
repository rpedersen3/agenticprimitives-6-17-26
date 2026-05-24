# demo-web-pro — Claude guide

## What this app is

The canonical **Treasury Service Agent** demo from spec 211. The old cross-capability gallery is gone; this app tells one story end-to-end:

> two passkey-controlled Person Smart Agents create an Organization Smart Agent, create a Treasury Service Agent, and move authority toward agent-to-agent stewardship.

**Not** the simple SIWE → read-profile demo. That lives in [`apps/demo-web`](../demo-web/). This app is for evaluators who want to see the agent-centric model across web app, demo-a2a, contracts, and future MCP stewardship.

## Layout

```
apps/demo-web-pro/
├── CLAUDE.md                       ← you are here
├── docs/
│   ├── README.md
│   └── treasury-service-agent/
│       └── guide.md                ← current web/a2a/MCP interaction guide
└── src/
    ├── main.tsx
    ├── App.tsx                     ← mounts TreasuryShell
    ├── treasury/                   ← act ladder + UI shell
    └── lib/                        ← passkey, gasless, custody, demo state helpers
```

## Capabilities demoed here

| Capability                   | Spec                                                          | Demo guide                                                                     | Implementation            |
| ---------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| **Treasury Service Agent**   | [`specs/211`](../../specs/211-treasury-service-agent-demo.md) | [`docs/treasury-service-agent/guide.md`](docs/treasury-service-agent/guide.md) | `src/treasury/`           |
| **Agent-centric delegation** | [`specs/212`](../../specs/212-agent-centric-delegation.md)    | same guide                                                                     | planned Acts 5–6          |
| **Treasury ontology**        | [`specs/210`](../../specs/210-treasury-service-agent.md)      | same guide                                                                     | UI vocabulary + act model |

When you add an act:

1. Land the corresponding spec in `specs/2XX-*.md` first (spec-first doctrine).
2. Add/update `docs/treasury-service-agent/guide.md`.
3. Add/update `src/treasury/acts.ts` and `src/treasury/acts/<ActName>.tsx`.
4. Mark act status honestly: `not-started` → `simulated` → `live`.
5. Update e2e coverage in `tests/e2e/pro-specs/`.

## Doctrine pinned to this app

- **Agent-centric, not user-centric.** The human controls one Person Smart Agent via passkey. Authority flows between Smart Agents.
- **Treasury is a Service Agent, not a wallet.** The account is the embodiment; the agent is the identity.
- **Admin authority creates stewardship.** Admin changes are deliberate; stewardship permissions are bounded operational authority.
- **Web app is not authority.** Web builds UX and calldata. Contracts, demo-a2a, and future MCP verification enforce the authority model.
- **Do not revive the gallery.** This app answers one product question, one story.

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
