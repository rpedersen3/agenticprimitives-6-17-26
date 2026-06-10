# @agenticprimitives/agent-profile

**A profile describes the identity; it never becomes the identity.** Agent discovery is consolidating right now — ERC-8004 registries on mainnet, agent naming services shipping agent cards, HCS-11 profiles on Hedera. Each standard wants to be the place an agent "lives." This package takes the other position: every agent already lives at one canonical ERC-4337 Smart Agent address, and a profile is a typed, content-hashed manifest *about* that address ([ADR-0010](../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)). Registry entries in any standard become facets that back-link to the same anchor — so one identity serves all of them, and no registry can quietly fork who the agent is.

Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

Where [`agent-naming`](../agent-naming) maps names → addresses, this package maps addresses → typed profiles and optional endpoint-control proofs: the `AgentCard` schema, deterministic content hashing for on-chain anchoring, and CAIP-10 `nativeId` helpers for cross-registry back-links.

> **Layer:** Discover — a profile **facet** (not login — that is `connect-auth`; not canonical identity — that is `agent-account`).
> **Canonical key:** the Smart Agent address the AgentCard describes.

## Use this when

- You author or validate an `AgentCard` (person, org, service, treasury, MCP server, multisig).
- You need a deterministic `profileContentHash` for the on-chain `metadata-hash` anchor — so a tampered profile is detectable by anyone holding the hash.
- You need CAIP-10 `nativeId` encode/decode (strict encode, permissive decode) aligned with HCS-14 / ERC-8004 ([ADR-0008](../../docs/architecture/decisions/0008-caip10-nativeid-record-predicate.md)).
- You need endpoint-verification methods (DNS TXT, signed URL, HTTP challenge, verifiable presentation) — Phase 2+.
- You build encoded calls to register or update on-chain profile anchors.

## Do not use this for

- `.agent` names or namehash — `agent-naming`.
- Smart Agent deploy / UserOps — `agent-account`.
- Passkey / SIWE / JWT — `connect-auth`.
- Trust-fabric edges — `agent-relationships`.
- UAID string generation — refused by design ([ADR-0008](../../docs/architecture/decisions/0008-caip10-nativeid-record-predicate.md)); we expose `nativeId` and consumers derive UAIDs locally.

## Install

Workspace-internal; not yet published.

```bash
pnpm add @agenticprimitives/agent-profile
```

## 60-second quickstart

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

## How it's different

The reference points are **ERC-8004 registries and agent-card formats** (including the GoDaddy ANS `agent-card.json` pattern, which inspired the manifest shape — without importing its PKI):

- **Anchor, not authority.** In registry-first designs, the registry entry *is* the agent, and each registry mints its own notion of identity. Here the `AgentCard` is HCS-11-aligned typed JSON discriminated on `type`, and every external registry facet must back-link to the canonical Smart Agent via CAIP-10 `nativeId` ([spec 220 §4](../../specs/220-agent-identity-bootstrap.md)). One agent, many registries, zero identity forks.
- **Tamper evidence built in.** `profileContentHash` is deterministic canonical JSON — sorted keys, fixed numeric format — matching the on-chain `metadata-hash` predicate. Two semantically equal profiles hash identically; a mutated profile cannot pass against its anchor.
- **Endpoint claims are not endpoint proof.** A profile may *claim* an MCP or A2A URL; `VerificationMethod` is the explicit, caller-selected proof that the Smart Agent controls it. We never silently pick a verification method — you always know what "verified" meant.
- **CAIP-10 done strictly.** Encoders reject unknown namespaces (Phase 1: eip155, hedera, solana); decoders accept any grammar-valid CAIP-10 string for forward compatibility.

## Main concepts

- **AgentCard**: HCS-11-aligned typed JSON discriminated by `type`, with type-specific sub-objects (`AiAgentProfile`, `McpServerProfile`, `MultisigProfile`, `ServiceProfile`).
- **Profile facet**: `metadata-uri` + `metadata-hash` pointing at the canonical SA.
- **CAIP-10 `nativeId`**: the cross-registry back-link; must match the SA on EVM chains.
- **Verification**: proves an MCP/A2A URL is controlled by the SA (distinct from naming).

See [`docs/concepts.md`](docs/concepts.md).

## Subpath exports

- `@agenticprimitives/agent-profile/caip10` — CAIP-10 helpers only (no client baggage).
- `@agenticprimitives/agent-profile/profile` — canonical JSON + content hash.

## Security invariants

- Profile content-hash is deterministic (canonical JSON).
- No raw passkey material in profiles — only `credentialIdDigest`.
- Verification methods are explicit, not auto-selected.
- No UAID generation ([ADR-0008](../../docs/architecture/decisions/0008-caip10-nativeid-record-predicate.md)).

See [`docs/security.md`](docs/security.md) and [`AUDIT.md`](AUDIT.md).

## Documentation map

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

## Status

**Phase 1 — pure helpers + client skeleton.** The schema, CAIP-10 helpers, and content hashing are real and tested; `AgentIdentityClient` reads throw `I Phase 2` and writes throw `I Phase 4` — they are stubs by design, and the shape is locked for authoring today. Beyond that: testnet/pilot-ready; production launch is gated on the public checklist in the root [`README.md`](../../README.md#status--honest-version), including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

## License

UNLICENSED.
