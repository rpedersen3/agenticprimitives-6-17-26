# Spec 276 — KMS Consumer Surface, GCP Provisioning, and Delegated-Signer Composition

**Status:** draft (architect-of-record). Ring-0 primitive work in `packages/key-custody`, `packages/verifiable-credentials`, and a new `packages/delegated-signer`. No app/vertical code (ADR-0021); no protocol-conformance code (ADR-0037).
**Companion specs:** [203](./203-key-custody.md) (key-custody contract), [235](./235-google-kms-custody.md) (per-`(iss,sub)` custodian signers), [266](./266-verifiable-content-substrate.md) (content-primitives / `DelegatingSigner`), [242](./242-trust-credentials-and-public-assertions.md) (verifiable-credentials / `CredentialSigner`), [220](./220-agent-identity-bootstrap.md) (deploy → name → custody).

## 0. Why this spec exists

An external repo (`verifiable-content-demo` — `apps/demo-validator`, `apps/demo-bible-mcp`) **inlined a GCP Cloud KMS secp256k1 signer** (`apps/demo-validator/src/kms-signer.ts`) that is a narrower copy of the primitive `key-custody` already ships in `src/providers/gcp.ts` (DER parse → low-s (EIP-2) → recovery-byte search → SPKI pubkey → address → asymmetric sign). Re-deriving a custody primitive in an app is exactly the drift ADR-0013 / ADR-0021 exist to prevent.

The root cause is **not** that the GCP signer is heavy. Its only runtime deps are `@noble/curves` + `@noble/hashes`. The real friction is the **peer-dependency + workspace coupling** of the current surface:

- `src/providers/gcp.ts` imports `viem` (`bytesToHex`, `type Address`) and `@agenticprimitives/audit` (`buildEvent`, `AuditSink`) at runtime.
- `viem`, `@agenticprimitives/audit`, `@agenticprimitives/connect-auth`, and `@agenticprimitives/types` are **peer** dependencies.

So a standalone external consumer (a Vercel app that just wants "sign this digest with my KMS key") must satisfy `viem ^2.52` + workspace-only audit/connect-auth peers to import `@agenticprimitives/key-custody/gcp`. That is why the app inlined instead. **The fix is to publish a consumer-safe, dependency-minimal KMS signing core that an external app can import without inheriting viem/audit/connect-auth** — so no app inlines this primitive again.

This spec also lands two adjacent, already-scoped pieces (the external repo proves the demand): a **GCP provisioning helper** (today this is a hand-run runbook), and a **generic named delegated-signer composition** that replaces the app's `trust-context.ts` orchestration without dragging naming/account/delegation concepts into `key-custody`.

## 1. Decisions (locked)

| ID | Decision | Why |
|---|---|---|
| **KCS-D1** | Factor a **pure signing core** out of `providers/gcp.ts` into `src/kms/secp256k1-core.ts` with **zero peer deps** (only `@noble/*`): DER→`(r,s)` parse, low-s normalization, recovery-byte search, SPKI→uncompressed-point→keccak address, and a `signDigest(digest, { fetchSig, publicKeyPem })` that takes an injected transport. Expose it at a new subpath **`@agenticprimitives/key-custody/kms-core`**. | This is the consumer-safe surface. No `viem`, no `audit`, no `connect-auth` — an external app imports it with only `@noble/*` transitively. |
| **KCS-D2** | The existing `GcpKmsSigner` (`KmsAccountBackend`, viem `Address`, audit sink) becomes a **thin wrapper** over the core. `bytesToHex` is replaced with a local hex helper (drop the runtime `viem` value import; keep `type Address` only — types erase). The audit sink stays **optional** and lives in the wrapper, never the core. | Backwards-compatible: `./gcp` and the barrel keep the rich, audited backend; the core is the lightweight extract. One implementation, two surfaces (no second KMS path). |
| **KCS-D3** | Ship a **GCP provisioning helper** in `key-custody` at subpath `@agenticprimitives/key-custody/provision-gcp` (+ a `bin` CLI `ap-provision-gcp`): create per-identity HSM secp256k1 key (`EC_SIGN_SECP256K1_SHA256`, HSM protection level), grant the runtime SA `roles/cloudkms.signer` **scoped to that key**, and return a validated **identity → key-version-resource-name** map. Pure planning + `gcloud`/REST execution; **no vertical identity names baked in**. | Ports smart-agent's G-PR-6 runbook into a reusable primitive. Per-key (not per-keyring) IAM enforces master-key separation (CLAUDE.md invariant). |
| **KCS-D4** | Add a **key-map parse/validate** helper (`parseSignerKeyMap`) + **loose service-account JSON parser** (`parseServiceAccountJson`) to `kms-core` / a `key-map` module: tolerate the common shapes (raw JSON, base64, file path env), fail closed with a precise error, never silently default. | The external app hand-rolled both; they are generic and belong here (ADR-0013 — one parse path, loud failure). |
| **KCS-D5** | The **`KmsAccountBackend` → `CredentialSigner` adapter** lives in **`verifiable-credentials`** as `kmsCredentialSigner(backend)`, mirroring the existing `viemSignerFromWallet`. It does NOT live in `key-custody` (which must not know about VC proofs) nor in an app. | `verifiable-credentials` already owns `CredentialSigner` + `signCredential`. The adapter is one small bridge next to its sibling. |
| **KCS-D6** | The **named delegated-signer resolution** (combine `agent-naming` + `agent-account` + `delegation` + `key-custody` to answer "give me a signer for the credential identity `X`, authorized by delegation chain `Y`") goes in a **new top-level package `@agenticprimitives/delegated-signer`** — generic only. It depends on those four; nothing depends back on it (it's a leaf consumer like `mcp-runtime`). | Keeps `key-custody` pure (raw primitives only) while giving the external repo's `trust-context.ts` a generic home. The app keeps only its vertical defaults (`bsb.impact`, D1 names, Worker wiring). |
| **KCS-D7** | **Nothing vertical or deployment-specific** enters any of these packages (ADR-0021): no `bsb.impact`, no `.pages.dev`/Worker route names, no D1 table names, no Cloudflare secret names, no faith vocabulary. Those stay in the external app, supplied as config the generic core consumes. | Packages are reusable trust building blocks; the external demo is a tenant. |
| **KCS-D8** | **AWS stays unimplemented** (R11.3): `providers/aws.ts` keeps fail-fast stubs, `KmsBackend` keeps `'aws-kms'` as a future value, docs say so (doc-drift already corrected ahead of this spec). This spec does NOT implement AWS. | Scope discipline; AWS is AUDIT.md M1, decided separately. |

## 2. The consumer-safe KMS core (KCS-D1, KCS-D2)

### 2.1 Module shape

```
packages/key-custody/src/kms/
  secp256k1-core.ts   # zero-peer-dep: DER parse, low-s, recovery search, SPKI→address, hex helpers
  gcp-transport.ts    # the REST/JWT bits (fetch + WebCrypto) — also peer-dep-free
  key-map.ts          # parseSignerKeyMap, parseServiceAccountJson  (KCS-D4)
```

`secp256k1-core.ts` public surface (subpath `key-custody/kms-core`):

```ts
export function parseDerEcdsaSignature(der: Uint8Array): { r: bigint; s: bigint };
export function toLowS(s: bigint): bigint;                       // EIP-2
export function recoverV(digest: Uint8Array, r: bigint, s: bigint, expectedAddress: string): 27 | 28;
export function addressFromSpkiPem(pem: string): `0x${string}`;  // SPKI → keccak(X||Y)[-20:]
export function assembleEthSignature(r: bigint, s: bigint, v: 27 | 28): `0x${string}`;

/** Sign a 32-byte digest with an injected KMS transport. No viem/audit/connect-auth. */
export async function signDigestWithKms(opts: {
  digest: Uint8Array;
  publicKeyPem: string;          // cached by the caller
  asymmetricSign: (digest: Uint8Array) => Promise<Uint8Array>; // returns DER
}): Promise<`0x${string}`>;
```

**Dependency rule (enforced):** `kms-core` may import **only** `@noble/curves`, `@noble/hashes`, and Node/Web built-ins. A unit test + a `package.json` `exports` lint asserts no `viem` / `@agenticprimitives/*` import reaches the `kms-core` subpath graph.

### 2.2 The wrapper

`providers/gcp.ts` (`GcpKmsSigner`) keeps its `KmsAccountBackend` shape, viem `type Address`, and optional `AuditSink`, but delegates the crypto to `kms-core` and the REST to `gcp-transport`. The runtime `import { bytesToHex } from 'viem'` is replaced by a local `bytesToHex`. Behavior, audit emission (`key-custody.sign`), and the public barrel are unchanged.

## 3. GCP provisioning helper + CLI (KCS-D3)

Subpath `@agenticprimitives/key-custody/provision-gcp`, plus `bin: { "ap-provision-gcp": ... }`.

```ts
export interface ProvisionPlan {
  project: string; location: string; keyRing: string;
  identities: string[];                  // opaque labels supplied by the caller (no vertical names here)
  runtimeServiceAccount: string;         // email to grant roles/cloudkms.signer (per-key)
  protectionLevel?: 'HSM' | 'SOFTWARE';  // default HSM
}
export interface ProvisionResult {
  keyMap: Record<string, string>;        // identity → cryptoKeyVersion resource name
  granted: Array<{ key: string; member: string; role: 'roles/cloudkms.signer' }>;
}
export function planGcpProvision(plan: ProvisionPlan): GcloudStep[];   // pure — emits the gcloud/REST steps
export async function executeGcpProvision(plan: ProvisionPlan, exec: StepExecutor): Promise<ProvisionResult>;
```

- **Per-identity key**: `kms keys create <identity> --purpose=asymmetric-signing --default-algorithm=ec-sign-secp256k1-sha256 --protection-level=hsm`.
- **Per-key IAM** (not per-keyring): one `roles/cloudkms.signer` binding on each key for the runtime SA — enforces master-key separation.
- **Validation**: after create, fetch each public key and derive the EVM address via `kms-core.addressFromSpkiPem`; return it in `ProvisionResult` so the operator can verify before wiring env.
- **Idempotent**: re-running skips existing keys/bindings; reports what already existed (loud, not silent).
- **Execution is injected** (`StepExecutor`): the helper does not shell out itself — callers pass a `gcloud` runner or a REST runner. Keeps the package transport-agnostic and testable.

## 4. CredentialSigner adapter (KCS-D5)

In `verifiable-credentials/src/proof.ts`, beside `viemSignerFromWallet`:

```ts
// Declared LOCALLY — NOT imported from key-custody — because verifiable-credentials is a
// graph leaf (no @agenticprimitives/* imports beyond types/ontology). key-custody's
// KmsAccountBackend structurally satisfies this, so kmsCredentialSigner(kmsBackend, …) just works.
export interface KmsSigningBackend {
  signA2AAction(input: { digest: Uint8Array }): Promise<{ signature: Uint8Array }>;
  getSignerAddress(): Promise<Address>;
}
export function kmsCredentialSigner(args: {
  backend: KmsSigningBackend; issuerAddress: Address; chainId: number; verifyingContract?: Address;
}): CredentialSigner;
```

**Refinement (implemented):** the adapter binds against a **structural `KmsSigningBackend`** rather than importing `KmsAccountBackend`, so VC keeps its zero-`@agenticprimitives/*`-dependency leaf position. `verifyingContract` defaults to the issuer SA (ERC-1271 self-anchor). This is the only bridge between custody and credentials. `content-primitives`'s `DelegatingSigner` consumes a `CredentialSigner`, so the chain is: `key-custody` (raw signer) → `verifiable-credentials` (`kmsCredentialSigner`) → `content-primitives` (`DelegatingSigner`).

**Bug fixed in passing:** `signCredential` hashed the credential body BEFORE `ensureContexts` expanded `@context`, but emitted the expanded body — so the stored `credentialHash` never reconciled with its own body and structural verification rejected it. Now contexts are expanded before hashing. (No other repo caller; surfaced by the adapter test.)

## 5. Delegated-signer composition package (KCS-D6)

New `packages/delegated-signer` (generic, top-level leaf):

```ts
// resolve a signer for a NAMED identity, authorized by a delegation chain.
export interface ResolvedDelegatedSigner {
  signerAddress: `0x${string}`;     // the operational signing key (e.g. KMS per-subject)
  delegatorAgent: `0x${string}`;    // the SA whose authority the signer wields
  sign: (digest: Uint8Array) => Promise<`0x${string}`>;
}
export async function resolveDelegatedSigner(opts: {
  name: string;                                  // agent-naming label → SA (no TLD baked in)
  signer: KmsAccountBackend;                     // from key-custody (incl. deriveSubjectSigner)
  delegationChain: Delegation[];                 // from delegation
  resolveName: NameResolver;                     // injected agent-naming client
  verifyAccount: AccountVerifier;                // injected agent-account client
  chainId: number; delegationManager: Address;   // to recompute each link's authority hash
}): Promise<ResolvedDelegatedSigner>;
```

**Refinement (implemented):** `agent-naming` + `agent-account` are reached ONLY through the injected `resolveName` / `verifyAccount` callbacks — the package does **not** import those packages (so it stays a pure, unit-testable leaf with no registry/TLD knowledge). Its real dependencies are therefore just `delegation` (`Delegation`, `hashDelegation`, `ROOT_AUTHORITY`) + `key-custody` (`KmsAccountBackend`, `bytesToHex` from `/kms-core`). Verification covers name resolution, account validity, and the chain's **authority linkage** (root authored by the named SA, each link's `authority == hashDelegation(parent)`, leaf delegate == signer key); per-link ERC-1271 signature verification stays `delegation.verifyAuthorization`'s job (inject upstream).

- Depends on `delegation`, `key-custody`. `agent-naming` + `agent-account` are **injected as client callbacks** (so the package stays unit-testable and the app supplies RPC/registry config).
- **Generic only**: the `name` is an opaque label + resolver; the package never hardcodes `.impact`, `bsb`, or any registry. It does not own delegation semantics (it composes `delegation`'s verifier) — mirrors how `content-primitives` stays delegation-agnostic.
- This is the generic core of the external app's `trust-context.ts`. The app keeps: the vertical default name (`bsb.impact`), Worker route wiring, D1 table names, Cloudflare secret names, and UI ceremonies.

## 6. Package boundaries (ADR boundary doctrine)

```
@noble/*  ──▶  key-custody/kms-core      (zero peer deps — the consumer-safe surface)
                    │
                    ▼
              key-custody (barrel: GcpKmsSigner wrapper + audit + viem types)
                    │                         ▲
                    ▼                         │ (no back-edge)
           verifiable-credentials  ──▶  content-primitives
                    │
                    ▼
            delegated-signer  ◀── agent-naming, agent-account, delegation   (top-level leaf)
```

- No back-edges into `key-custody` (it still must not import `agent-account`/`delegation`/etc.).
- `delegated-signer` is a leaf consumer (like `mcp-runtime`); nothing in Ring 0 depends on it.
- Vocabulary firewall: `key-custody` must not gain `Delegation`/`Caveat`/naming terms (forbidden-terms check). The composition lives in `delegated-signer`, not `key-custody`.

## 7. External-repo migration contract (KCS-D7)

For `verifiable-content-demo` (`demo-validator`, `demo-bible-mcp`) — these live in a **sibling repo**, not Ring 0 (ADR-0037), so this spec defines the contract; the migration PR lands there:

1. **Delete** `apps/demo-validator/src/kms-signer.ts`. Import `signDigestWithKms` + `addressFromSpkiPem` from `@agenticprimitives/key-custody/kms-core` (only `@noble/*` transitively — no viem/audit peers required).
2. **Replace** the hand-rolled service-account / key-map parsing with `parseServiceAccountJson` + `parseSignerKeyMap`.
3. **Replace** `scripts/provision-content-signer-keys.mjs` with the `ap-provision-gcp` CLI (or the `provision-gcp` API), passing the app's signing-identity labels as opaque `identities`.
4. **Replace** the signer-orchestration half of `apps/demo-bible-mcp/src/lib/trust-context.ts` with `resolveDelegatedSigner` from `@agenticprimitives/delegated-signer` + `kmsCredentialSigner` from `@agenticprimitives/verifiable-credentials`. Keep the vertical defaults (`bsb.impact`, D1, Worker routes, secret names) in the app.
5. **Verify** the migrated signer derives the identical EVM address (the provisioning helper returns it; assert it matches the previously-inlined signer's address before cutover).

Acceptance: the external app installs `@agenticprimitives/key-custody` and imports `/kms-core` with no `viem`/`@agenticprimitives/audit` peer install required.

## 8. Reference: smart-agent patterns to port

Local: `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`).

| smart-agent source | What to port | Where it lands here |
|---|---|---|
| `packages/sdk/src/key-custody/gcp-kms-signer.ts` + `der-utils.ts` + `gcp-auth.ts` | The signer + DER/low-s/recovery + service-account JWT auth, **already ported** into our `providers/gcp.ts`. Port the *separation* (der-utils as a standalone module) into `kms-core`. | `key-custody/src/kms/secp256k1-core.ts`, `gcp-transport.ts` |
| `packages/sdk/src/key-custody/viem-kms-account.ts` | The viem adapter kept **separate** from the signing core — confirms our wrapper/core split. | `providers/gcp.ts` wrapper (unchanged barrel) |
| `docs/operator/gcp-kms-provisioning.md` (G-PR-6) + `scripts/diagnose-gcp-kms.ts` | Per-key create (`ec-sign-secp256k1-sha256`, HSM), per-key `roles/cloudkms.signer`, master-key separation, address verification after create. | `key-custody/src/kms/provision-gcp` + `ap-provision-gcp` CLI |
| `apps/web/src/lib/treasury/provision.ts` | Identity→key mapping + validate-before-use ergonomics. | `key-custody/src/kms/key-map.ts` |

**Deliberate divergence:** smart-agent's GCP signer is Node/gRPC-leaning; ours is Workers-compatible REST + WebCrypto (already true in `providers/gcp.ts`) and the new `kms-core` is **peer-dep-free** by design — smart-agent never needed a standalone external-consumer surface; we do (this spec's reason for existing).

## 9. Out of scope

- Implementing AWS KMS (AUDIT.md M1; KCS-D8).
- GCP envelope encryption (`GcpKmsProvider` encrypt/decrypt v0.2 stub) — unchanged.
- The external repo's vertical/UX/Worker code (lands in the sibling repo per the §7 contract).
- Any protocol-conformance code (ERC-8004/ANS/HCS) — ADR-0037 routes it out.
- Per-subject **GCP** derivation (spec 203 §note: `deriveSubjectSigner` is local-aes-only today). If the external repo needs per-subject GCP keys, it provisions per-subject keys via §3 and selects by key-map — a follow-up may add a GCP-backed `deriveSubjectSigner`, tracked separately.

## 10. Test plan

- **kms-core (unit):** DER fixtures → `(r,s)`; low-s idempotence; recovery-byte selection against a known pubkey/address; SPKI PEM → address golden vector; `signDigestWithKms` with a mock `asymmetricSign` returns a recoverable 65-byte sig. **Import-graph test:** the `kms-core` subpath pulls no `viem`/`@agenticprimitives/*`.
- **wrapper (unit):** `GcpKmsSigner` over a mocked transport produces the same address/signature as before (regression vector); audit emission unchanged.
- **provision-gcp (unit):** `planGcpProvision` emits the expected steps; `executeGcpProvision` is idempotent against a fake executor; returns derived addresses.
- **adapter (unit):** `kmsCredentialSigner` round-trips through `verifyCredential` (ERC-1271 path) with a mocked backend.
- **delegated-signer (unit):** `resolveDelegatedSigner` with injected name/account/delegation mocks returns the right signer + delegator; rejects an invalid chain (fail-closed).
- **Doctrine:** `pnpm check:forbidden-terms` stays green for `key-custody` (no naming/delegation terms leak in); `delegated-signer` declares its four deps with no back-edges.

## 11. Validate

```bash
pnpm --filter @agenticprimitives/key-custody typecheck && pnpm --filter @agenticprimitives/key-custody test
pnpm --filter @agenticprimitives/verifiable-credentials typecheck
pnpm --filter @agenticprimitives/delegated-signer typecheck
pnpm check:forbidden-terms
pnpm generate:capability-index   # new package + exports
```
