# demo-gs — Global Switchboard

A relying-app prototype demonstrating a **Global Switchboard-style intent broker**: a GCO Organization
Agent declares a skill-based **Need**, a KC Person Agent publishes an expertise **Offering**, and the app
turns shared skill / geo / cause anchors into an explainable **Need → Offering → IntentMatch → Agreement**
flow. It is a sibling of [`demo-jp`](../demo-jp) — the same intent-spine primitive, applied to a *skills*
marketplace instead of People-Group adoption. See [spec 250](../../specs/250-demo-gs-global-switchboard.md).

> **Demo only.** "Global Switchboard", "GCO", "KC" are placeholders; no real-program affiliation. No real
> connections are brokered.

## The loop

```
GCO (Pete / Global Church)  needs help with a skill in a geo / cause context
KC  (an Expert)             offers a skill profile, optionally scoped by geo / cause / language
Switchboard (Jane)          proposes an explainable GCO-Need ↔ KC-Offering match
Accepted request           becomes an Agreement; confidential contact is released only on accept
Public read surface        exposes open needs by skill / region / category (aggregate only)
```

## Personas (switch in the top bar)

| Persona | Role | Does |
| --- | --- | --- |
| **Pete** | Global Church (a GCO) | Posts skill Needs, reviews matches, requests connections |
| **Jane** | Global Switchboard (broker) | Sees all needs + offerings, runs matching, manages the board, sees the public signal |
| **Expert** | A KC member | Publishes an expertise Offering, accepts / declines connection requests |

## v1 status

Fixture-driven (spec 250, Phase 0/1): identity- and chain-decoupled, with mocked taxonomy + a localStorage
store. The store + adapter seams are shaped for the deferred phases — real demo-sso session + scoped
grants, vault persistence, on-chain registries, the GC graph + C-Box skill registry, the read-only
Switchboard (Pattern-A) bridge, and the public read API.

## Develop

```bash
pnpm --filter @agenticprimitives-demo/gs dev        # http://localhost:5673
pnpm --filter @agenticprimitives-demo/gs typecheck
pnpm --filter @agenticprimitives-demo/gs test
pnpm --filter @agenticprimitives-demo/gs build
```
