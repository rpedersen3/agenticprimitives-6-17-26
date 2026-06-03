# demo-jp operator recovery (Pete + Jill)

**The operator keys cannot be lost.** They are *deterministic*, not random: `src/lib/personas.ts`
mints them from hardcoded seeds. Clearing browser `localStorage` re-derives the **identical** EOA
keys — and therefore the identical Smart Agents — on next load (`loadOrMintPersona` → `mintPersona`).
This file is the durable record so the seeds, addresses, and derivation are written down outside the
code too.

> DEMO ONLY. Real deployments custody via KMS-backed signers / multi-credential recovery (spec 235 /
> ADR-0011), never a seed in app code. The seed-in-localStorage model is intentionally transparent
> for the pedagogical audit story (see the `personas.ts` header + `check-no-app-private-keys` allowlist).

## The roots (EOA custody keys)

Each operator is one EOA that custodies TWO sibling Smart Agents — its **person SA** (CREATE2 salt 0)
and its **org SA** (salt 1). The EOA key is the single recovery root for both.

| Operator | seed | EOA private key | EOA address | custodies |
| --- | --- | --- | --- | --- |
| Pete | `a11ce` | `0x` + `a11ce`.padStart(64,'0') | `0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7` | Global Church org (salt 1) + Pete person SA (salt 0) |
| Jill | `b0b` | `0x` + `b0b`.padStart(64,'0') | `0x0376AAc07Ad725E01357B1725B5ceC61aE10473c` | JP (Joshua Project) org (salt 1) + Jill person SA (salt 0) |

Re-derive a key anytime:

```js
import { privateKeyToAccount } from 'viem/accounts';
const peteKey = '0x' + 'a11ce'.padStart(64, '0');   // → 0xe05fcC…cfF7
const jillKey = '0x' + 'b0b'.padStart(64, '0');     // → 0x0376AA…473c
privateKeyToAccount(peteKey).address;               // the EOA
```

## Smart-agent addresses (derived, not stored)

The SA addresses are CREATE2 predictions from `(custodian EOA, salt)` against the AgentAccount factory
(`packages/contracts/deployments-base-sepolia.json` → `agentAccountFactory`). They are NOT persisted —
`onchain.ts` / `person-sa.ts` re-derive them from the EOA + salt each session (org-deploy is derived
from chain, spec 247). To recover an SA: load the operator key, then derive `{ mode:0, custodians:[eoa],
salt }` (salt 0 = person, salt 1 = org) via the factory; deploy if it has no code yet.

If the factory is ever redeployed the SA *addresses* change, but the EOA keys above stay constant — so
the operators (and the ability to re-deploy/claim their SAs) are always recoverable from this file.
