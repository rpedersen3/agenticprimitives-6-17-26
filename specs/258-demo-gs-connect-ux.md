# Spec 258 — demo-gs (Global Switchboard) connect / reconnect UX

**Status:** implemented (app-layer UX). **Scope:** `apps/demo-gs` only — no package, contract, or
broker change. **Builds on:** [257](257-credential-first-connection.md) (credential-first /
name-deferred spine — the architecture-of-record for this surface), [250](250-demo-gs-global-switchboard.md)
(the 4-role Switchboard product), [252](252-*) (member-owned vaults / Wave 2).
**ADRs:** [0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md) (canonical
SA = identity), [0011](../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)
(credentials rotate, identity persists), [0013](../docs/architecture/decisions/0013-no-silent-fallbacks.md)
(no silent fallbacks), [0021](../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)
(generic packages / white-label apps).

**Design package (authoritative visual + component target):**
[`docs/design/258-demo-gs-connect-ux/`](../docs/design/258-demo-gs-connect-ux/) —
[`component-spec.md`](../docs/design/258-demo-gs-connect-ux/component-spec.md) (the build sheet) +
[`product-analysis.md`](../docs/design/258-demo-gs-connect-ux/product-analysis.md) (journeys, states,
edge cases, acceptance criteria A1–A13) + 10 SVG mockups.

---

## 1. Principle — credential-first; the name is a public handle, not a login key

Inherited from spec 257 and applied to the demo-gs relying surface: the relying site must read like a
**normal product sign-in**, not a protocol handoff. The **credential** (Google / passkey / wallet) is
the front door; the **Impact name is a PUBLIC HANDLE** — a way for others to find your agent, never a
password and never required to sign back in. The credential is chosen AT the Impact home (the broker's
W1 entry), not on the relying site; demo-gs only passes an optional name *hint*.

This removes two pieces of friction the old surface carried:

1. the always-visible **name field** that read as a required login input, and
2. the transient **"Taking you to your Impact home" HandoffBridge** that fired *before* the user had
   chosen a credential — duplicate CTAs, a domain transition explained before the user initiated it,
   and a 3-second auto-advance timer working against deliberate consent.

The bridge's trust reassurance is folded INTO the connect card body + the busy/dim loading state.

## 2. The one-card flow

```
Landing ──goConnect()──> ConnectScreen   (the primary CTA + both GCO/KC role teasers all route here,
    ConnectScreen                          no role parameter — role is chosen later, in the RoleHub)
        primary CTA "Continue with Global.Church"
            ──> launch() DIRECTLY — no bridge ──> startConnectPopup(trimmed || undefined) + busy/dim
            ──> popup SUCCESS   ──> finishConnect(inPlace=true) ──> RoleHub (no reload, toast)
            ──> popup BLOCKED   ──> PopupBlocked card ──> redirectFallback() → startConnect() (explicit)
            ──> popup CANCELLED ──> soft warn banner ("Sign-in was cancelled — you can try again below.")
            ──> popup ERROR     ──> error banner; primary CTA relabels "Try again" (same handler)
        secondary "Use my Impact name instead"
            ──> inline NAME panel (TextField + .impact / .impact-agent.me preview) — no new screen
            ──> same launch() path; the typed name is a hint only
    RoleHub        KC → workspace · GCO → org-create ceremony (step 2)
```

**Reconnect** rides the same single entry point: a valid session is restored straight to the workspace
(`ConnectScreen` never renders); an expired / version-skewed / DM-rotated session lands on the Landing
and the same credential-first connect resolves the **same** SA (no duplicate identity — the load-bearing
guard against identity fragmentation, product-analysis R1). Google reconnect needs no name; passkey /
wallet reach their per-handle RP via the secondary name disclosure.

## 3. State machine (ConnectScreen)

| State | Trigger | UX |
|---|---|---|
| idle / card | view enters `connect` | primary CTA + collapsed secondary name disclosure; back link |
| opening-popup (busy/dim) | primary CTA clicked | fixed dim overlay behind the card; CTA → Spinner + `'Opening your Impact home…'` |
| waiting | popup open | CTA shows live `AC_PROGRESS` labels (`aria-live="polite"`) |
| success → hub | `AC_SUCCESS{code}` | `finishConnect(inPlace=true)` → RoleHub, toast; no reload |
| cancelled | `AC_CANCEL` / 5-min timeout / dismiss | soft `tone="warn"` banner; cleared on the next `cont()` |
| blocked → redirect | `window.open` null | `PopupBlocked` card → `redirectFallback()` → `startConnect()` (ADR-0013 explicit) |
| error | exchange / `AC_ERROR` | `tone="err"` banner; CTA relabels "Try again"; stays on the card |

State inventory: added `showNamePanel` + `cancelled`; removed `showBridge`. Focus management: CTA on
mount, the TextField when the panel expands, the redirect CTA on the PopupBlocked card. Fine print uses
`--c-g500` (~4.6:1) per the a11y note, not the ~2.9:1 mute.

## 4. OnboardPanel — the name-first wall removed

`OnboardPanel` is the session-less fallback rendered by `GcoView` / `KcView` (a stale link, a cleared
or expired session). It previously **required a name** and called `startConnect()` (full-page redirect
only) — a **second, contradictory** sign-in mechanism (ADR-0013). It is now **content-only /
credential-first**: it keeps the role explanation (title / who / body / steps) and routes to the SAME
`ConnectScreen` via a new `onConnect` prop (`App` passes `goConnect`). The name `TextField`, the
`if (!trimmed) setErr(...)` guard, and the `startConnect` call are gone. The
`CONNECT_KEY` / `ConnectStash` re-export is preserved (its canonical source is `lib/connect-launch`,
which `App` imports directly; the re-export is harmless and kept).

## 5. HandoffBridge — scope reduced to `org-create` only

The `'new-user'` variant (the only one `ConnectScreen` used) and the **dead** `'reconnect'` variant
(no call site) are removed; the `HandoffVariant` union narrows to `'org-create'`. The file is NOT
deleted — `App.tsx`'s `GcoOrgCreate` still renders `variant="org-create"` for the GCO org-create
ceremony (step 2 from the hub, a known-passkey deliberate-confirm step). `connect-launch.ts` is
unchanged — only callers changed.

## 6. ui.tsx — Banner a11y

`Banner` gains `role="alert"` for `tone="err"` (assertive) and `role="status"` for `tone="warn"`
(polite). Cross-cutting, benefits every demo-gs usage. (`TextField` also gains an optional `inputRef`
so the connect card can focus the name field when the secondary panel expands.)

## 7. Acceptance criteria

See product-analysis §6, **A1–A13**. The DOM-rendering criteria (A1–A6: the card lays out the primary
CTA above the collapsed disclosure, the busy/dim overlay, the banners) are validated visually against
the 10 mockups; demo-gs has no jsdom / testing-library harness, so they are not asserted in CI and are
DEFERRED to a future component-test setup. The source-shape criteria are guarded by
`src/components/connect-ux.test.ts`: **A9** (no `variant="new-user"` / `variant="reconnect"` anywhere;
`variant="org-create"` still in `App.tsx`; the narrowed union), **A7/A8** (OnboardPanel no longer calls
`startConnect`, has no name-required guard, accepts `onConnect`), and the ConnectScreen invariants (no
`showBridge` / `HandoffBridge`; `startConnectPopup` primary; `startConnect` retained for the explicit
blocked fallback). A4/A10–A13 (finishConnect inPlace → RoleHub, session-restore routing, landing-teaser
routing, nameless "you" identity) are unchanged behaviours preserved from spec 257 and covered by the
existing suite.

## 8. Reference: smart-agent patterns to port

**N/A — deliberate divergence.** This is purely an **app-layer relying-site connect UI** redesign: no
capability package, contract, or broker behaviour changes. `smart-agent` has **no relying-app
connect-UI analog** to port from — the credential-first / name-deferred connection *mechanics* this UX
sits on were already established by spec 257 (which itself is the architecture-of-record for the
demo-sso / Impact Connect surface, not smart-agent). The visual + interaction target is the design
package under `docs/design/258-demo-gs-connect-ux/`, not a smart-agent pattern.
