# ADR-0028 — Accepted testnet posture: disclosed demo keys + deferred production custody are DECIDED, not open findings

**Status:** Accepted (2026-06-03).
**Drivers:** repeated re-discovery of the same intentional testnet trade-offs by successive product-
readiness reviews (N1, DEMO-1/DEMO-2). Each audit re-raises them as if new; this ADR makes the decision
explicit and CI-enforced so reviewers cite it instead of re-litigating it.
**Companions:** N1 runbook in [`packages/contracts/AUDIT.md`](../../../packages/contracts/AUDIT.md) §4.1;
[`apps/demo-jp/AUDIT.md`](../../../apps/demo-jp/AUDIT.md) (DEMO-1/DEMO-2); [spec 248](../../../specs/248-demo-jp-custody-and-vault-scope-hardening.md);
[`docs/architecture/product-readiness-audit.md`](../product-readiness-audit.md) (the "Accepted testnet
trade-offs" register).

---

## The decision

> **A bounded set of custody shortcuts are DELIBERATE, ACCEPTED testnet trade-offs. They are correct
> production-launch gates — they MUST be closed before a production deploy — but they are NOT open
> vulnerabilities to re-discover. Each is enforced by a gate that fails a production deploy. A review
> SHOULD record them as `accepted (testnet) / deferred (production gate)` citing this ADR, and MUST NOT
> re-raise them as new findings.**

The accepted trade-offs and their enforced gates:

| Item | What it is | Why accepted (testnet) | Enforced gate (closes it for production) |
| --- | --- | --- | --- |
| **N1** | The deployer EOA `0x31ed17fb…098b44` is publicly disclosed and holds `governance`/`bundlerSigner`/`sessionIssuer` (factory) + `owner`/`governance` (paymaster). | Keeps the demo reproducible from a clean clone; testnet funds only. | `scripts/check-production-deploy.ts gateOnLeakedDeployerKey` **hard-fails** a deploy whose `.env.deploy.local` references the disclosed key (override `AGENTICPRIMITIVES_DEMO_KEYS_ACCEPTED=true` is testnet-only). Production runbook: `packages/contracts/AUDIT.md` §4.1 (KMS deployer + multisig + 24h timelock + key destroy). |
| **DEMO-1** | demo-jp operator org keys (GC/JP) derived from hardcoded seeds → globally identical. | Demo survives a cleared browser; no member-funds at risk on testnet. | **spec 248** (per-operator SIWE/KMS custody, spec 235). Tracked, not silent. |
| **DEMO-2** | Vault delegations are full-vault grants (no `record_type` scope enforced off-chain). | Substrate ships before the scope-caveat; testnet data only. | **spec 248** (record-type scope caveat in the vault tools). |
| **Operator sessions** | Pete/Jill get ~10-year Connect sessions. | Deliberate scoped demo convenience for the operator personas. | Scoped to the demo operator personas (`DEMO_LONG_LIVED_EOAS`); production issues normal-TTL sessions. |
| **Stub packages** | New W1 packages are `0.0.0-stub.0` / foundational; some `--passWithNoTests`. | They exist for the dependency graph + type surface; runtime lands incrementally. | `check:no-stub-publish` (added with this ADR) blocks publishing any `0.0.0-stub.*` package; per-package invariant suites required before graduation (RW1-5). |

## What this ADR does NOT do

It does **not** declare these safe for production. N1 remains the highest production blocker; DEMO-1/2
remain real exposures off testnet. The whole repository is **Alpha / external-audit-ready / testnet-only**
(root README). This ADR only fixes the *audit accounting*: these are **decided + gated**, so a reviewer's
correct action is "confirm the gate still fails-closed," not "re-report the trade-off as a discovery."

## How a reviewer should treat them

- **Do** verify each gate still fails closed (e.g. run `check:production-deploy` with the demo key and
  confirm it refuses; confirm `check:no-stub-publish` blocks a stub publish).
- **Do** escalate if a gate is missing, weakened, or bypassable — *that* is a new finding.
- **Don't** list N1/DEMO-1/DEMO-2/operator-sessions/stub-status as new P0/P1 discoveries. Reference this
  ADR + the linked runbook/spec and mark them `accepted (testnet) / deferred (production)`.

## Consequences

- The product-readiness audit gains an "Accepted testnet trade-offs (do not re-raise)" register at the
  top; N1/DEMO rows link here.
- A new `check:no-stub-publish` gate enters `check:all-publish` — a `0.0.0-stub.*` package cannot ship.
- When an accepted trade-off is actually closed (e.g. the production custody rotation, or spec 248
  landing), its row moves to "closed" with the closing PR — the ADR is the running ledger of the bounded
  set, not a license to add more shortcuts. New shortcuts require their own ADR row + gate.
