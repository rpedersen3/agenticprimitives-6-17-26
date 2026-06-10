# @agenticprimitives/related-agents

**Some relationships are nobody else's business.** When a person creates an organization through a relying app, that person↔org link is among the most sensitive facts in the whole identity stack — and the default in most systems is to leak it: into an app database, into a public graph, into an index. This package makes the private path the only path. A person↔org link is a **private, holder-resident vault credential** — never an on-chain relationship, never relying-app-local person→org state ([ADR-0025](../../docs/architecture/decisions/0025-related-agent-links-are-private.md)). The public trust graph stays org↔org, and only on explicit bilateral consent.

Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

It ships three things: the credential builder that links a person to a **related agent** (e.g. an org they created via a relying app), the scoped-delegation read caveats a grantee receives, and the list-query wire shapes the session broker serves — shapes that deliberately carry **no person id**, so even the listing surface cannot leak the link.

Composes [`verifiable-credentials`](../verifiable-credentials) (DOLCE+DnS Situation + EIP-712 proof) and [`delegation`](../delegation) (caveats). Sibling of [`agent-relationships`](../agent-relationships), which owns *public, on-chain* edges only — the two are firewalled by design: this package may not import that one, and person↔org is never written as an edge.

## Usage

```ts
import { buildRelatedAgentCredential, relatedAgentReadCaveats } from '@agenticprimitives/related-agents';
import { signCredential } from '@agenticprimitives/verifiable-credentials';

// The broker mints this during org-create, signed by the person's ROOT credential:
const unsigned = buildRelatedAgentCredential({
  holder: personSA, relatedAgent: orgSA,
  purpose: 'adopter-org', requestedBy: 'relying-app',
  issuerCaip10: `eip155:84532:${personSA}`,
  body: { agentName: 'acme-co.agent' },
  validFrom: new Date().toISOString(),
});
const credential = await signCredential(unsigned, personRootSigner);

// The scoped org→grantee delegation caveats:
const caveats = relatedAgentReadCaveats({
  enforcers: { timestamp, value, allowedTargets },
  validUntil, allowedTargets: [orgSA],
});
```

The credential is self-issued (holder = issuer = the person's Smart Agent), `visibility = private`, holder-resident. The caveat set a grantee receives is time-bound, zero-value, and target-scoped — the grantee can *read* the org, not move anything. `purpose` is a free string supplied by the app; this package carries no vertical vocabulary.

## How it's different

The competing pattern is **app-local membership tables and public social graphs** — either the relying app owns the person→org row (and the user cannot take it elsewhere or revoke the app's knowledge of it), or the link is published to a graph anyone can crawl:

- **Holder-resident, not app-resident.** The credential lives in the person's vault; the relying app gets a scoped, revocable, time-bound delegation — never the link itself.
- **Privacy is structural, not a setting.** There is no "public" flag on a person↔org link. The on-chain graph (`agent-relationships`) is reserved for org↔org edges with explicit bilateral consent.
- **Anchored to canonical identities.** Both ends are Smart Agent addresses, so the private link survives credential rotation and name changes — the same facet doctrine the rest of the substrate runs on.

## Boundaries

- **Storage is not here.** The vault (broker-home KV) and the query endpoints are app/broker-level; this package is shape + builder only.
- **The VC envelope and signing** belong to `verifiable-credentials`; **delegation minting** belongs to `delegation`. This package composes both, owns neither.
- **Wire shapes** — `RelatedAgentLink`, `ListRelatedAgentsResponse`, `DelegatedAgentLink`, `ListDelegatedAgentsResponse` — carry no person id.

Canonical spec: [`specs/246-related-agents-vault.md`](../../specs/246-related-agents-vault.md).

## Validation

```bash
pnpm --filter @agenticprimitives/related-agents typecheck
pnpm --filter @agenticprimitives/related-agents test
```

## Status

**w1-foundational** — the credential builder, caveat set, and wire shapes above are what ships today; storage and serving land at the app/broker layer. Testnet/pilot-ready; production launch is gated on the public checklist in the root [`README.md`](../../README.md#status--honest-version) — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

## License

UNLICENSED (internal monorepo, not published).
