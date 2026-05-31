---
'@agenticprimitives/agent-account': minor
---

R5.12c — Add `AgentAccountClient.assertSaMatchesCustodianDerivation`
for sponsored-deploy invariant gating (PKG-AGENT-ACCOUNT-005 closure).

### New API

```ts
import { AgentAccountClient, SaMismatchError } from '@agenticprimitives/agent-account';

// In a relying broker (e.g. demo-a2a /session/direct-deploy):
const verifiedWallet = recoverSiweAddress(...);

try {
  await client.assertSaMatchesCustodianDerivation({
    claimed: body.smartAccountAddress, // CLIENT-SUPPLIED target
    custodians: [verifiedWallet],      // BROKER-COMPUTED from verified credential
  });
} catch (e) {
  if (e instanceof SaMismatchError) {
    return c.json({ error: 'sa-mismatch', detail: e.message }, 400);
  }
  throw e;
}

// Past this point the broker is guaranteed `body.smartAccountAddress`
// is the canonical SA for `verifiedWallet`. Safe to sponsor the deploy.
```

### Why

Relying brokers that sponsor an SA deploy (or sign an action for a
client-supplied target) had no package-level helper to verify the
client's claimed target is the canonical derivation from the
verified credential. Demo-a2a's `/session/direct-deploy` (and the
Google×KMS bootstrap in demo-sso-next, spec 235) deploy a
`body.smartAccountAddress` chosen by the client — a financial DoS
when the broker pays gas.

`assertSaMatchesCustodianDerivation` is THE gate primitive.

### Behaviour

- Computes the deterministic SA address via the existing
  `getAddressForAgentAccount(spec)` (factory CREATE2 view).
- Case-insensitive comparison (checksum-agnostic).
- Defaults to the canonical SIWE-only mode: `mode = 0`, `salt = 0n`,
  no trustees, no passkey.
- Overrides for `mode` / `salt` / `trustees` / `passkey` are
  first-class opts for multisig / passkey-direct / custom-salt flows.
- Returns the verified address on match.
- Throws `SaMismatchError` on mismatch with `{ claimed, derived, spec }`
  fields for forensics.

### New exports

- `SaMismatchError` class
- `AgentAccountClient.assertSaMatchesCustodianDerivation` method

### Tests

8 new R5.12c tests in `test/unit/sa-derivation-invariant.test.ts`:
- happy path (claim matches derivation)
- case-insensitive claimed address
- mismatch throws `SaMismatchError`
- error carries `claimed` / `derived` / `spec` for forensics
- default spec is `mode = 0`, `salt = 0n`
- non-default overrides (`mode = 2`, custom `salt`, multi-custodian)
  honoured
- financial-DoS scenario: client supplies target derived from a
  different custodian → rejected
- correct-claim happy path round-trip

67/67 agent-account tests pass (+8 R5.12c).

### Companion

This is the **third** of three package additions in the relayer-pattern
pivot:

- **R5.12a** — `createRelayerAccount` (PKG-KEY-CUSTODY-009)
- **R5.12b** — `createSpendCappedAccount` (PKG-KEY-CUSTODY-010)
- **R5.12c** — `assertSaMatchesCustodianDerivation` (this — PKG-AGENT-ACCOUNT-005)
- **R5.12d** — demo-a2a migrates 4 callsites onto a, b, c (app-only follow-up)
