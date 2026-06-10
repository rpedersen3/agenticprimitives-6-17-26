# ADR-0035 — The counterfactual Smart Agent address commits to its full custody configuration

**Status:** accepted (2026-06-10) · **Finding:** CA-F1 (High) + CA-F2 (Low), [2026-06-10 contract-by-contract deep audit](../../audits/2026-06-10-contract-by-contract-audit.md) · **Touches:** [ADR-0010](0010-smart-agent-canonical-identifier.md) (the address IS the identity), [spec 209](../../../specs/209-erc7579-module-taxonomy.md), [spec 220](../../../specs/220-agent-identity-bootstrap.md)

## Context

`AgentAccountFactory` derives every Smart Agent address with CREATE2. Before this change the address committed to:

- the **proxy bytecode hash** — which folds in `custodians`, the initial passkey (`credentialIdDigest`/`X`/`Y`/`rpIdHash`), the `delegationManager`, and the factory address (all via `_initData` → `initialize`), and
- the **bare user `salt`**.

It did **not** commit to `mode`, `trustees`, or `timelockOverrides`. Those are the *recovery* configuration, applied **after** deploy via `installModule(EXECUTOR, custodyPolicy, …)`. So two `createAgentAccount` calls with identical custodians/passkey/salt but **different recovery config resolved to the same address**, and the occupied-address guard (`if (addr.code.length > 0) return AgentAccount(addr)`) silently adopted whichever deployed first.

**CA-F1 (High) — pre-deployment custody hijack of the canonical identity.** The canonical SA address is deterministic and public (it gets published, named, funded counterfactually). A victim announces address `X` for a mode-3 org with trustees `[G1,G2,G3]`. An attacker front-runs `createAgentAccount` with the same custodians+salt but `mode=1, trustees=[attacker]`. The proxy deploys at `X` with the victim's custodians as signers **but the attacker as the sole recovery trustee** — the attacker then drives a `CustodyPolicy` T6 recovery to rotate the signer set and seize the identity. Short of full takeover, a front-runner can downgrade the mode or shorten the recovery timelocks. This directly defeats ADR-0010 ("the address is the identity").

**CA-F2 (Low)** is the silent-adoption mechanism (no config-equality check on the occupied branch) that turns CA-F1 from a revert into a silent hijack.

## Decision

**Fold the complete custody configuration into the CREATE2 deploy salt.** The factory computes

```solidity
deploySalt = keccak256(abi.encode(salt, params.mode, params.trustees, timelockOverrides));
```

and uses `deploySalt` both for the `ERC1967Proxy{salt: …}` deploy and for the counterfactual `getAddressForAgentAccount` derivation. Combined with the custodians + passkey already in the bytecode hash, **the canonical address now commits to the account's entire identity-and-recovery configuration.** Two requests that differ in *any* of these axes resolve to *different* addresses.

Consequences of the derivation, by construction:

- An attacker can no longer occupy a victim's counterfactual address with weaker/attacker-controlled recovery config — any change yields a different address, leaving the victim's address free for the victim's exact config.
- The **occupied-address branch is reachable only by an identical-config request**, so the silent-adoption path (CA-F2) is safe *without* a separate config-equality assertion. We deliberately do **not** add a redundant on-chain comparison of the installed config — the address derivation already encodes the invariant, and dead defensive code is worse than a derivation that can't be wrong (architecture-purity doctrine).

`getAddressForAgentAccount` gains a `timelockOverrides` parameter (`(params, timelockOverrides, salt)`) because the address now depends on it. `createAgentAccount`'s signature is unchanged (it already received `timelockOverrides`).

## Consequences

- **All CREATE2 addresses move.** This is a salt-derivation change, so every AgentAccount address differs from the pre-ADR derivation. It requires a **full factory redeploy** + a fresh `deployments-base-sepolia.json`, and re-derivation of any counterfactually-referenced address. Re-deploys are cheap; a hijackable identity is not.
- **Off-chain prediction must pass the deploy-time timelocks.** Any caller predicting an address MUST use the *same* `(params, timelockOverrides, salt)` it will deploy with, or the predicted address won't match. The `@agenticprimitives/agent-account` client threads `spec.timelockOverrides` (zeros = inherit the factory defaults T4=1h/T5=24h/T6=48h) through both `getAddressForAgentAccount` and `assertSaMatchesCustodianDerivation`. App-level hand-written ABI mirrors (demo-a2a direct-deploy) and direct predictors (demo-web-pro Act2/Act2.5, demo-web-recovery) were updated to pass their deploy-time tuple.
- **Mode-0 (simple) accounts** carry empty `trustees` and conventionally zero `timelockOverrides`, so their address derivation is stable as long as predict and deploy agree (they do — the client defaults both to zeros).
- Property tests assert the new invariant: differing `mode`, `trustees`, or `timelockOverrides` each produce a different address; the headline front-run scenario can no longer occupy the victim's address; identical config stays idempotent.

## Alternatives rejected

- **Fold the config into `initialize` (so it enters `initData`/the bytecode hash) instead of the salt.** Equivalent address-binding effect, but it requires moving the custody-module install *into* `AgentAccount.initialize` — restructuring the deploy sequence and the account core for no security gain over salt-folding. Rejected as more invasive.
- **Keep the salt bare; assert config-equality on the occupied-address branch.** Reading the installed `CustodyPolicy` config back during `createAgentAccount` to compare against the request is more gas + more code, and still leaves the address *not* committing to the config (so a counterfactually-named/funded address remains ambiguous about its own recovery shape). Salt-folding makes the address self-describing; the assertion would be a strictly weaker patch.
- **Bind only `mode` + `trustees` (skip `timelockOverrides`) to avoid the view ABI change.** Closes the High hijack but leaves a front-runner able to pin shortened recovery timelocks at the victim's address (an integrity degradation). Binding all three makes "the address IS its complete custody config" a clean, total invariant; the ABI change is small and centralized in the client.
