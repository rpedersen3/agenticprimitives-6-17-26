# Agent Account Security

This package is the **identity anchor**. Mistakes here propagate to every facet
and downstream authority package.

## Canonical Address Stability

The Smart Agent address MUST NOT change when:

- a passkey is rotated
- a SIWE EOA is replaced
- trustees approve recovery ([ADR-0011](../../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md))

CREATE2 salt MUST NOT embed credential material that can rotate.

## Salt Inputs

Acceptable salt sources:

- `deriveSaltFromEmail(email, rotation)` — stable user scope
- `deriveSaltFromLabel(label)` — stable auth-scope label from `identity-auth`

Unacceptable salt sources:

- `.agent` name or namehash
- profile `metadata-hash`
- one-time session or JWT id

## Signer Boundaries

- This package verifies signatures via ERC-1271 and configured validators.
- WebAuthn **ceremonies** belong in `identity-auth`.
- KMS key material belongs in `key-custody`.

## EntryPoint Version

Client configuration MUST pin the EntryPoint version. Do not silently mix v0.6
and v0.8 address derivations or UserOp shapes.

## Bootstrap Vs Authority Signer

Factory deploy may use a bootstrap signer distinct from ongoing custodians.
Document which signer is authoritative after bootstrap completes.

## What This Package Does Not Prove

- That a human-readable name maps to this address (use `agent-naming` +
  round-trip reverse resolution).
- That an MCP endpoint is controlled by this agent (use `agent-identity`
  verification methods).
- That a delegation or tool grant is valid (use `delegation` / `mcp-runtime`).
