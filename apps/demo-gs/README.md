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
GCO Organization   a person creates an ORG (e.g. Hope Church Missions Team) that holds the GCO
                   (Great Commission Organization) role + posts a skill Need
KC Expert          an individual person agent with skills offers an expertise profile
Switchboard (Jane) proposes an explainable GCO-Need ↔ KC-Offering match
Global Church (Pete) the issuer (unchanged from demo-jp) issues the connection agreement
Accepted request   becomes an Agreement; confidential contact is released only on accept
Public read surface exposes open needs by skill / region / category (aggregate only)
```

## Roles (switch in the top bar) — a mirror of demo-jp

| Role | Is | Does | demo-jp analog |
| --- | --- | --- | --- |
| **GCO Org** | a **Great Commission Organization** (the demand side) — a person creates an org that holds the GCO role | Posts skill Needs, requests connections. **Create new GCO orgs in-app.** | Adopter |
| **KC Expert** | an **individual** Kingdom Consultant person agent with skills (supply) | Publishes an Offering, accepts/declines requests. **Create new KC people in-app.** | Facilitator |
| **Jane** | Global Switchboard (broker, operator) | Sees all needs + offerings, runs matching, manages the board + public signal | JP / Jill |
| **Pete** | Global Church (**issuer**, operator — NOT a GCO; same org as demo-jp) | Issues the connection agreement once a match is confirmed | Global Church / Pete |

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
