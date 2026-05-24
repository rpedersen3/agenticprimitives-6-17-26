# @agenticprimitives/agent-identity

Typed off-chain profile schema (`AgentCard`) + CAIP-10 chain-agnostic
account identifiers + endpoint-verification methods for Smart Agents.

Where [`agent-naming`](../agent-naming) resolves *names → addresses*
and [`agent-relationships`](../agent-relationships) records *edges
between agents*, this package owns the **profile layer**: the typed
JSON manifest an agent publishes about itself, the deterministic
content-hash that anchors it on chain, and the verification methods
that prove an MCP / A2A endpoint actually belongs to the claimed
agent.

## Status

**Phase 1** — pure SDK + spec + API skeleton. Read methods on the
client throw `I Phase 2`; write methods throw `I Phase 4`. The shape
is locked so demos can be written against it before contracts deploy.

See [`specs/217-agent-identity.md`](../../specs/217-agent-identity.md)
for the full design + the phase plan, and:

- [ADR-0007](../../docs/architecture/decisions/0007-agent-identity-stack-three-packages.md)
  — why the identity stack is three packages, not one.
- [ADR-0008](../../docs/architecture/decisions/0008-caip10-nativeid-record-predicate.md)
  — why we expose CAIP-10 `nativeId` rather than generate UAIDs.

## Install

This package is workspace-internal in the agenticprimitives monorepo
and not yet published.

## Usage

### Profile authoring + content-hash

```ts
import {
  canonicalProfileJson,
  profileContentHash,
  type AgentCard,
} from '@agenticprimitives/agent-identity';

const profile: AgentCard = {
  type: 'mcpServer',
  displayName: 'Acme Tools',
  endpoint: 'https://mcp.acme.example/',
  verification: ['dns-txt', 'signed-url'],
  tools: ['scheduler.create', 'scheduler.cancel'],
};

const json = canonicalProfileJson(profile);
//   '{"displayName":"Acme Tools","endpoint":"…","schemaVersion":1,"tools":["…","…"],"type":"mcpServer","verification":["…","…"]}'
const hash = profileContentHash(profile);
//   0x… — keccak256 of the canonical JSON UTF-8 bytes.
```

The hash matches the `metadata-hash` record predicate in
[`agent-naming/records`](../agent-naming/src/records.ts). Two
semantically-equal profiles produce identical hashes (sorted keys,
fixed numeric format, no whitespace).

### CAIP-10 chain-agnostic account identifiers

```ts
import {
  buildCaip10Address,
  parseCaip10,
  isValidCaip10,
  CAIP10_NAMESPACE_ALLOWLIST,
} from '@agenticprimitives/agent-identity/caip10';

const id = buildCaip10Address({
  namespace: 'eip155',
  reference: '84532',
  address: '0xAbCd…1234',
});
//   'eip155:84532:0xabcd…1234'   ← address half lowercased

const parts = parseCaip10(id);
//   { namespace: 'eip155', reference: '84532', address: '0xabcd…1234' }
```

Encoder is strict (allowlist-enforced); decoder is permissive
(grammar-valid only). Per ADR-0008, we do **not** generate UAID
strings — consumers may derive UAIDs locally by canonical-JSON-hashing
the CAIP-10 + their own context.

### Identity client (Phase 2+)

```ts
import { AgentIdentityClient } from '@agenticprimitives/agent-identity';

const identity = new AgentIdentityClient({
  rpcUrl: 'https://base-sepolia.g.alchemy.com/v2/…',
  chainId: 84532,
});

const profile = await identity.fetchProfile('0x…');
const verified = await identity.verifyEndpoint('0x…', 'https://mcp.example/', ['dns-txt', 'signed-url']);
const hash = await identity.publishProfile({ agent: '0x…', profile: { type: 'person', displayName: 'Alice' } });
```

`fetchProfile` round-trip-verifies: the returned profile's
`profileContentHash` MUST match the on-chain `metadata-hash` record,
else `ProfileHashMismatchError`.

## Subpath exports

- `@agenticprimitives/agent-identity/caip10` — CAIP-10 helpers only,
  no client baggage.
- `@agenticprimitives/agent-identity/profile` — canonical JSON +
  content-hash helper.

## Security invariants

- Profile JSON content-hash is **deterministic** (sorted keys, fixed
  numeric format, refused non-finite numbers).
- `metadata-hash` MUST match `profileContentHash(profile)` (client
  refuses divergent profiles — anti-mutation invariant).
- Verification methods are **explicit, not implicit** — callers
  declare which method they're invoking; the client doesn't silently
  pick one.
- CAIP-10 encoder is strict (allowlist); decoder is permissive
  (grammar-valid only) per ADR-0008.
- No raw passkey material in profiles (only `credentialIdDigest`).
- No UAID generation (refused per ADR-0008).

See `AUDIT.md` for the package audit + open findings.

## License

UNLICENSED (internal monorepo, not published).
