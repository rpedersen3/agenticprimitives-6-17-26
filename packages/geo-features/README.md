# @agenticprimitives/geo-features

Off-chain **geo claim** credentials + on-chain `GeoFeatureRegistry` helpers
([spec 251](../../specs/251-skills-and-geo-features.md)).

A **geo feature** is a public, versioned, on-chain anchor (geometry hash + coverage/source roots + a
coarse bbox; exact GeoJSON off chain). A **geo claim** — a Smart Agent's relation to a feature — is a
**private verifiable credential in that agent's vault** pointing to an on-chain `(featureId, version)`. The
association is never on chain (it would leak operational data). This SDK owns the credential shape, the
self/endorsed builders, the commitment/digest math, and a thin on-chain feature reader.

```ts
import { buildEndorsedGeoClaim, GEO_RELATION, geoFeatureExists } from '@agenticprimitives/geo-features';

const { credential, endorsementDigest } = buildEndorsedGeoClaim({
  chainId: 84532,
  subject: orgAgent,
  issuer:  validator,
  feature: { featureId, version: 1 },     // points to the on-chain GeoFeatureRegistry
  relation: GEO_RELATION.servesWithin,
  visibility: 'public-coarse',
  nonce,
});
// the issuer signs `endorsementDigest` (ERC-1271); the app stores `credential` in the subject's vault.
```

`GEO_KIND` is **lockstep** with `GeoFeatureRegistry.KIND_*` on chain (ADR-0009). **Neutral public
geography only** — a feature is never tagged with operational/sensitivity data (that's an off-chain app
policy). Skills are the independent sibling `@agenticprimitives/agent-skills` — there is no skill↔geo
mapping (a "skill X in region Y" fact is two separate claims).
