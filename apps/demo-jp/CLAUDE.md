# demo-jp — Claude guide

Joshua Project adopt-a-people-group relying app (spec 236). Vite SPA on Cloudflare Pages.
**Impact** (demo-sso-next) holds person/org identity + data vaults; **JP** brokers; **GC** issues
agreements. demo-jp is a relying app that connects people via Connect and drives the
intent → match → agreement spine.

## Deploy (read first)
- Pages production branch is **`main`**, not `master`: `cd apps/demo-jp && pnpm build && npx wrangler
  pages deploy dist --project-name=agenticprimitives-demo-jp --branch=main`. Deploying with any other
  branch silently goes to a preview ([memory] feedback_demo_jp_pages_production_branch_main).

## The three actors (personas)
- **Adopter / Facilitator** — real people connecting via Connect (demo-sso-next). Each controls a
  person SA + org SA(s). They express intents from THEIR dashboard (`IntentRequest`, `MemberTrustPanel`).
- **JP / "Jill"** — broker. Recognizes facilitators (off-chain JP-signed credential), brokers matches.
- **GC / "Pete"** — issuer. Registers agreement commitments + publishes bilateral joint assertions on chain.

## Where to look (by intent)
| Working on | Read |
| --- | --- |
| Adoption product flow | `specs/236-demo-jp-adoption.md` + `docs/information-architecture.md` |
| Per-agent vault (read/write over delegation) | `specs/247` + `src/lib/vault-client.ts` |
| Related-agents / person↔org delegations | `specs/246` + ADR-0025 |
| On-chain reads (agreement/attestation/naming) | `src/lib/chain.ts` (`readContract` only — ADR-0012) |
| Broker board + member/issuance/association records | `src/lib/broker-store.ts` (lives in JP's / GC's vault) |
| Registration / assertion / recognition orchestration | `src/lib/onchain.ts` |
| Operator keys + recovery | `src/lib/personas.ts` + `docs/operator-recovery.md` |
| Security posture / known holes | **`AUDIT.md`** + `specs/248` |

## Hard rules (this app)
- **On-chain reads use `readContract` only** — no `eth_getLogs` in product paths (ADR-0012). Reverse
  names via `chain.ts reverseName` (single `reverseResolveString` read; do NOT add a second mechanism).
- **One mechanism per read/auth path** (ADR-0013). No try-fast-catch-slow.
- **Recognition is FACILITATOR-only, per people group, OFF chain.** JP signs a `JpAssociationCredential`,
  stores it in JP's vault, delivers a copy to the org. The broker gate honors a recognition only if its
  JP signature ERC-1271-verifies (`verifyRecognitionCredential`) — never presence-only.
- **Data ownership:** member records live in the MEMBER's vault (JP reads via a granted delegation);
  GC's issuance index in GC's vault; JP keeps an org-level receipt. Agreement TERMS + member CONTACT
  never go on chain (only the commitment hash). See ADR-0026 + spec 248 for the divergence the demo's
  deterministic operator keys introduce.

## Custody shortcut (DO NOT "fix" silently — see AUDIT.md C-1)
Pete/Jill org keys are DETERMINISTIC (hardcoded seeds in `personas.ts`) so the demo survives a cleared
browser. This means any browser can act as the operator orgs — an accepted testnet hole, hardening
tracked in `specs/248`. The real fix is per-operator SIWE/KMS custody (spec 235).

## Validate
`cd apps/demo-jp && pnpm typecheck && pnpm build`. There is no `pnpm check:demo-jp`.
