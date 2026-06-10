# @agenticprimitives/types

**The shared type vocabulary that keeps thirty packages pointing at one identity.**

A trust substrate lives or dies on agreement about what an identity *is*. `types` is where that agreement is written down as the compiler's problem: branded primitives (`Address`, `Hex`, `ChainId`, `Caip10Address`) and the cross-cutting identity shapes (`CanonicalAgentIdentity`, `AgentType`, `AgentSession`, `CredentialPrincipal`, `Assurance`) that every `@agenticprimitives/*` package shares. Because the brands are phantom types, a raw string cannot masquerade as an address and a CAIP-10 subject cannot be confused with a bare EVM address — across package boundaries, at compile time, with zero runtime cost.

It is also where the doctrine becomes a type. `CanonicalAgentIdentity` is the ADR-0010 rule — the agent's identity IS its Smart Agent address — as an alias of `Address`, and `AgentSession` deliberately has **no `owner` field** (ADR-0016): the SSO session names the agent itself, never a vendor-side owner. Types-only, zero dependencies, no runtime code; it is the leaf every other package depends on and the reason the dependency graph has no back-edges.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## Install

```bash
pnpm add @agenticprimitives/types
```

## Exports

```ts
import type { Address, Hex, ChainId, BrandedId } from '@agenticprimitives/types';

type SessionId = BrandedId<'SessionId'>;
const chain: ChainId = 1 as ChainId;
const account: Address = '0x...';
```

Also exported: `CanonicalAgentIdentity` (ADR-0010 alias of `Address`); `Caip10Address`, `CanonicalAgentId`, `Caip10Parts` (CAIP-10 brand — the type lives here, the runtime builder lives in `agent-profile`); `AgentType` (`'person' | 'org' | 'service'`) and `NameContext` (display-only injection shape); and the SSO/session shapes `AgentSession`, `CredentialPrincipal`, `Assurance`, `CredentialKind`, `CredentialRole` (specs 223/224).

## How it's different from a typical `types` package

Most monorepo `types` packages are junk drawers that grow until everything depends on everything. This one is governed:

- **Admission rule:** a type lands here only when ≥ 2 packages consume it and it cannot live anywhere lower. Single-consumer types stay in their package.
- **No runtime, ever.** No functions, no constants with behavior, no side effects. Even the CAIP-10 *builder* is excluded — only the brand lives here.
- **Shared shapes without runtime coupling.** `AgentSession` lives here precisely so `identity-directory`, `connect`, and relying-site SDKs can agree on the token shape without importing each other.

The result is a leaf package small enough to audit in one sitting, strong enough to make identity confusion a compile error.

## Status

Minimal by design — adding a type requires ≥ 2 consuming packages. Testnet/pilot-ready. Production launch is gated on the public checklist in the root [`README.md` Status section](../../README.md#status) — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

## Validate

```bash
pnpm --filter @agenticprimitives/types typecheck
pnpm check:forbidden-terms
```
