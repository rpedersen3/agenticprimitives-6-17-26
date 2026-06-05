# 258 — demo-gs Connect / Reconnect UX: Product Analysis & Requirements

**Status:** draft, 2026-06-05. Product-analyst deliverable (NO code).
**Scope:** the demo-gs (Global Switchboard) signed-out → connected boundary — the Landing CTA,
`ConnectScreen`, the popup ceremony, the popup-blocked redirect fallback, and the per-credential
reconnect — validated against the connect mechanics that shipped in **spec 257** (credential-first,
name-deferred). A UX designer is producing the mockups + component spec in parallel; this document is
the journey / segment / state / edge-case / acceptance model the implementation is validated against.

**Companion specs:** [257](../../../specs/257-credential-first-connection.md) (credential-first /
name-deferred spine — the architecture-of-record for this surface), [250](../../../specs/250-demo-gs-global-switchboard.md)
(the 4-role Switchboard product), [252](../../../specs/252-*) (member-owned vaults / Wave 2).
ADRs: 0010 (canonical SA = identity), 0011 (credentials rotate, identity persists), 0013 (no silent
fallbacks), 0021 (generic packages / white-label apps).

**The thesis (inherited from 257, applied to demo-gs):** the relying site must feel like a **normal
product sign-in**, not a protocol handoff. The **credential** (Google / passkey / wallet) is the front
door; the **Impact name is a PUBLIC HANDLE**, not a login key. The redesign removes the transient
"Taking you to your Impact home" bridge that currently fires *before* the user has chosen a credential,
and folds its trust reassurance into the connect card + the popup loading state.

---

## 0. The product in one paragraph (orientation)

demo-gs = "Global Switchboard", a relying app that brokers **skill matches**. People **connect via
Global.Church** (Impact Connect SSO at `www.impact-agent.me`). Connecting is **ONE role-agnostic
action**; the role is chosen **AFTER** connecting, inside the intranet (the `RoleHub`):
- **GCO** (demand): the connected person sets up an **organization** they're the signatory of, which
  holds the GCO role and posts skill **Needs**. (Org-create is a *second* ceremony, from the hub.)
- **KC** (supply): an **individual** offers expertise as an **Offering**.

Identity + data live at Impact; demo-gs holds only a **scoped, revocable delegated** read/write grant to
the member's vault. The SA address is the canonical identity; the session credential is a cache of that
grant (`lib/session.ts`), never operational data.

---

## 1. User segments × entry states

Two independent axes the connect surface must serve **without** asking the user to self-classify before
connecting:

- **Tenure:** first-time vs returning.
- **Credential:** Google (nameless-capable) vs passkey (subdomain-bound, named) vs wallet/SIWE
  (reached only after a typed name today).
- **Role intent:** GCO-intent vs KC-intent vs **undecided** — and crucially this axis is **resolved
  after connect**, so the connect surface must be role-agnostic for all three.

| # | Segment | Entry state | Ideal path | What they should see |
|---|---------|-------------|------------|----------------------|
| S1 | First-time, undecided, Google | Lands on `/` signed out, no session | Landing → single Connect → popup → **Continue with Global.Church** (no name) → nameless home → connected → **RoleHub** chooses role | Primary CTA "Continue with Global.Church". No name required, no role gate, no bridge. After connect: the hub's two role cards. |
| S2 | First-time, **GCO-intent**, Google | Clicks the landing **DEMAND · GCO** teaser | SAME single connect (teaser is informational, not a gate) → connected → RoleHub → "Set up an organization" | The teaser sets *expectation* ("you'll post needs as an org") but routes to the identical credential-first connect. The org-create is step 2 from the hub. |
| S3 | First-time, **KC-intent**, Google | Clicks the landing **SUPPLY · KC** teaser | SAME single connect → connected → RoleHub → "Offer your expertise" opens the KC workspace | Same as S2; KC needs no org. |
| S4 | First-time, **named** (wants a handle now) or passkey/wallet | Wants a memorable home / a device-bound or wallet credential | Reveals the secondary "Use my Impact name instead" disclosure → types name → popup at `<label>.impact-agent.me` | Name field is SECONDARY, behind a disclosure. Passkey is subdomain-bound, so the name is genuinely load-bearing here (spec 257 §1.5: passkey-new stays named). |
| S5 | Returning, Google (nameless or named) | Has a (possibly expired) session or none; one Google account = one home | Single "Continue with Global.Church" → broker resolves the **existing** home (1 agent) → straight into workspace at the restored role | NO name. "We found your Impact home." If the session is still valid + unexpired, the App restores the workspace directly (no connect screen at all). |
| S6 | Returning, **named** (passkey/wallet) | Has a named home `<label>.impact-agent.me` | Single connect → if they need to re-assert the credential, the secondary name disclosure resolves their subdomain home; passkey/wallet signs them back in | Same single entry point; the name path is how a passkey/wallet user reaches their per-handle RP. |
| S7 | Returning, **session valid** (any credential) | `loadSession` returns a live kc/gco session, no `?code` in URL | App's restore effect routes **straight to the workspace** — they never see ConnectScreen | "Welcome back, same workspace." Identity pill shows their name (or "you" if nameless). |
| S8 | Returning, **session expired / version-skewed / DM-rotated** | `validate()` rejects the blob → treated as signed-out | Lands on Landing as if first-time → single connect → resolves to the **existing** home (not a new one) | Must NOT feel like identity loss. The credential resolves the same SA; their vault data is intact. This is the failure mode where a name-first wall would be most harmful (fragmentation). |
| S9 | Returning Google user who typed a **different name** | Reveals the name disclosure, types a name that doesn't match their one Google home | Broker's "one Google account, one home" reconciliation: resolve to the existing home, ignore the typed name (spec 257 §1.5 self-skips the mismatch screen when appropriate) | They are NOT sent to a duplicate/new home. Friendly "you already have a home" resolution, never a silent second identity (ADR-0013 NFR-4). |
| S10 | Nameless member who later wants a handle | Already connected (nameless), identity shows "you" | NOT a demo-gs connect concern — claiming a public handle happens in the **Impact portal** (`ClaimPublicNameCard`, spec 257 §1.5). demo-gs only links out to "open your home." | The connect surface must not pressure a name; the handle is a later, optional, portal-side choice. |

**Cross-cutting:** for EVERY segment the *primary* surface is the credential-first CTA. The name is
only ever required where the credential is subdomain-bound (passkey) or where the user deliberately
wants a custom public handle — and that requirement lives behind a secondary disclosure, never as the
default field-with-validation that blocks the button.

---

## 2. End-to-end journey maps

### 2a. Primary nameless first-connect (S1) — the target flow

```
Landing (/)                     single primary CTA "Continue with Global.Church"
  │  (also: GCO / KC teasers → same goConnect)
  ▼
ConnectScreen [idle/card]       credential-first copy; name is a SECONDARY disclosure (collapsed)
  │  user clicks the primary CTA (NO name typed, NO bridge)
  ▼
ConnectScreen [opening-popup]   site dims; CTA enters busy/loading; popup opens at the Connect origin
  │  popup: Continue with Google (credential chosen AT Impact, not here)
  ▼
ConnectScreen [waiting]         AC_PROGRESS messages drive the CTA label ("Opening secure connect…" → broker msgs)
  │  popup posts AC_SUCCESS{code} (or relays via BroadcastChannel after Google COOP severs the opener)
  ▼
finishConnect(inPlace=true)     exchange code → person SA + site-login delegation; build kc session;
  │                              registerMember; best-effort GCO discovery; toast "Connected · welcome"
  ▼
RoleHub                         the connected intranet home — the user PICKS a role here:
                                 • "Offer your expertise (KC)" → KC workspace
                                 • "Set up an organization (GCO)" → org-create ceremony (step 2)
```

Key properties: **no page reload** (popup success finishes in place); **no role gate** before connect;
**no name** typed or required; **no "Taking you to your Impact home" interstitial** before the popup.
Role selection is **deferred to the RoleHub**, and the landing's two role teasers are **expectation
setters** that route to the identical connect — they pre-frame "what you'll do" but never branch the
credential flow.

### 2b. Reconnect per credential

```
RETURN, session still valid (S7) ─► App restore effect ─► straight to workspace (NO ConnectScreen)

RETURN, Google, no/expired session (S5/S8) ─► Landing ─► single CTA "Continue with Global.Church"
    ─► popup ─► broker resolves 1 agent ("found your home") ─► finishConnect ─► RoleHub/workspace
    (no name; the same SA; expired-session reconnect must re-mint a fresh grant, not fail closed visibly)

RETURN, passkey/wallet, named (S6) ─► Landing ─► single CTA ─► reveal "Use my Impact name instead"
    ─► type <label> ─► popup at <label>.impact-agent.me ─► passkey/wallet asserts ─► finishConnect
```

The **single entry point serves all reconnects**: Google resolves with no name; passkey/wallet reach
their per-handle RP via the secondary name disclosure. There is **no name-first wall** — the name is
revealed only when the user's credential genuinely needs the subdomain.

### 2c. Where role selection happens

Role is **never** chosen at connect. After any first-connect the user lands in the **RoleHub**
(`view==='hub'`), which offers KC (opens the workspace) and GCO (launches the org-create ceremony with
the connected person as signatory). On reconnect, the App restores the **last-used role** preference
(`loadActiveRole`) straight into a workspace. The landing's GCO/KC teasers relate to this single connect
as **informational pre-framing only**: both `onConnect` handlers call the same `goConnect` → identical
`ConnectScreen`.

---

## 3. Exhaustive connect STATE inventory

The connect surface is a small state machine. Below, each state + the desired UX. (Current code drives
this through `ConnectScreen` local state: `busy`, `progress`, `err`, `showBridge`, `blocked`, plus the
popup result discriminant from `connect-launch.ts`.)

| State | Trigger | Desired UX | Current behavior / change |
|-------|---------|-----------|---------------------------|
| **idle / card** | View enters `connect` | Connect card: primary credential-first CTA, secondary "Use my Impact name instead" disclosure (collapsed), inline trust reassurance (the co-brand / "your home holds keys" note moved here from the bridge). Back link. | Card exists but leads with the name field as a visible (optional) input + a generic CTA. **Change:** demote the name to a secondary disclosure; lead with the credential CTA. |
| **opening-popup (busy/dim)** | User clicks the primary CTA (or confirms the name disclosure) | Site dims; CTA → busy/loading with "Opening secure connect…"; popup opens. **No interstitial first.** | Currently `cont()` sets `showBridge=true` → renders `HandoffBridge variant="new-user"` BEFORE the popup. **Change:** remove the bridge; `cont()`/CTA fires `launch()` (the popup) directly. |
| **waiting-for-confirmation** | Popup open, user acting at Impact | CTA shows live `AC_PROGRESS` labels; site stays dimmed; the co-brand "From Global.Church" pill is the load-bearing trust element in the loading state (per 257 greenfield). | Already driven by `onProgress`/`AC_PROGRESS`. Keep. |
| **success → hub** | Popup posts `AC_SUCCESS{code}` (or relay) | `finishConnect(inPlace=true)`: set session, hydrate in background, route to RoleHub, toast "Connected · welcome[, name]". No reload. | Exists. Keep. |
| **cancelled** | `AC_CANCEL`, popup abandoned (5-min timeout), or user dismisses | Return to the **idle/card** state; clear busy/progress; no error banner. | Exists (`res.status==='cancelled'` → back to form). Keep. With the bridge removed, "cancel" is only the popup-side cancel — there is no pre-popup bridge cancel to handle. |
| **popup-blocked → redirect fallback** | `window.open` returns null → `status:'blocked'` | EXPLICIT co-branded interstitial ("Global.Church → Impact", one-tap-to-your-home), then a full-page redirect via `startConnect` (ADR-0013 explicit, never silent). | Exists (`PopupBlocked` → `redirectFallback` → `startConnect(trimmed||undefined)`). **Keep** — this is the one interstitial that stays. |
| **error** | `AC_ERROR`, exchange failure, missing grant | Surface the error in the card (`Banner`); stay on the card so the user can retry. Grant-missing copy is honest (ADR-0013: no silent fallback). | Exists via `setErr` + `finishConnect` returning false → `onConnected` returns false → clear busy. Keep. |
| **"you already have a home"** (S9) | Returning Google user typed a *different* name | Broker reconciliation resolves to the existing home (one Google = one home); the mismatch screen self-skips when the requested name is empty, else surfaces a friendly "we found your home" (NOT a duplicate identity). | Broker-side (spec 257 §1.5 / §7). demo-gs just consumes the resolved `authOrigin` from the popup result. **No demo-gs state needed** beyond honoring the resolved origin; do NOT re-derive a subdomain from the typed name. |
| **nameless member wants a handle** (S10) | Connected, nameless | Out of scope for connect — handled in the Impact portal. demo-gs links out ("open your home"). The connect card must NOT push a name. | `onOpenHome` already routes nameless members to the apex (`resolveAuthOrigin('')`), never `personalHome('')`. Keep. |
| **session expired / restore-reject** (S8) | `validate()` rejects the stored blob (version skew, TTL, DM rotation) | Treated as signed-out → Landing → single connect → resolves the **same** SA. Must not read as identity loss. | `loadSession` purges + returns null → App restore effect sends to Landing. Keep; ensure copy on reconnect reassures ("welcome back" once resolved). |
| **multi-tab** | Two demo-gs tabs; one connects, the other has a stale view | The session lives in `localStorage` + a `subscribeSessions` store; the connecting tab `bump()`s. Other tabs re-render reactively on focus/storage. In-flight popup state is per-tab (component state) and must not leak across tabs (the `state`/`expectedOrigin` guard prevents cross-binding a relayed code). | The relay channel + `state` guard (audit F5) already prevent a code meant for tab A from binding tab B. Acceptable. Note: a second tab opening its own popup concurrently is a rare demo edge; each popup is `state`-scoped, so no cross-bind. |

---

## 4. Reconnect mechanics per credential

| Credential | Reconnect mechanic | Name needed? | Surface |
|-----------|-------------------|--------------|---------|
| **Google** | "Continue with Global.Church" → broker resolves `(iss,sub)` → existing SA ("one Google = one home", spec 257 NFR-5). On `many` (rotation / separate named home) the broker shows an account chooser (human names + dates, never raw addresses). | **No** | The single primary CTA. No name disclosure needed. |
| **Passkey** | The per-handle RP is `<label>.impact-agent.me`; the label is load-bearing in the CREATE2 rpIdHash (257 §1.5), so the passkey assertion must happen at the named subdomain. | **Yes** (the public handle = the subdomain) | Reached via the secondary "Use my Impact name instead" disclosure → popup at `<label>.impact-agent.me`. |
| **Wallet / SIWE** | Reached only after a typed name today (the wallet-via-enroll path follows a name). SIWE verify → resolves the SA. | **Yes** (today) | Same secondary name disclosure. (Future: wallet-first resolution is a broker concern, not this surface.) |

**How one entry point serves all without a name-first wall:** the **primary** CTA is credential-first
and covers the dominant Google reconnect with no name. The **secondary** disclosure ("Use my Impact name
instead") is the deliberate fallback for (a) passkey/wallet users whose credential is subdomain-bound,
and (b) anyone who wants to resolve a specific named home directly. The name is therefore *available* but
never *required to proceed* on the primary path. This matches spec 257 §3 ("two buttons, name demoted").

---

## 5. Validated / refined implementation plan

The user's plan touches `ConnectScreen.tsx`, `HandoffBridge.tsx`, `OnboardPanel.tsx`,
`connect-launch.ts`. Grounded in the current code, here is the confirmed/adjusted plan plus gaps the
plan misses.

### 5a. `ConnectScreen.tsx` — CONFIRM, with refinements
- **Remove the pre-popup bridge.** Today `cont()` sets `showBridge=true` and the component renders
  `HandoffBridge variant="new-user"` before `launch()`. **Delete `showBridge` + the bridge render +
  the `HandoffBridge` import.** `cont()` (or the CTA directly) calls `launch()` → `startConnectPopup`
  immediately. This is the core of the user's direction and is correct.
- **Demote the name.** Lead with the primary credential-first CTA; move the name `TextField` behind a
  secondary "Use my Impact name instead" disclosure (collapsed by default). Keep the
  `toAgentName`/`personalHome` preview *inside* the revealed disclosure.
- **Keep** the popup-blocked `PopupBlocked` interstitial + `redirectFallback` (ADR-0013 explicit
  fallback) — unchanged. This is the only interstitial that survives.
- **Move trust reassurance into the card + loading state.** The "your home holds your keys / co-brand"
  reassurance that was in the bridge body becomes (i) a line in the connect card and (ii) the co-brand
  pill in the busy/waiting state. (The existing `.soon` note already does part of this.)
- **Keep** `LAST_NAME_KEY` prefill, but only inside the (now secondary) name disclosure.

### 5b. `HandoffBridge.tsx` — REDUCE scope
- The `'new-user'` variant becomes **unused** in ConnectScreen after 5a. 
- **GAP the plan should flag:** the `'reconnect'` variant is **already dead** — grep confirms it is
  defined (`HandoffVariant` + a `variantCopy` case) but **referenced by no call site**. No redirect path
  uses it. It should be **removed** as part of this cleanup (dead UX, and it contradicts the "no
  pre-ceremony bridge" direction).
- The `'org-create'` variant is **still in active use** in `App.tsx` (`GcoOrgCreate` → `HandoffBridge
  variant="org-create"`). That is the GCO org-create step-2 ceremony — a **known-passkey** path where a
  one-step preview is still appropriate. **Keep it.** So `HandoffBridge` survives as an **org-create-only**
  component (drop `'new-user'` + `'reconnect'`, keep `'org-create'`), OR is renamed to reflect its single
  remaining purpose. Decision for the designer/implementer; either way the file is NOT deleted.

### 5c. `OnboardPanel.tsx` — REQUIRED CHANGE the plan must address (GAP)
- **This is the alternate name-first path the user must remove.** `OnboardPanel` (a) **requires a name**
  (`if (!trimmed) setErr('Choose your Global.Church name…')`), (b) calls **`startConnect(trimmed)`** — the
  full-page **redirect**, not the popup, not credential-first — and (c) is rendered by **`KcView`** and
  **`GcoView`** whenever there's **no session** (`if (!session) return <OnboardPanel kind="kc" />`).
- That means a user who reaches a workspace route without a session (e.g. a stale link, a cleared
  session, or any path that lands on a workspace view) hits a **name-required, redirect-only,
  non-credential-first** sign-in — exactly the wall the redesign is removing on the main path. It is a
  **second mechanism** for the same connect, which also violates the spirit of ADR-0013's
  "one mechanism."
- **Required fix:** the no-session branch in `KcView`/`GcoView` must route to the **same credential-first
  connect** (the `ConnectScreen` flow / `goConnect`), NOT a name-first `OnboardPanel.connect()`. Options:
  (i) drop `OnboardPanel`'s own `connect()` and have its CTA call `goConnect` (lift it to a prop), or
  (ii) replace the no-session render with a redirect to `view='connect'`. Either way **`OnboardPanel`
  must no longer offer a name-required person-login** via `startConnect`. The informational flow-steps
  content can stay as marketing, but the *sign-in action* must be the credential-first one.
- Note `OnboardPanel` re-exports `CONNECT_KEY`/`ConnectStash` (consumed by App's return handler). Keep
  the re-export OR move the import to `connect-launch` in App — a trivial follow-through, but flag it so
  the re-export isn't orphaned when `OnboardPanel`'s login logic is gutted.

### 5d. `connect-launch.ts` — CONFIRM, no signature change needed
- `startConnectPopup(name?)` and `startConnect(name?)` already accept an **optional** name and pass
  `undefined`/empty through to `startSiteEnrollment` (credential-first when empty). **No change required**
  to the launcher signatures. The empty-name → apex resolution is already correct.
- The plan does NOT need to change `connect-launch`; it only changes **callers** (ConnectScreen passes
  `trimmed || undefined`; OnboardPanel stops calling `startConnect` with a required name). Confirm the
  plan treats `connect-launch` as stable.

### 5e. Does the landing role-teaser CTA route through the new ConnectScreen? — CONFIRMED YES
- `Landing` takes a single `onConnect` and BOTH the primary CTA and the two role-teaser CTAs
  (`Connect to post a need →` / `Connect to offer a skill →`) call it. In `App.tsx`, `onConnect={goConnect}`
  → `setView('connect')` → `ConnectScreen`. So the teasers already funnel into the single connect surface;
  no role is passed. **No change needed** — but the redesign should keep the teasers purely
  informational (no role param sneaking in).

### 5f. Summary of the plan's gaps (what the user's plan as stated misses)
1. **`OnboardPanel` still gates a name-required, redirect-only person-login** rendered by both
   workspaces' no-session branch — this is the second, contradictory mechanism that MUST be removed/redirected.
2. **`HandoffBridge variant='reconnect'` is dead code** — no call site; remove it (the plan focuses on
   `new-user` but should sweep `reconnect` too).
3. **`HandoffBridge` is NOT deletable** — `variant='org-create'` is still live for GCO org-create step 2.
   The plan should scope the change to "remove the new-user pre-popup bridge + dead reconnect variant,"
   not "remove HandoffBridge."
4. **`connect-launch` needs no signature change** — only callers change. Confirm the plan doesn't
   over-edit the launcher.
5. **The `CONNECT_KEY`/`ConnectStash` re-export from OnboardPanel** must be preserved (or relocated) when
   OnboardPanel's login logic is gutted, so App's return handler import doesn't break.

---

## 6. Acceptance criteria + focused test list

The assertions the implementation must pass (UI/behavioral; demo-gs is a Vite SPA with vitest):

**Primary credential-first connect**
- **A1.** From the Landing primary CTA → `ConnectScreen` renders with the name field **not** the primary
  control (it is behind a "Use my Impact name instead" disclosure).
- **A2.** Clicking the primary CTA with **no name** invokes `startConnectPopup(undefined)` (i.e. the
  trimmed-empty → `undefined` path) and **renders NO `HandoffBridge`** before the popup opens.
- **A3.** Revealing the name disclosure, typing a name, and connecting invokes
  `startConnectPopup(<name>)` and still renders **no `HandoffBridge`**.
- **A4.** On `startConnectPopup` returning `status:'success'`, the App calls `finishConnect(..., {inPlace:true})`,
  sets the session, routes to the **RoleHub** (not a workspace, not a reload), and toasts.

**Popup-blocked fallback**
- **A5.** When `startConnectPopup` returns `status:'blocked'`, the `PopupBlocked` interstitial renders,
  and its Continue invokes `redirectFallback` → **`startConnect(nameOrUndefined)`** (the explicit
  full-page redirect, ADR-0013). No silent reflow.
- **A6.** `status:'cancelled'` returns to the idle card with no error banner; `status:'error'` surfaces the
  error in the card and stays on the card.

**No second mechanism (the OnboardPanel gap)**
- **A7.** `OnboardPanel` (or whatever the workspaces render when session-less) **no longer offers a
  name-required person-login** — there is no path where a missing session forces a name before
  `startConnect`. The session-less workspace branch routes to the **credential-first connect**
  (`ConnectScreen`/`goConnect`), not `OnboardPanel.connect()`.
- **A8.** Grep/structural: no call to `startConnect(` from a `name`-required guard that blocks on empty
  (`if (!trimmed) setErr(...)`) survives in the app's primary connect paths.

**HandoffBridge scope**
- **A9.** `HandoffBridge variant='new-user'` and `variant='reconnect'` are removed (no remaining
  references); `variant='org-create'` remains and the GCO org-create ceremony (`GcoOrgCreate`) still
  renders it unchanged.

**Reconnect**
- **A10.** A returning member with a **valid** session (no `?code` in URL) is restored **straight to the
  workspace** (`view='workspace'`) at the persisted role — `ConnectScreen` never renders.
- **A11.** A returning member with an **expired/version-skewed/DM-rotated** session lands on the Landing
  (signed-out) and the single credential-first connect resolves the **same** SA (no duplicate identity).
- **A12.** A nameless member's `onOpenHome` routes to the platform apex (`resolveAuthOrigin('')`), never
  `personalHome('')`; the identity pill renders "you" (never a raw SA / junk subdomain). (Regression guard
  from spec 257 §1.5 — already passing; keep covered.)

**Landing**
- **A13.** Both the primary CTA and the GCO/KC role-teaser CTAs route to the **same** `ConnectScreen` via
  `goConnect` with **no role parameter**; role selection happens only in the RoleHub.

---

## 7. Risks + success metrics

### Risks
- **R1 — Identity fragmentation on expired-session reconnect (highest).** If the reconnect path ever
  routes a returning user through a name-first wall (the OnboardPanel gap, §5c), a mistyped/forgotten name
  resolves to 0 agents → a *new* home, not theirs (ADR-0013 NFR-2). The fix (A7/A11) is load-bearing.
- **R2 — Trust loss from removing the bridge.** The bridge's job was to pre-explain the Impact domain
  transition so the popup isn't mistaken for phishing. Removing it without folding the reassurance into
  the card + the co-brand loading pill could *increase* abandonment at the popup. Mitigation: the
  co-brand "From Global.Church" pill in the busy/waiting state is a **requirement**, not decoration
  (spec 257 greenfield).
- **R3 — Popup-blocked drop-off.** Mobile + popup-blocking browsers fall to the redirect. The
  interstitial copy must make the round-trip feel safe ("we'll bring you right back"). Keep `preferRedirect()`
  honored so mobile goes straight to redirect rather than a doomed popup.
- **R4 — "One Google, one home" mismatch confusion (S9).** A returning Google user who types a stale
  different name must be reconciled to their existing home, not duplicated. This is broker-side
  (257 §1.5/§7); demo-gs must honor the resolved `authOrigin` and never re-derive a subdomain from the
  typed name (already correct in `finishConnect`/discovery; keep covered).
- **R5 — Org-create regression.** The `org-create` bridge must stay intact; scoping the HandoffBridge
  change too broadly (deleting the file) would break GCO step 2.

### Success metrics — what "works great" means
- **First-connect, nameless (Google):** a brand-new user reaches the **RoleHub** from the Landing in a
  single popup ceremony, **without typing a name**, **without a pre-popup interstitial**, and with no role
  gate — then picks KC/GCO in the hub.
- **First-connect, named (passkey/wallet):** a user who *wants* a handle reveals the secondary disclosure,
  types a name, and lands at their named subdomain home — the name path is one click away, never in the way.
- **Reconnect, Google (nameless or named):** returning users get back into their workspace from one
  "Continue with Global.Church" with **no name**, and a valid session skips the connect screen entirely.
- **Reconnect, named:** passkey/wallet users reach their per-handle RP via the same single entry point's
  secondary name disclosure — no separate "reconnect" surface.
- **No second sign-in mechanism anywhere:** every signed-out → connected transition (Landing CTA, role
  teasers, session-less workspace) funnels through the one credential-first `ConnectScreen`; the
  name-required redirect-only `OnboardPanel` login is gone.
- **The surface reads as a product sign-in, not a protocol handoff:** no CAIP-10 / SA address / "custody"
  jargon on the primary surface (257 NFR-3); the SA lives only in a "Details" disclosure if anywhere.
