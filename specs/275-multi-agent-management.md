# Spec 275 — Multi-Agent Management in the Personal Trust Home

**Status:** draft (architect-of-record). Implements in `apps/demo-sso-next` (the live home, spec 234).
**Companion specs:** [220](./220-agent-identity-bootstrap.md) (deploy → name → custody → facets), [234](./234-white-label-trust-site.md) (the home this extends), [246](./246-related-agents-vault.md) (private person↔agent links), [229](./229-personal-central-auth.md) (name = universal identity), [253](./253-one-prompt-org-create.md) (one-prompt deploy+claim+approve).

## 0. Why this spec exists

Today a member connects and gets custody over their **Person Smart Agent** (works). They cannot yet, from the home, create and name the rest of their agent hierarchy. This spec adds the home capability + UI to **create, name, and manage** three more Smart Agents under the same root credential:

```
Person SA  (identity — today)
 ├─ Person Treasury Service SA   (the person's money agent)
 └─ Org SA                       (an organization the person controls)
      └─ Org Treasury Service SA (the org's money agent)
```

Every SA is deployed **on-chain** and its **name registered on the agent naming service** (subregistry + primary/reverse record). The *links* between them stay **private** (ADR-0025).

## 1. Decisions (locked)

| ID | Decision | Why |
|---|---|---|
| **MAM-D1** | Extend **`demo-sso-next`** (the live home), not the legacy `demo-sso` broker. | demo-sso-next is the spec-234 home where `createChildAgentForSite` already lives. |
| **MAM-D2** | **All four SAs are custodied by the member's ROOT credential** (passkey / SIWE / Google-KMS) — the same one that custodies the Person SA. No server custodian, no per-agent credential. | Canonical identity persists; credentials rotate (ADR-0011). One custody story for the whole tree. |
| **MAM-D3** | SAs **and names go on-chain** (`buildSubregistryRegisterCall` + `buildSetPrimaryNameCall` in `.impact`). The **links** (person→treasury, person→org, org→org-treasury) are **private vault credentials** (`related-agents`, ADR-0025) — NOT public on-chain edges. | The names are public identity; the org structure is the member's private business (ADR-0025). |
| **MAM-D4** | **Exact name or fail.** The member types the exact label; if it's free it's claimed, if taken the UI errors and asks for another. (NOT the forced-unique-suffix path used for auto-named org-create.) | The member is deliberately naming their own agents — they want the precise label. |
| **MAM-D5** | Each create is **one gasless prompt** (deploy + claim-name + pre-approve the standing grants in one userOp), reusing the spec-253 one-prompt pattern. | Matches the existing org-create UX; no multi-prompt regression. |
| **MAM-D6** | **Org Treasury is created FROM the Org SA's custody context** but still under the member's root credential; its link parent is the Org SA (org→org-treasury), not the person. | The treasury belongs to the org; the member controls both via the one root credential. |
| **MAM-D7** | The home keeps a **vault index** of the member's agents (`related-agents` credentials, keyed by holder); the **Manage Agents** UI lists them from `/connect/related-orgs` (extended to all agent kinds, not just orgs). | Survives refresh; one read path (ADR-0013); no new public surface. |

## 2. Non-goals

- No new on-chain contracts (naming + custody + approved-hash registry all exist).
- No public on-chain relationship edges (ADR-0025 — links are private).
- No payment behavior here — the Treasury SAs are plain `AgentAccount`s; what they DO with money is spec 243/272 (the payment stack), wired by the relying apps.
- No cross-member org sharing / membership invites (deferred; spec 253 MEMBERSHIP deferral still applies).

## 3. Reference: smart-agent patterns to port

`/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`) has **org + treasury + service-agent** creation under a single steward credential (its `CommitmentRegistry`/org model + the person↔org steward link). We port: (a) the **one-credential-many-agents** custody model (distinct CREATE2 salts, one signer); (b) the **org-has-a-treasury** structural notion. We DIVERGE: our links are **private vault credentials** (ADR-0025), not smart-agent's on-chain steward edges; our naming is the `.impact` subregistry, not smart-agent's name model.

## 4. Capability (connect-client)

Generalize the existing `createChildAgentForSite` into a kind-aware creator. New/changed exports in `apps/demo-sso-next/src/connect-client.ts`:

```ts
export type AgentKind = 'person-treasury' | 'org' | 'org-treasury';

export interface CreateAgentInput {
  kind: AgentKind;
  label: string;            // EXACT name the member typed (MAM-D4)
  parent: Address;          // person SA for person-treasury/org; the ORG SA for org-treasury (MAM-D6)
}

// Deploy + claim the EXACT name + pre-approve standing grants in ONE gasless userOp; record the
// private link credential. Reuses derivePasskeySa / deployAgent / buildSubregistryRegisterCall /
// buildSetPrimaryNameCall / buildRelatedAgentCredential. Throws "name taken" if the label isn't free.
export async function createManagedAgent(input: CreateAgentInput, onStep?): Promise<CreatedAgent>;

// List the member's created agents (all kinds) from the home vault.
export async function listManagedAgents(personAgent: Address): Promise<ManagedAgent[]>;
```

- **Exact-name claim (MAM-D4):** a new server route `GET /connect/name?label=<x>&exact=1` returns `{ name, node }` if `<x>.impact` is free, or `{ error: 'taken' }`. `buildClaimCallData` gains an `exact` mode that calls it and fails closed on `taken` (no suffix bump).
- **Custody (MAM-D2):** same `initMethod` the member used for their Person SA (passkey / wallet / Google-KMS), same `passkeySignHash` / `googleSignHash` signer — three credential paths, one creator.
- **Link (MAM-D3):** `buildRelatedAgentCredential({ holder: input.parent, relatedAgent: child, purpose: kind, body: { agentName } })` → stored in the home vault under `holder`. `org-treasury`'s holder is the Org SA, so the home indexes it under both the org (parent) and the person (root) for the tree view.

## 5. Server (demo-sso-next/server)

- `server/connect/name.ts`: add the `exact=1` branch — availability check on the exact label, no forced-unique fallback.
- `server/connect/related-orgs` (or a new `managed-agents`): return ALL related-agent credentials for the session's person (filter by `purpose ∈ {person-treasury, org, org-treasury}`), so the home can render the tree. Person-session-authed; no new public surface.

## 6. Home UI (demo-sso-next/src/components/portal)

A new **"Your agents"** portal section (`ManagedAgents.tsx`, rendered in `app/(portal)/you/page.tsx`):

- **Tree view:** Person SA (root, named) → Person Treasury · Org(s) → each Org's Treasury. Each row: name, address (basescan link), kind, "created" / "create" CTA.
- **Create flow:** pick a kind → type the exact name → one gasless prompt (deploy+claim+approve) → row appears. Inline "name taken — pick another" on MAM-D4 failure.
- **Reuse:** `AgentIdentityCard` / `OrgList` / `OrgDetail` patterns; the identity-chip + name display from the existing portal. White-label vocabulary stays in `src/whitelabel/`.

## 7. Invariants (MAM-INV)

- **MAM-INV-1** Every managed SA is deployed AND has a primary name before it appears as "created" (poll getCode like spec 253 SEC-011).
- **MAM-INV-2** Exact-name claim is fail-closed: a taken label NEVER silently becomes `<label>2` (MAM-D4).
- **MAM-INV-3** No public on-chain edge is written for any link (ADR-0025); the only on-chain writes are the SA deploy + the two naming calls (+ approved-hash for standing grants).
- **MAM-INV-4** All four SAs validate against the SAME root credential's signature (MAM-D2) — re-deriving any of them requires that credential.
- **MAM-INV-5** The home holds NO agent private key (it custodies nothing; the member's root credential signs every deploy — consistent with the spec-234 no-custodian rule).

## 8. Implementation order

1. `GET /connect/name?exact=1` (server) + `buildClaimCallData` exact mode.
2. `createManagedAgent` (connect-client) — generalize `createChildAgentForSite` over `AgentKind`, exact name, parent-keyed link.
3. `listManagedAgents` + the `managed-agents` read route.
4. `ManagedAgents.tsx` tree + create flow; wire into `/you`.
5. Deploy: push to master → Vercel auto-deploys demo-sso-next (HARD RULE — no CLI deploy).

## 9. Related

- ADR-0010 (SA is the canonical id), ADR-0011 (credential recovery), ADR-0025 (private agent links).
- Reuse map: `createChildAgentForSite`, `buildClaimCallData`, `derivePasskeySa`, `deployAgent`, `buildSubregistryRegisterCall`/`buildSetPrimaryNameCall` (agent-naming), `buildRelatedAgentCredential` (related-agents), `buildApprovedSiteDelegation` (spec 253).
