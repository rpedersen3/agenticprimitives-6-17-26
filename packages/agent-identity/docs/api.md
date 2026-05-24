# Agent Identity API

Human-readable guide to `capability.manifest.json` exports.

## Constants

- `CAIP10_NAMESPACE_ALLOWLIST` — encode-side allowed namespaces (Phase 1:
  `eip155`, `hedera`, `solana`).
- `AGENT_CARD_SCHEMA_VERSION` — schema version embedded in canonical JSON.

## CAIP-10 (`/` and `/caip10`)

- `buildCaip10Address(parts)` — strict encoder; returns branded `Caip10Address`.
- `parseCaip10(id)` — permissive parser; returns `Caip10Parts`.
- `isValidCaip10(id)` — grammar check without throwing.
- `Caip10Parts` — `{ namespace, reference, address }`.

## Profile (`/` and `/profile`)

- `canonicalProfileJson(profile)` — sorted-key canonical JSON string.
- `profileContentHash(profile)` — keccak256 of UTF-8 canonical JSON.

## Types

- `AgentCard` — root profile union.
- `ProfileType` — discriminator union.
- `AiAgentProfile`, `McpServerProfile`, `MultisigProfile`, `ServiceProfile`.
- `VerificationMethod` — endpoint verification enum.
- `Caip10Address` — branded CAIP-10 string.
- `PublishProfileInput`, `AgentIdentityClientOpts`, `WriteContext`.

## Errors

- `InvalidProfileError` — schema / shape rejection.
- `ProfileHashMismatchError` — off-chain JSON vs on-chain hash mismatch.
- `EndpointVerificationError` — verification challenge failed.
- `InvalidCaip10Error` — encode-side CAIP-10 rejection.

## Client

- `AgentIdentityClient` — fetch / verify / publish (Phase 2+).
- `fetchProfile(agent)` — load profile; verify hash against chain.
- `verifyEndpoint(agent, url, methods)` — explicit verification dispatch.
- `publishProfile(input, ctx)` — write path (Phase 4).

## Call Builders

Pure `{ to, value, data }` builders for profile resolver contracts:

- `buildRegisterProfileCall`
- `buildSetProfileMetadataCall`
- `buildSetProfileStringCall`
- `buildSetProfileAddressCall`
- `buildSetProfileBytes32Call`
- `buildSetProfileActiveCall`
- `ContractCall`

## ABIs

- `agentProfileResolverAbi`

Compose calls into `AgentAccount.execute` or custody-gated ceremonies.
