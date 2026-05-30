# @agenticprimitives/agent-profile

Typed **profile facet** for Smart Agents — AgentCard schema, CAIP-10 helpers,
and endpoint-verification methods.

The canonical identifier is the Smart Agent address (`agent-account`). This
package publishes and verifies off-chain profile manifests **about** that
address. It does not deploy accounts, resolve `.agent` names, or run login
ceremonies.

> **Layer:** Discover — a profile **facet** (not login — that is `connect-auth`; not canonical identity — that is `agent-account`).
> **Canonical key:** the Smart Agent address the AgentCard describes.

Where [`agent-naming`](../agent-naming) maps names → addresses, this package
maps addresses → typed profiles and optional endpoint-control proofs.

## Use This When

- You author or validate an `AgentCard` (person, org, service, MCP server, …).
- You need deterministic `profileContentHash` for on-chain `metadata-hash`.
- You need CAIP-10 `nativeId` encode/decode (strict encode, permissive decode).
- You need endpoint verification methods (DNS TXT, signed URL, …) — Phase 2+.
- You build encoded calls to register or update on-chain profile anchors.

## Do Not Use This For

- `.agent` names or namehash → `agent-naming`.
- Smart Agent deploy / UserOps → `agent-account`.
- Passkey / SIWE / JWT → `connect-auth`.
- Trust-fabric edges → `agent-relationships`.
- UAID string generation → refused ([ADR-0008](../../docs/architecture/decisions/0008-caip10-nativeid-record-predicate.md)).

## Install

Workspace-internal; not yet published.

```bash
pnpm add @agenticprimitives/agent-profile
```

## 60-Second Quickstart

```ts
import {
  canonicalProfileJson,
  profileContentHash,
  buildCaip10Address,
  type AgentCard,
} from '@agenticprimitives/agent-profile';

const canonicalAddr = '0x0000000000000000000000000000000000000003' as const;

const profile: AgentCard = {
  type: 'person',
  displayName: 'Alice',
};

const hash = profileContentHash(profile);
const nativeId = buildCaip10Address({
  namespace: 'eip155',
  reference: '84532',
  address: canonicalAddr,
});
// Anchor hash + nativeId on chain via agent-naming records or profile resolver.
```

## Main Concepts

- **AgentCard**: HCS-11-aligned typed JSON discriminated by `type`.
- **Profile facet**: `metadata-uri` + `metadata-hash` pointing at the canonical SA.
- **CAIP-10 `nativeId`**: cross-registry back-link; must match SA on EVM chains.
- **Verification**: proves an MCP/A2A URL is controlled by the SA (not naming).

See [`docs/concepts.md`](docs/concepts.md).

## Subpath Exports

- `@agenticprimitives/agent-profile/caip10` — CAIP-10 helpers only.
- `@agenticprimitives/agent-profile/profile` — canonical JSON + content hash.

## Status

Phase 1 — pure helpers + client skeleton. `AgentIdentityClient` reads throw
`I Phase 2`; writes throw `I Phase 4`. Shape is locked for demo authoring.

## Security Invariants

- Profile content-hash is deterministic (canonical JSON).
- No raw passkey material in profiles.
- Verification methods are explicit, not auto-selected.

See [`docs/security.md`](docs/security.md) and [`AUDIT.md`](AUDIT.md).

## Documentation Map

- [`docs/concepts.md`](docs/concepts.md) — profile facet vs canonical SA.
- [`docs/api.md`](docs/api.md) — public API guide.
- [`docs/security.md`](docs/security.md) — invariants.
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — common errors.
- [`docs/migration.md`](docs/migration.md) — migration notes.
- [`CLAUDE.md`](CLAUDE.md) — agent routing.
- [`spec.md`](spec.md) — spec pointer.

## Validation

```bash
pnpm check:agent-profile
pnpm check:forbidden-terms
```

## License

UNLICENSED.
