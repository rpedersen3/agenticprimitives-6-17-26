# @agenticprimitives/verifiable-credentials

## 0.0.0-alpha.7

### Minor Changes

- 75a24d9: KMS consumer surface (spec 276).
  - **key-custody**: new peer-dependency-free signing surface at the `./kms-core` subpath
    (`signDigestWithKms`, `gcpSignDigest`, `createGcpKmsTransport`, `addressFromSpkiPem`,
    `parseServiceAccountJson`, `parseSignerKeyMap`, plus the secp256k1 DER/low-s/recovery
    primitives) so consumers never inline a KMS signer. New `./provision-gcp` subpath +
    `ap-provision-gcp` CLI (plan/execute GCP HSM secp256k1 key provisioning + per-key IAM).
    `GcpKmsSigner` is now a thin wrapper over the core. `viem`, `@agenticprimitives/audit`,
    and `@agenticprimitives/connect-auth` are now **optional** peers — a `./kms-core`-only
    consumer no longer needs them.
  - **verifiable-credentials**: `kmsCredentialSigner(backend, …)` — a `CredentialSigner`
    backed by a KMS-custodied secp256k1 key (against a local structural `KmsSigningBackend`,
    so VC stays dependency-light). Also fixes `signCredential` to hash the body after
    `@context` expansion so the emitted `credentialHash` reconciles with its own body.

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.10
- @agenticprimitives/ontology@1.0.0-alpha.10

## 0.0.0-alpha.6

### Patch Changes

- Issuer-delegated content signing (spec 266): optional `Eip712Signature2026Proof.delegatingSigner`
  (carried in the proof, which is stripped from the credential hash — does not change the signed digest);
  `signCredential` accepts it. Backward-compatible — optional; existing direct-issuer signing unchanged.

## 0.0.0-alpha.5

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.9
- @agenticprimitives/ontology@1.0.0-alpha.9

## 0.0.0-alpha.4

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.8
- @agenticprimitives/ontology@1.0.0-alpha.8

## 0.0.0-alpha.3

### Patch Changes

- ba49084: 2026-06-10 audit hardening wave + Base Sepolia redeploy.

  Contract/package security fixes from the post-NO-GO hardening program (the
  `@agenticprimitives/contracts` ABIs + the `deployments-base-sepolia.json`
  addresses move because **every contract was redeployed** — the new factory is
  `0x3E68B72B45e7C9d35B210E4Ab06e5Cece85cEbE4`):
  - **CA-F1 (High)** — `AgentAccountFactory` CREATE2 salt now commits to the full
    custody config (mode/trustees/timelockOverrides) so the counterfactual address
    can't be front-run with attacker-controlled recovery (ADR-0035).
    `getAddressForAgentAccount` gains a `timelockOverrides` param; the
    `@agenticprimitives/agent-account` client threads it.
  - **ATT-1 / ATT-3 / AGR-1** — registry issuer + joint-consent + transition digests
    now bind a full typed payload + `chainId` + `address(this)`.
  - **AN-1-ONCHAIN** — on-chain canonical label charset in `AgentNameRegistry`.
  - **SIG-1** — registries use malleability-safe OZ `ECDSA.tryRecover` (low-s).
  - **DM danger** — `verifyAuthorization` marked ⚠️ chain-only in NatSpec + the SDK.
  - **DEL-001 (P0-1, Critical)** — the session-key↔delegator binding in
    `@agenticprimitives/delegation` is now **fail-closed by default** (ADR-0036):
    `verifyDelegationToken` rejects any token lacking a valid `sessionDelegation` leaf
    unless the caller passes the explicit, greppable `allowUnboundSessionToken: true`
    opt-out. `@agenticprimitives/mcp-runtime` threads the same opt-out through
    `McpResourceVerifyConfig`. **Breaking:** the prior opt-in flags
    (`requireSessionDelegateBinding`, `strictSessionBinding`) are removed — callers that
    minted unbound tokens must set `allowUnboundSessionToken: true` or they fail closed.

  `@agenticprimitives/verifiable-credentials` + the first publish of
  `@agenticprimitives/a2a` (async delegation-authorized task transport) are bumped to
  catch the registry up to `master`.
  - @agenticprimitives/types@1.0.0-alpha.7
  - @agenticprimitives/ontology@1.0.0-alpha.7

## 0.0.0-alpha.2

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.6
- @agenticprimitives/ontology@1.0.0-alpha.6

## 0.0.0-alpha.1

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.5
- @agenticprimitives/ontology@1.0.0-alpha.5
