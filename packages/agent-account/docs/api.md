# Agent Account API

Human-readable guide to `capability.manifest.json` exports. Sync with
`src/index.ts`.

## Client

- `AgentAccountClient`: factory addressing, deploy, sign/verify, UserOp build.
- `AgentAccountClientOpts`: `rpcUrl`, `chainId`, `entryPoint`, `factory`, optional
  bundler URL.
- `AgentAccountSpec`: typed account configuration surface used by the client.

Typical methods (see `src/client.ts`):

- `getAddress(owner, salt)` — counterfactual Smart Agent address.
- `isDeployed(address)` — whether code exists at the address.
- `createAccount(params, signer)` — factory deploy.
- `buildUserOp(...)` — assemble a UserOperation.
- ERC-1271 `isValidSignature` helpers for verification flows.

## Types

- `UserOperation` — ERC-4337 UserOp shape used by this package.
- `Address`, `Hex` — re-exported branded primitives.

## Execution Helpers

- `buildExecuteCallData(calls)` — encode `AgentAccount.execute` batch calldata.
- `ContractCall` — `{ to, value, data }` element for batches.

## Bundler

- `BundlerClient` — submit / estimate UserOps via bundler RPC.
- `BundlerClientOpts` — bundler endpoint configuration.
- `PackedUserOperation` — packed gas field representation.
- `packGasLimits`, `unpackGasLimits` — gas limit packing helpers.

## Quorum / Admin (spec 207)

- `packSafeSignatures` — pack multisig-style signature slots.
- `computeAdminPayloadHash` — hash admin payloads for quorum flows.
- `ADMIN_VERB_PROPOSE`, `ADMIN_VERB_EXECUTE`, `ADMIN_VERB_CANCEL` — verb constants.
- `SafeSignatureSlot` — typed signature slot.

## WebAuthn On-Chain Wire Format

Ceremony types live in `identity-auth`. This package ships the encoder consumed
by `AgentAccount._validateSig`:

- `SIG_TYPE_WEBAUTHN`
- `encodeAssertion`
- `encodeWebAuthnSignature`

## ABIs

- `agentAccountAbi`
- `agentAccountFactoryAbi`
- `approvedHashRegistryAbi`
- `entryPointAbi`

`custodyPolicyAbi` moved to `@agenticprimitives/custody` (spec 213).
