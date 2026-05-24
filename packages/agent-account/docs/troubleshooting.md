# Agent Account Troubleshooting

## Counterfactual Address Does Not Match After Deploy

Check:

- same `factory`, `entryPoint`, `chainId`
- same owner material and **salt**
- salt was not recomputed from a `.agent` name (forbidden)

## `createAccount` Reverts

Common causes:

- account already deployed at the derived address
- signer does not match factory owner expectation
- wrong factory or EntryPoint for the target chain

## Signature Verification Fails

- Passkey: ensure ceremony output is encoded with `encodeWebAuthnSignature` and
  the account expects `SIG_TYPE_WEBAUTHN`.
- EOA: confirm the address is an enrolled custodian on the Smart Agent.
- Use `verifyUserSignature` from `identity-auth` for universal validator paths.

## UserOp Simulation / Submission Fails

- confirm `isDeployed(address)` before execution-only paths
- validate `buildExecuteCallData` target contracts and calldata
- check bundler URL and packed gas limits if using `BundlerClient`

## Confused Account Package With Identity Stack

| Symptom | Route to |
| --- | --- |
| Need `.agent` name | `agent-naming` |
| Need AgentCard profile | `agent-identity` |
| Need login / JWT | `identity-auth` |
| Need add/remove passkey on SA | `custody` |
| Need delegation token | `delegation` |

This package only owns the Smart Agent address and account execution substrate.
