---
"@agenticprimitives/contracts": patch
"@agenticprimitives/delegation": patch
"@agenticprimitives/agent-account": patch
"@agenticprimitives/mcp-runtime": patch
"@agenticprimitives/verifiable-credentials": patch
"@agenticprimitives/a2a": patch
---

2026-06-10 audit hardening wave + Base Sepolia redeploy.

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
- **DEL-001 (P0-1)** — `@agenticprimitives/delegation` + `@agenticprimitives/mcp-runtime`
  gain a fail-closed `strictSessionBinding` guard (throws if a strict path is
  configured without the session-delegate binding).

`@agenticprimitives/verifiable-credentials` + the first publish of
`@agenticprimitives/a2a` (async delegation-authorized task transport) are bumped to
catch the registry up to `master`.
