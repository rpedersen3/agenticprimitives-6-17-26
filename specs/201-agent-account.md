# Spec 201 — `@agenticprimitives/agent-account`

**Capability:** ERC-4337 smart-account substrate. Deterministic addressing, factory deployment, ERC-1271 signing, UserOp building. Account-agnostic of which signer signs.
**Status:** v0 draft · 2026-05-19
**Reference implementation:** `smart-agent/packages/sdk/src/account.ts`, `packages/contracts/src/{AgentAccount,AgentAccountFactory,SmartAgentPaymaster}.sol`.

---

## 1. Goal

Provide the smart-account substrate one layer below delegation: given a `Signer` (from `@agenticprimitives/connect-auth`), determine the user's deterministic ERC-4337 smart account address, deploy it lazily, sign as the account via ERC-1271, and build UserOps.

This is **smaller** than my original `auth` spec because identity (passkey/SIWE/Google) is now `identity-auth`. The signer-vs-account split mirrors the four major AA SDKs: signer is pluggable.

---

## 2. Smart account model

- **Standard:** ERC-4337 v0.8 (`@account-abstraction/contracts`).
- **Account contract:** `AgentAccount` (UUPS upgradeable, owner-based, supports ERC-1271 for delegation signatures, supports passkey assertion validation).
- **Factory:** `AgentAccountFactory.getAddress(owner, salt)` / `.createAccount(owner, salt)` — CREATE2 for deterministic address.
- **Deployment:** **lazy**. Address is known after auth; contract deploys on first UserOp (typically when the user issues their first delegation).

### Salt derivation per auth method

The package consumes salt-derivation helpers from `identity-auth`:
- Passkey: `BigInt(keccak256(label).slice(0, 18))`
- SIWE: `0n`
- Google: `deriveSaltFromEmail(email, rotation)` (rotation enables "Start Fresh")

### A2A bootstrap pattern (signer rotation)

Smart-agent's `auth-bootstrap` pattern: for relayer-deployed accounts (passkey / Google), a tool-executor key from `key-custody` (NOT the user's own signer) is the initial owner that performs deployment. The account is then handed to the user. This decouples deployment-gas from user-signing-readiness.

Smart-agent ref: `apps/web/src/app/api/a2a/bootstrap/*`.

---

## 3. Required env (consumer-supplied)

```
NEXT_PUBLIC_CHAIN_ID
RPC_URL
ENTRYPOINT_ADDRESS                  # ERC-4337 v0.8 EntryPoint
AGENT_FACTORY_ADDRESS               # AgentAccountFactory
AGENT_NAME_REGISTRY_ADDRESS         # optional, for .agent ENS
```

---

## 4. Public API

```ts
export interface AgentAccountClientOpts {
  rpcUrl: string;
  chainId: number;
  entryPoint: Address;
  factory: Address;
}

export class AgentAccountClient {
  constructor(opts: AgentAccountClientOpts);

  /** CREATE2 deterministic address; works pre-deploy. */
  getAddress(owner: Address, salt: bigint): Promise<Address>;

  /** Deploy via factory using the provided signer to broadcast.
   *  For relayer-deployed accounts, pass the auth-bootstrap signer. */
  createAccount(params: { owner: Address; salt: bigint }, signer: Signer): Promise<Address>;

  isOwner(account: Address, address: Address): Promise<boolean>;
  isDeployed(account: Address): Promise<boolean>;

  /** Produce an ERC-1271-compatible signature: account.isValidSignature(hash) → magic value. */
  signWithErc1271(account: Address, hash: Hex, signer: Signer): Promise<Hex>;

  /** Verify a signature against an account via on-chain ERC-1271 call. */
  isValidSignature(account: Address, hash: Hex, signature: Hex): Promise<boolean>;

  buildUserOp(params: {
    account: Address;
    calls: Array<{ to: Address; data: Hex; value: bigint }>;
    paymaster?: Address;
  }): Promise<UserOperation>;
}

export type { UserOperation };
```

---

## 5. Security boundaries

- **No salt collision via hash.** Salt derives from stable user identifiers under keccak; brute-forcing a collision is cryptographically infeasible.
- **Owner-only sensitive ops.** Account writes (`upgrade`, `addPasskey`, etc.) are gated on `msg.sender == owner` (or ERC-1271 valid signature for delegated ops). Verified on-chain; this package only invokes them.
- **EntryPoint v0.8 binding.** Account address is a function of `(factory, owner, salt, entryPoint)`. Switching EntryPoint versions changes addresses — note in upgrade docs.
- **Bootstrap-signer isolation.** The relayer signer used for deployment SHOULD be a separate KMS key from any user-authority signer. Smart-agent's K6 hardening enforces this in production (`AWS_KMS_TOOL_EXECUTOR_AUTH_BOOTSTRAP_KEY_ID`).

---

## 6. What the package does NOT own

- Auth flows / identity / sessions → `identity-auth`.
- The delegation primitive → `delegation`.
- KMS backends → `key-custody`.
- Solidity source — addresses-by-config only; contracts live in smart-agent (or future `@agenticprimitives/contracts`).
- Paymaster policy ("which paymaster to use when") — defer until consumer need is clear; v0 takes paymaster address as a UserOp build parameter.

---

## 7. Test plan (v0)

- Unit: deterministic-address derivation matches expected CREATE2 formula.
- Integration: deploy + first-UserOp loop on Anvil with a `viem` EOA signer.
- ERC-1271: round-trip signature against deployed `AgentAccount`.
- Bootstrap path: relayer-deployed account where user is set as owner post-deploy.

---

## 8. Open questions

1. **ERC-4337 v0.9 migration.** Address determinism breaks across EntryPoint versions; how do we offer a migration path? Note for v0.1.
2. **Multi-owner accounts** (Alchemy `MultiOwnerPlugin`-style). Out of scope v0; revisit if a consumer asks.
3. **Paymaster-policy package**. Defer; treat paymaster as a UserOp build parameter for now.

---

## 9. Smart-agent file index

| Concern | File | Lines |
| --- | --- | --- |
| Account client | `packages/sdk/src/account.ts` | 1–88 |
| Account contract | `packages/contracts/src/AgentAccount.sol` | full |
| Factory contract | `packages/contracts/src/AgentAccountFactory.sol` | full |
| Bootstrap routes | `apps/web/src/app/api/a2a/bootstrap/*` | full |
| EntryPoint config | `packages/contracts/src/SmartAgentPaymaster.sol` | full |
