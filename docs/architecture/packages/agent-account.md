# `@agenticprimitives/agent-account`

`agent-account` is the client package for the ERC-4337 / ERC-1271 Smart Agent
account surface. It is the package to use when code needs to derive, inspect, or
interact with Smart Agent accounts.

## Owns

- Smart Agent address derivation and deployment helpers.
- Account and factory contract clients.
- UserOperation construction helpers.
- ERC-1271 signature checks.
- Account reads such as deployment state, passkey/custodian state, and account
  module data.

## Does Not Own

- Passkey ceremony UX or WebAuthn verification. Use `connect-auth`.
- Custody policy, recovery, threshold rules, or credential replacement. Use
  `account-custody`.
- Delegated app authority. Use `delegation`.
- Product naming or profile metadata. Use `agent-naming` and `agent-profile`.

## Dependencies

Depends on:

- `types`
- `connect-auth`

`connect-auth` is used for signer/proof interfaces at the boundary. It should not
pull product authority decisions into the account client.

## Consumers

Used by packages that need account-aware behavior:

- `delegation`
- `agent-naming`
- `agent-profile`
- `agent-relationships`
- apps that deploy or query Smart Agents

## Architecture Rules

- The Smart Agent address is the canonical identity anchor.
- Keep `AgentAccount.sol` thin; threshold, guardians, spend, and sessions belong
  in modules.
- Do not add app-specific onboarding, naming, or white-label UX here.
- Do not silently fall back between different account read mechanisms.

## Common Use

Use this package when a flow needs to:

- derive a counterfactual Smart Agent address
- deploy the Smart Agent
- build a UserOperation
- call account/factory contracts
- verify an account signature through ERC-1271

## Validation

Run:

```bash
pnpm check:agent-account
```
