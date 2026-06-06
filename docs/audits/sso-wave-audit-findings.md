# SSO-Wave Architecture Audit — Findings & Disposition

**Date:** 2026-05-25. **Stage:** architecture (specs + ADRs; no code yet).
**Auditors:** `technical-architect-auditor` + `security-auditor`.
**Scope:** ADRs 0014–0018, specs 223–226, spec 100 §4, construction plan.

This is the durable record of the two audits run on the SSO wave. Disposition
codes: **FIXED** = corrected inline in the spec/ADR this pass; **OPEN-HW** = valid
control captured here + in the spec, remediation deferred to the implementation
("hardening") wave when the package scaffolds; **VERIFIED** = a doctrine mitigation
the auditor confirmed load-bearing (no change needed).

Both auditors' headline: the doctrine layer (no-owner session, custody-on-chain,
no-getLogs, no-fallback, asymmetric cross-origin token) is genuinely strong and
load-bearing. Findings cluster in (a) doc-accuracy against shipped code and
(b) the IdP-class glue the specs left unspecified.

---

## Architecture audit (technical-architect-auditor)

| ID | Finding | Disposition | Where |
|---|---|---|---|
| P0-1 | `toCanonicalAgentId(chainId,address)` / `buildCaip10Address(chainId,address)` don't match shipped `buildCaip10Address(parts: Caip10Parts): Caip10Address`; the `(chainId,address)` form is eip155-only and can't express `hedera:*` | **FIXED** | ADR-0016 Decision; ADR-0008 amendment; spec 224 §12.1 |
| P0-2 | `CanonicalAgentId` (new `types` brand) vs already-shipped `agent-profile` `Caip10Address` = two brands for one concept | **FIXED** | ADR-0016 (promotion clause: `type CanonicalAgentId = Caip10Address`, move primitive to `types`, re-export); spec 224 §12.1; vocabulary-map row |
| P1-1 | `identity-directory-adapters → agent-naming` is the right home, BUT firewall is per-manifest only (no global cycle/denylist check); spec 100 "denylisted packages" prose implies a central denylist that doesn't exist | **FIXED** (prose + core-forbids rule + **`check:dependency-graph` landed** — caught/fixed 3 real gaps: agent-account, connect-auth, agent-naming siblings) | spec 100 §4; `scripts/check-dependency-graph.ts` |
| P1-2 | `NamingPort` claims `CanonicalAgentId` but shipped `agent-naming` is `Address`-keyed with no chainId; lift point unspecified | **FIXED** | spec 223 §5 (adapter chainId-lift invariant + naming-null-terminal) |
| P1-3 | Ontology lockstep hand-wavy: on-chain `atl:` vs off-chain `ap*:` CURIEs unmapped; "shape match" undefined | **FIXED** (crosswalk requirement + match definition) + **OPEN-HW** (`check:ontology-lockstep`) | spec 225 §8/§11; ADR-0018 |
| P1-4 | `agentKind` (4 values, on-chain) vs `ProfileType` (6 values) conflated in C-box | **FIXED** | spec 225 §6 (two distinct vocabularies + subtype mapping) |
| P2-1 | A third/fourth "session" (`AgentSession` + unnamed same-origin) without vocab-map rows | **FIXED** (named `BrokerSession`) + **OPEN-HW** (vocab-map rows when code lands) | spec 224 §4; vocabulary-map |
| P2-2 | smart-agent parity confirmed accurate (getLogs rejection correctly grounded); §10 "drop X" list incomplete | **FIXED** (made illustrative) | spec 225 §10 |
| P2-3 | Open-question recommendations | **FIXED** | namespace pinned; EdDSA default + ES256 capability-fallback (spec 224 §4); `org` added to ontology phase-1 (spec 225 §11) |
| P2-4 | "directory not authority; re-read on-chain" never says WHO re-reads | **FIXED** | spec 224 §8 (step-up uses custody/account read path, not directory ports) |

---

## Security audit (security-auditor) — Connect controls `CN-1`…`CN-12`

All marked **OPEN-HW**: the control is now written into the spec; the negative-test
+ runbook verification attaches when the package scaffolds. Each is a row to seed
in `docs/audits/evidence-checklist.md` at that point.

| CN | Finding (sev) | Control (now in spec) |
|---|---|---|
| CN-1 | **P0-1** Redirect/response delivery unspecified → open-redirect, token-in-URL, postMessage origin confusion | spec 224 §4a: per-`client_id` exact-match `redirect_uri` allowlist; **authorization-code-style** delivery (single-use ≤120s code exchanged server-side), not implicit; `postMessage` pinned `targetOrigin`; `state` bound to relying origin |
| CN-2 | **P0-2** "act within low-risk bounds" tier had no on-chain anchor → Connect-side authority | spec 224 §8: login-grade session authorizes **NO on-chain state change**; "low-risk" writes require an **on-chain session-key policy** (scoped ERC-7579 module), not an assurance label |
| CN-3 | **P0-3** OIDC convergence could mint a session for an existing agent off a weak directory edge / unverified email / reusable GitHub username | spec 224 §5 (session issuance re-reads on-chain authority, not a stale directory edge), §6 (`email_verified=true`; GitHub keyed on immutable numeric id) |
| CN-4 | **P1-1** JWKS/`kid` alg-confusion + HS/asym verifier sharing | spec 224 §4: pin alg per key (never read token `alg`); reject `alg:none`; disjoint `kid` namespaces + distinct `iss`, verify `iss` first; bounded JWKS TTL + revocation runbook |
| CN-5 | **P1-2** Disambiguation pick is an unauthenticated hijack surface | spec 224 §5: selection validated server-side ∈ convergence result held in `BrokerSession`; never trust client-echoed `sub` |
| CN-6 | **P1-3** Assurance downgrades silently; stale `onchain-read` can revive a revoked credential | spec 223 §4: `onchain-read` carries `blockNumber` + max-staleness; session issuance has an assurance floor + re-reads current custodian set; step-up needs `onchain-confirmed` |
| CN-7 | **P1-4** WebAuthn central-RP phishing concentration; missing UV; signCount undefined | spec 224 §7: `userVerification:'required'`; explicit signCount policy; relying-site SDK pins Connect origin; no downgraded fallback |
| CN-8 | **P1-5** `hedera:*`/`solana:*` subject could be treated as controllable | spec 224 §5 non-EVM gate (read/identifier-grade only, never step-up); spec 225 §6 `controlStatus` on every allowlisted namespace |
| CN-9 | **P2-1** `jti` replay store unspecified for cross-origin bearer token | spec 224 §4a: code-style exchange moves the atomic single-use store to the broker token endpoint; bounded `exp` |
| CN-10 | **P2-2** Hash-pinned profile could reach a trust decision without hash-on-fetch | spec 223 §4: verify `keccak(bytes)==metadataHash` before `onchain-confirmed`; mismatch/unavailable lowers assurance, never serves unpinned bytes |
| CN-11 | **P2-3** Bootstrap-on-zero-agents = deploy-spam + name-squat surface | spec 224 §5: rate-limited + verified-credential-gated; prefer deferring on-chain deploy to a deliberate action |
| CN-12 | **P2-4 / P2-5** Multi-port composition can re-introduce a de-facto fallback; `JwtClaims`→`AgentSession` translation unspecified (owner-shaped field leak) | spec 223 §5/§6 (authoritative-port designation; empty authoritative = terminal); spec 224 §12.2 (re-resolve `smartAccountAddress→CanonicalAgentId`; define/delete `session-grant`; no owner-shaped field leaks) |

**VERIFIED load-bearing (no change):** no-owner `AgentSession` (ADR-0016);
recovery-is-custody-not-delegation (ADR-0011); no-getLogs (ADR-0012, ports clean);
HCS-11 memo rejection stronger than HCS-11 (spec 226 §4); CAIP-10 cross-chain
subject (ADR-0016). Each is load-bearing *provided* the linked CN control closes.

---

## New threat-model boundary (to migrate into `docs/audits/threat-model.md` at scaffold)

**Boundary I — Browser ↔ Connect origin.** The broker is an IdP-class trust
concentration (ADR-0014). Assets: the broker private signing key, the
`redirect_uri` allowlist, every user's cross-site SSO. Threats: open-redirect
token exfiltration (CN-1), alg-confusion forgery (CN-4), phishing the single RP
(CN-7), bootstrap spam (CN-11), disambiguation hijack (CN-5). Controls: §4/§4a/§5/
§6/§7 above. This boundary did not exist pre-wave; the threat model gains it when
`packages/connect` scaffolds.

## Structural checks to add to `check:all` (when packages exist)
1. **`check:dependency-graph`** (P1-1, highest value) — ✅ **DONE**
   (`scripts/check-dependency-graph.ts`, in `check:all`): cross-manifest import
   graph — edge validity + acyclicity + facet-registry firewall. Closed the gap
   that per-manifest `check:package-boundaries` cannot catch, and fixed three
   real denylist gaps it surfaced (agent-account, connect-auth, agent-naming).
2. **`check:ontology-lockstep`** (P1-3, Phase 4) — every on-chain term has an IRI
   in `tbox/`; every `ShapeRegistry` shape matches a `cbox/` `sh:property` (per the
   spec 225 §8 "shape match" definition + the `atl:`⟷`ap*:` crosswalk).
3. **Vocabulary-map rows** — `CanonicalAgentId`/`Caip10Address`,
   `AgentSession`/`BrokerSession`/`SessionRow` (already added this pass).

Tracked in `docs/architecture/product-readiness-audit.md`.

---

## FedCM-delegation wave (ADR-0032) — security-auditor, 2026-06-05

**Scope:** the new server-side KMS-sign authority path for the FedCM delegation flow:
demo-sso `/fedcm/grant` (`server/fedcm.ts onFedcmGrant`) + the reverted thin `onAssertion`;
demo-a2a `/custody/google/sign-site-delegation` (bridge-authenticated, constrained sign);
demo-gs `startConnectFedcm`. **Verdict: SHIP (conditional).** The two core ADR-0032 claims hold:
(1) the `SameSite=None` CSRF-harvest is defeated by the id_token `aud`/`iss` binding + registered-Origin
check; (2) constrained signing is real — caller input reaching the signed digest is limited to
`delegate` + a `sender` that must equal the derived person SA, so a broker compromise cannot escalate
beyond a scoped value-0 revocable delegation. No critical finding.

| ID | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| M-3 | med | `/fedcm/grant` emitted no audit row — the only new browser-reachable authority-issuance surface was unobservable; replays (M-2) invisible. | **FIXED** — structured `evt:fedcm.grant` decision line on every branch (subject = canonical public SA per ADR-0010), `server/fedcm.ts`. Was the ship-blocker. |
| H-1 | high | Custody class branched on the cookie `via` (client-controlled, not bound to the verified credential). Safe TODAY: the demo-a2a bridge `verifyCustodySession` rejects any non-custody-grade session, so a forged `via:Google` on a passkey/wallet token yields no signature. | **OPEN-HW** — derive custody class from the VERIFIED session principal, not the cookie. Comment added at the branch flagging `via` as advisory. Regression test owed: "passkey session + `via:Google` → no delegation." |
| M-1 | med | Bridge nonce store is per-isolate in-memory (`getInMemoryNonceStore`) → cross-isolate replay within the 60s freshness window not caught (also affects `/custody/google/resolve`). Blast radius bounded: replay re-mints the SAME value-0 delegation. | **OPEN-HW** — back with KV/Durable Object (TTL = 2× freshness). Matches the inline TODO. |
| M-2 | med | id_token has no `jti`/one-time binding → `/fedcm/grant` replayable for the full 3600s TTL (re-issues an equivalent scoped delegation). | **OPEN-HW** — bind a one-time `jti` at assertion, consume-on-first-use at grant. Acceptable for testnet (ADR-0028) ONLY because M-3 now makes replays visible. |
| L-1 | low | `assertionCorsHeaders` reflects the raw Origin with `Allow-Credentials:true` before the registered-origin check → response bodies readable by any reflected origin. Not a harvest vector (id_token is the gate). | **OPEN-HW** — reflect ACAO only for a resolved client origin. |
| I-1 | info | `verifyHomeSession` aud-retry (`fedcm.ts`) is a `try-strong/catch-weaker` shape (ADR-0013 smell). Not exploitable — signature still verified, `isOwnConnectOrigin` gates issuer, same-subject check binds. | **OPEN-HW** — cleanup. |
| I-2 | info | `resolveOrigin` can throw outside the try → uncaught 500 w/o CORS on a foreign Host. Vercel always sets a valid Host → not exploitable. | **OPEN-HW** — robustness. |

Must-fix-before-Base-Sepolia: **M-3 (done)**. Acceptable-with-tracking on testnet: H-1, M-1, M-2, L-1, I-1, I-2.
