---
"@agenticprimitives/key-custody": minor
"@agenticprimitives/verifiable-credentials": minor
---

KMS consumer surface (spec 276).

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
