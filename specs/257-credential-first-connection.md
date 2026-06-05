# Spec 257 — Credential-first connection + passkey-centered SSO + recovery

**Status:** draft, 2026-06-04. Synthesis of three expert reviews (UX, Business Analyst, SSO/OIDC
architecture).
**Owner:** `apps/demo-sso-next` (the Impact home / Connect entry) + `apps/demo-gs` + `apps/demo-jp`
(relying-app entry surfaces). App-layer UX + orchestration; **no package or contract change** (the
credential-first spine already exists). Recovery UX is a companion to [spec 221](221-credential-recovery.md).
**Architecture-of-record:** ADR-0010 (canonical SA = identity), ADR-0011 (credentials rotate, identity
persists), ADR-0016 (no-owner AgentSession, CAIP-10 sub), ADR-0017 (OIDC = login facet, custody needs
step-up), ADR-0013 (no silent fallbacks), ADR-0021 (generic packages / white-label apps). Builds on specs
220/221/224/227/229/233/235.

## Reference: smart-agent patterns to port

`/home/barb/smart-agent` (003-intent-marketplace-proposal) is name/credential-first at its auth edge and
treats the account as the anchor with rotatable signers — we ALREADY ported that as the canonical-SA + facet
model (ADR-0010/0011) and the Connect broker (spec 224). This spec ports nothing net-new from smart-agent;
it **re-orders our existing surface** to match the doctrine smart-agent's model implies. Deliberate
divergence: smart-agent has no social-IdP-as-custody (our spec-235 Google KMS custody is ours); the
credential-first front door leans on it.

## 1. Thesis

The demo is **name-first**: the entry surface asks the user to recall + type a *generated, forced-unique*
agent name (`alice3.impact`) to return. That is **name-as-password** — a re-entry trap for the non-crypto
audience, and under ADR-0013 a mistyped/forgotten name resolves to **0 agents → bootstrap**, i.e.
*accidental identity fragmentation* (a new home instead of the user's own). The fix is to **surface the
model the architecture already implements**: a **credential (Google/passkey/wallet) is the front door**, the
**name is a public handle**, and **recovery rotates credential facets without changing the SA** (delegations
survive). All three reviews independently concluded the work is **~80% app-layer UX ordering** on a
built credential-first spine — and the biggest single win (the front-door swap) is also the cheapest.

## 2. The model (user-facing) ↔ system (what executes)

The refactor succeeds when the UX consistently presents the USER model and the system faithfully executes
the SYSTEM model, never leaking the gap. Every UX string names a **facet** (device, wallet, name, trusted
people); none names the **anchor** (SA / CAIP-10). The anchor's invariance is the silent guarantee.

| User thinks | System does | UX hides it by |
| --- | --- | --- |
| "I sign in with Google." | `(iss,sub)` → per-(iss,sub) KMS `C_sub` → deterministic SA; session sub = CAIP-10. | "Continue with Google" → "We found your Impact home: `rich-pedersen.impact`." Never shows CAIP-10. |
| "My name is me." | The SA is identity; the `.impact` name is a forced-unique facet pointing AT it. | Name = a shareable **handle/URL**, never a login field on the primary path. SA in a collapsed "Details". |
| "I added my phone / wallet." | A new credential facet accretes on the same SA's custody set (`addPasskey`/`addCustodian`). | "Secure your home — add this device" / "Add a recovery wallet." Backup framing, not re-keying. |
| "Trusted people help me back in." | Trustee-quorum `CustodyAction.RecoverAccount` rotates credentials on the SAME SA. | "Add trusted recovery people"; readiness badge. Copy says recover **access**, never "identity". |
| "My stuff still works." | SA address never changes → delegations / naming / balances persist. | Silent: "Welcome back, same workspace." |

## 3. Front door — two buttons, name demoted

Relying-app entry (demo-gs Global.Church, demo-jp Impact) + the home self-serve entry lead with:
- **Primary: "Continue with Google"** (+ passkey / wallet where the home has them) → resolve → continue. **No
  name typed.**
- **Secondary: "Use my Impact name"** → the current name-first path, as fallback (direct-URL login, "I know
  my name", resolving another agent).

Frame copy: *"Sign in with Google, passkey, or wallet. Your Impact name is how others find your agent — not
something you need to remember to get back in."*

**Architecture fact:** the broker already resolves `credential → CanonicalAgentId` with zero name input
(`/authorize` takes `{credential, aud}`; `passkeyLogin()` and `/custody/google/resolve` resolve the SA). The
ONLY gap is the UI: `EntryExperience` defaults to `{k:'name'}` → `NameStart`. **The fix is to invert that
default** to credential-first; the **name chooser moves into the BOOTSTRAP leaf** (the one place a name is
genuinely needed — to claim a public handle on a brand-new SA).

## 4. Journeys (with the convergence cardinalities)

- **J1 Signup (new):** Continue with Google → resolve = **0 agents** → bootstrap (`bootstrap-and-claim`: deploy
  the C_sub-custodied SA + claim a forced-unique `<label>.impact`, sponsored, zero device gesture) → "We
  created your Impact home: `rich-pedersen.impact`" → soft, deferred nudge "Secure your home — add this device."
- **J2 Return login:** Continue with Google → resolve:
  - **1** → "We found your Impact home: `<handle>.impact`" → issue aud-bound token (authority re-read on-chain,
    never off a stale edge).
  - **many** (Google rotation, or a separate named home — see §7) → **account chooser**: human names + dates,
    server-validated, **never raw addresses**, no auto-select.
  - **0** → returning user who lost their Google link OR genuinely new → route to bootstrap, BUT offer
    **recovery / name-fallback** first (the fragmentation guard, §8 NFR-2).
- **J3 Return via name (fallback):** "Use my Impact name" → `resolveByName` → the SAME SA as the Google path.
- **J4 Add a passkey (the quick migration / 2FA):** from a Google-grade session, "Secure your home — add this
  device" → WebAuthn create at the Connect origin → `addPasskey` signed by `C_sub` (custody-class op) →
  optionally `removeCustodian(C_sub)` to **graduate** off server/Google custody. SA unchanged.
- **J5 Add a wallet (recovery custodian):** SIWE verify → `addCustodian(eoa)` → enables multi-credential
  self-recovery without trustees.
- **J6 Lost-credential recovery** (all → `CustodyAction.RecoverAccount`, same SA, delegations survive):
  **6a** another surviving method (self-recovery); **6b** trustee quorum (2-of-3 schedule → safety-delay →
  apply); **6c** identify the home by name/address to begin recovery. Reconnect ≠ recovery: a non-custodian
  new-device passkey resolving to 0 agents MUST route to recovery, **never** an inline auto-add (spec 227 P2-I).
- **J7 Org signatory:** social login = login-grade for routine org reads; **step-up** (one passkey tap, aud-
  pinned) for value movement / credential / governance / sensitive PII. Org agents stay ROOT-credential-
  custodied; the relying app holds a scoped revocable delegation, never custody.

## 5. Passkey-centered OIDC SSO

**OIDC is the SSO transport regardless of the underlying credential.** One ceremony at the Connect origin
issues **distinct aud-bound id_tokens** to each relying app, all carrying the **same sub** (CAIP-10 canonical
agent) — sign in once, recognized everywhere as the same agent; a token for app A is invalid at app B (exact
aud match). Relying apps integrate once against the broker and never know which credential was used — which is
what makes the social→passkey migration invisible to them.

**Two grades, one protocol (ADR-0017):** the token carries `assurance`/`role`. **Passkey is the preferred
credential** (phishing-resistant, cross-device via discoverable/synced passkeys spec 233, on-chain-verifiable
ES256). Social is the on-ramp; passkey is the destination. **Custody is enforced by signatures on-chain, not
by assurance labels** — assurance is a UX/gating hint; a write always needs a custodian signature
(`AgentAccount` knows only custodian sigs). Step-up = a passkey ceremony minting a NEW custody-grade
AgentSession for the specific aud (one tap, not a re-auth). The migration nudge fires **at first sensitive
action**, never at signup, and is persistent-but-dismissible.

## 6. The progressive-security ladder

```
social (login-grade)                          ← easy front door (spec 235, zero device gesture)
  └─ + passkey   (2FA / custody-grade)         ← the "quick migration"; addPasskey signed by C_sub
       └─ + wallet (recovery custodian)        ← addCustodian(eoa); enables self-recovery
            └─ + trusted people (2-of-3 quorum) ← RecoverAccount trustee config
```
Each rung is an `onlySelf` userOp signed by an existing custodian = a custody-class action requiring step-up.
The ladder is OPTIONAL + non-blocking; the only one the product actively NUDGES (early + persistently) is
recovery readiness, because a Google-only member with no recovery who loses Google is **locked out** (§8 R2).

## 7. Multi-home reconciliation (the principal net-new + its hazard)

One Google identity can map to a *family* of SAs (the `rotation` counter — a deliberate "new home"), and a
person may have BOTH a Google-derived home AND a separately-named passkey home that was never linked as an
OIDC facet → two **distinct canonical SAs**. They **cannot merge** (the SA address IS the identity; two CREATE2
addresses can't collapse). The correct reconciliation is **not "make them one SA"** but **"make them one home
by adding the second credential as a custodian of the chosen SA"** (`addPasskey`/`addCustodian`, a custody-
class, on-chain-proven op) — the leftover SA is abandoned (still derivable, never detached). NET-NEW UX:
detect "this credential proves control of SA-A but you already have SA-B" → offer "add this sign-in to your
existing home." Today it would silently resolve/create a second home — a real hazard (§8 NFR-4).

## 8. Security invariants (fail-closed) + the lockout risk

- **NFR-1:** a login-grade session authorizes NO on-chain state change (custody/recovery/above-threshold value)
  without step-up to an on-chain-recognized credential. Enforced structurally (AgentAccount validates only
  custodian sigs). Test: a custody write with a login-grade token → reject.
- **NFR-2 (ADR-0013):** one mechanism per resolution; a 0-result is terminal (→ bootstrap or recovery), never
  an escalation to a second lookup. Name mistype → explicit recovery/retry, never accidental new identity.
- **NFR-3:** no primary UI surfaces AgentSession / CAIP-10 / kid / "custody-grade" / raw addresses (Details
  accordion only).
- **NFR-4 (no credential confusion):** a credential proven for SA-A must NEVER authorize anything on SA-B, and
  the system must never silently treat two homes as one identity. Reconciliation is an explicit custody-class
  add, target bound to the proven SA (never client-supplied — mirror `stepup.ts`).
- **NFR-5:** one SA per `(iss,sub)` — a returning identity resolves to the linked SA; only a truly-new identity
  mints a fresh SA; rotation is the only deliberate exception.
- **NFR-6:** recovery rotates facets; the SA address is immutable; delegations persist (regression test).
- **NFR-7 (ADR-0021):** the credential-first LOGIC is generic; only the COPY (`.impact`, faith vocab) is
  white-label, in the apps' `src/lib/domain.ts`. No package leak (confirmed by the architecture review).
- **R2 — the crown-jewel risk:** a pre-graduation Google-only member who loses Google AND has no
  passkey/wallet/trustees is **locked out** (Google = full custodian, spec 235). → the recovery-readiness nudge
  is a REQUIREMENT, fired early + persistently; "0 trusted people" is a visible amber state.
- Carry forward the accepted testnet caveats (Pete/Jill demo keys; demo-jp C-1/C-2; spec-235 G-1/G-3
  production blockers) — do NOT suppress guards.

## 9. Vocabulary

Add a `vocabulary-map.md` row: **"recovery"** = custody (`RecoverAccount`, credential rotation on the same SA)
vs **"revoke"** = delegation (SessionRow lifecycle). Credential removal = `removePasskey`/`removeCustodian`
(custody), NOT delegation revocation. "step-up" is owned by connect/ADR-0017 — reuse. Keep `AgentSession`
distinct from the delegation `SessionRow` and the connect-auth cookie session.

## 10. Where it lives (app vs package)

All net-new is app-layer (the package primitives — resolve / convergence / issuance / step-up / custody — all
EXIST): credential-first entry routing + "Continue with X" UI + name-chooser placement (`demo-sso-next`);
multi-home reconciliation orchestration (app, composing resolve + addCustodian + facet read); social→passkey
guided op (app glue over `/custody/google/sign`); recovery UX (app — `demo-sso-next` consumer flow,
`demo-web-pro/docs/recovery` the designated home). No new package; the package boundary graph + vocabulary
firewall are undisturbed.

## 11. Phased rollout

- **Phase 1 — Front-door swap (biggest re-entry win, cheapest):** relying-app + home entry lead credential-
  first; "We found your home" resolution; account chooser; name demoted to fallback. (FR-1..4, FR-9, FR-10 —
  mostly wiring.) **Done when:** a returning member signs in with Google → their home → into the relying app
  **without typing a name**, across ≥2 apps from one sign-in; a new member gets a home from one Google tap.
- **Phase 2 — Recovery readiness + ceremony (closes the lockout risk):** "Add trusted recovery people" + 2-of-3
  readiness badge; the three recovery sub-flows on `RecoverAccount`; plain-language copy; early amber nudge for
  Google-only members; reconnect-vs-recovery boundary enforced. **Done when:** a member who lost all personal
  credentials regains access to the SAME home (same name, delegations, balances) via 2-of-3 trustees; UI never
  says "identity"; multi-home reconciliation offers "add this sign-in to your existing home."
- **Phase 3 — The passkey/wallet ladder (long-term posture):** add-passkey + graduation off server custody;
  add-wallet recovery custodian; migration nudge timed to first sensitive action; post-graduation Google
  degrades to login-grade + step-up; fail-closed step-up verified. **Done when:** a member upgrades Google-only
  → passkey-controlled (`isCustodian(C_sub)==false`), a sensitive action demands a one-tap step-up, and a
  login-grade session provably can't authorize any write.

Cross-phase gates: all four facets (Google/passkey/wallet/name) → one sub (regression); no forbidden recovery
terms (`check:forbidden-terms`); no CAIP-10/AgentSession in primary UI; one-SA-per-(iss,sub) holds.

## 12. Acceptance (spec-level)

The architecture reviews confirmed the spine is built; this spec's acceptance is the Phase-1..3 "done" criteria
above. Visual walkthroughs (SVG mockups + a clickable index) live in `docs/design/257-credential-first/`:
- **`greenfield/`** — the PREFERRED first-time experience (Privy-simple, 3 taps, name DEFERRED). The Connect
  ceremony is a **popup over the dimmed relying site** (embedded feel, credential at the Connect origin); the
  segue is a button-loading-state + simultaneous popup (no interstitial), with the co-brand "From
  Global.Church" pill as the load-bearing trust element. Screens `01→07` (first-time) · `08–09` (deferred
  handle/security) · `10` (return) · `11` (popup-blocked fallback). **This is the target flow for Phase 1.**
- the top-level SVGs — the earlier credential-first mockups (entry → resolution → recovery), retained as the
  recovery/ladder reference.
