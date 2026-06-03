# @agenticprimitives/related-agents

Private, holder-resident credentials that link a person to a **related agent** (e.g. an org they
created via a relying app) — plus the scoped-delegation read caveats a grantee receives, and the
list-query wire shapes Connect serves.

A person↔org link is a **private vault credential**, never an on-chain relationship and never
relying-app-local person→org state (see [ADR-0025](../../docs/architecture/decisions/0025-related-agent-links-are-private.md)).
The public trust graph stays org↔org and only on explicit consent.

Composes [`verifiable-credentials`](../verifiable-credentials) (DOLCE+DnS Situation + EIP-712 proof) and
[`delegation`](../delegation) (caveats). Sibling of [`agent-relationships`](../agent-relationships),
which owns on-chain edges only.

## Usage

```ts
import { buildRelatedAgentCredential, relatedAgentReadCaveats } from '@agenticprimitives/related-agents';
import { signCredential } from '@agenticprimitives/verifiable-credentials';

// Connect mints this during org-create, signed by the person's ROOT credential:
const unsigned = buildRelatedAgentCredential({
  holder: personSA, relatedAgent: orgSA,
  purpose: 'adopter-org', requestedBy: 'demo-jp',
  issuerCaip10: `eip155:84532:${personSA}`,
  body: { agentName: 'grace-community.impact' },
  validFrom: new Date().toISOString(),
});
const credential = await signCredential(unsigned, personRootSigner);

// The scoped org→grantee delegation caveats:
const caveats = relatedAgentReadCaveats({
  enforcers: { timestamp, value, allowedTargets },
  validUntil, allowedTargets: [orgSA],
});
```

Canonical spec: [`specs/246-related-agents-vault.md`](../../specs/246-related-agents-vault.md).
