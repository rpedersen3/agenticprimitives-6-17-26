# Spec 258 — demo-gs connect UX: component-level implementation spec

**Status:** Design-complete, awaiting implementation  
**Design mockups:** `docs/design/258-demo-gs-connect-ux/` (10 SVGs + `index.html`)  
**Companion product spec:** `specs/258-demo-gs-connect-ux.md` (to be written)  
**Synthesise with:** Product Analyst journey/states analysis (parallel deliverable)

---

## 1. Goal and users

Remove the friction introduced by the `HandoffBridge new-user` variant and the always-visible name
field. One entry point, one primary CTA, one secondary disclosure path. All three connect paths
(Google/credential-first, named/passkey-wallet, reconnect) flow naturally from a single card.

**Primary users:** first-time KC / GCO candidates arriving at demo-gs with no prior account.  
**Secondary users:** returning members reconnecting.  
**Tertiary users:** named-path users (passkey / wallet) who know their Impact handle.

---

## 2. Flow summary

```
Landing ──onConnect()──> ConnectScreen
    ConnectScreen
        primary: [Continue with Global.Church]
            ──> launch() directly (NO bridge)
            ──> startConnectPopup() + busy/dim state on the page
            ──> popup SUCCESS ──> finishConnect(inPlace=true) ──> RoleHub
            ──> popup BLOCKED ──> PopupBlocked card ──> redirectFallback()
            ──> popup CANCELLED ──> back to ConnectScreen (soft warn banner)
            ──> popup ERROR ──> back to ConnectScreen (error banner)
        secondary: [Use my Impact name instead]
            ──> NameHandlePanel expands inline (no new screen)
            ──> user types name ──> same launch() path (name passed as hint)
    RoleHub
        KC: [Offer your expertise] ──> openWorkspace('kc')
        GCO: [Set up an organization] ──> setupGcoOrg(signatory)
```

---

## 3. ConnectScreen — changes

### 3a. Remove the HandoffBridge new-user gate

**Current code (delete this):**
```tsx
// In cont():
setShowBridge(true);

// In render:
if (showBridge) {
  return <HandoffBridge variant="new-user"
    onContinue={() => void launch()}
    onCancel={() => setShowBridge(false)} />;
}
```

**New behaviour:** `cont()` calls `launch()` directly. The `showBridge` state variable and the
`new-user` render branch are deleted entirely. The trust reassurance that lived on the bridge card
moves INTO the ConnectScreen card body (see copy section below).

**Rationale:** The bridge presented duplicate CTAs, explained a domain transition the user had not
yet initiated, and added a 3-second auto-advance timer that worked against deliberate interaction.
Trust copy belongs at the moment of decision, not on a separate screen.

### 3b. Rename and reframe `cont()`

The function currently sets `showBridge`. After the change it calls `launch()` directly:

```tsx
function cont() {
  setErr(null);
  void launch();   // launch popup directly — no bridge gate
}
```

`launch()` already sets `busy(true)` and `setProgress('Opening your Impact home…')`, so the
button enters its loading state immediately.

### 3c. Busy / dim state (new)

When `busy === true`, apply a dim overlay to the page content BEHIND the connect card. The simplest
implementation is a fixed-position overlay `div` (pointer-events: none, z-index below the card).
The card itself stays at full opacity. The button label transitions to the `progress` string.

**The button in busy state:**
- Label: `progress ?? 'Opening your Impact home…'`
- Show `<Spinner size="sm" />` inline before label
- `disabled={true}`
- Background: `--c-primary` (indigo, same shade — not greyed out; the action is in flight)

**Progress label sequence (driven by `AC_PROGRESS` popup messages):**
1. `'Opening your Impact home…'` (immediate, before popup open)
2. `'Waiting for confirmation…'` (after popup opens, waiting for user action in popup)

Both strings are shown in the CTA button. The second can also appear as a small helper text below
the button (see copy section).

### 3d. Secondary "Use my Impact name instead" path (new state)

Add a new `showNamePanel: boolean` state (default `false`). A text-link button below the primary
CTA toggles it.

**Collapsed state (showNamePanel === false):**
```
[Continue with Global.Church]     ← primary CTA, full width

Use my Impact name instead        ← text link, centred below CTA

Your Impact name is a public handle people can use to find your agent.
You do not need it to sign back in.
```

**Expanded state (showNamePanel === true):**

Below the primary CTA (which stays visible and unchanged), show an inline panel:

```
── divider ──────────────────────────────────────────

YOUR IMPACT NAME                   ← eyebrow label, uppercase, muted

Your public handle — people can find your agent by this name.

[   text input: placeholder "e.g. rich-pedersen"  ]  ← TextField mono

  rich-pedersen.impact · rich-pedersen.impact-agent.me  ← preview, shown when trimmed
                                              [available]  ← pill

Your Impact name is a public handle. You do not need it to sign back in.

Hide — use Google or passkey without a name      ← collapse link
```

The `TextField` uses the existing component from `ui.tsx` with `mono={true}` and the same
lowercase-alphanumeric filter as the current name field. The `.impact` and `.impact-agent.me`
preview are shown when `trimmed.length > 0` using `toAgentName()` and `personalHome()` from
`lib/domain.ts`.

The name value is passed to `cont()` → `launch()` → `startConnectPopup(trimmed || undefined)`,
which is the same path as today. An empty name is fine — the broker shows its W1 credential-first
entry.

The `LAST_NAME_KEY` localStorage prefill remains: initialize the text field from localStorage on
mount, in the same `useState` initialiser as today.

### 3e. Cancelled state (new soft banner)

When `res.status === 'cancelled'`:
- `setBusy(false); setProgress(null);` (as today)
- NEW: `setCancelled(true)` — a new boolean state, reset on the next `cont()` call

Render a `<Banner tone="warn">Sign-in was cancelled — you can try again below.</Banner>` at the
TOP of the card body, above the eyebrow. The banner is dismissed the next time `cont()` runs.

### 3f. Card layout (complete structure)

```
<Card maxWidth=560 margin="0 auto">
  {cancelled && <Banner tone="warn">Sign-in was cancelled — you can try again below.</Banner>}
  {err       && <Banner tone="err">{err}</Banner>}

  <div className="eyebrow">Connect</div>
  <h2>Connect with Global.Church</h2>
  <p>
    Use your Global.Church identity to enter Switchboard. You can offer your
    expertise or set up an organization after you connect. Switchboard only
    receives the access you approve, and your contact details stay private
    until you accept a connection.
  </p>

  <div style={{ marginTop: '1rem' }}>
    <Pill tone="ok">One identity · roles are workspaces</Pill>
  </div>

  <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>

    {/* Primary CTA — always visible */}
    <button className="btn-sso" onClick={() => void cont()} disabled={busy}>
      {busy ? <Spinner size="sm" /> : '🌐'}
      {busy ? (progress ?? 'Opening your Impact home…') : 'Continue with Global.Church'}
    </button>

    {/* Secondary toggle */}
    {!showNamePanel && (
      <>
        <button onClick={() => setShowNamePanel(true)} style={linkBtn}>
          Use my Impact name instead
        </button>
        <p style={{ fontSize: '.82rem', color: 'var(--c-g500)' }}>
          Your Impact name is a public handle people can use to find your agent.
          You do not need it to sign back in.
        </p>
      </>
    )}

    {/* Name panel — expanded inline */}
    {showNamePanel && (
      <div style={{ borderTop: '1px solid var(--c-g200)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        <label style={eyebrowLabel}>Your Impact name</label>
        <p style={{ fontSize: '.82rem', color: 'var(--c-g600)' }}>
          Your public handle — people can find your agent by this name.
        </p>
        <TextField
          value={name}
          placeholder="e.g. rich-pedersen"
          mono
          disabled={busy}
          onChange={(v) => setName(v.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
          onEnter={() => void cont()}
        />
        {trimmed && (
          <div style={{ fontSize: '.75rem', color: 'var(--c-g500)', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
            {toAgentName(trimmed)} · home at {personalHome(trimmed)}
          </div>
        )}
        <p style={{ fontSize: '.78rem', color: 'var(--c-g500)', margin: 0 }}>
          You do not need a name to sign back in — it is a public handle, not a password.
        </p>
        <button onClick={() => setShowNamePanel(false)} style={linkBtn}>
          Hide — use Google or passkey without a name
        </button>
      </div>
    )}

    {/* Back link */}
    <button onClick={onBack} style={linkBtn} disabled={busy}>← Back</button>
  </div>
</Card>
```

---

## 4. HandoffBridge — changes

### Keep: `'org-create'` variant
No changes. The GCO org-create ceremony in `GcoOrgCreate` (App.tsx) correctly shows the bridge
before firing `startOrgCreation`. The passkey-known one-step treatment is appropriate here.

### Keep: `'reconnect'` variant
The `'reconnect'` variant should only be used if a full-page redirect path for reconnect is
introduced. Currently, reconnect uses the same popup path as first-connect (the popup shows
"Welcome back" as the Impact home recognises the returning user). The `'reconnect'` variant is
kept in the codebase but is not rendered on the connect path; if a named-path redirect-only
reconnect is ever added it will be used there.

### Remove: `'new-user'` variant
Delete the case from `variantCopy()` and from the `HandoffVariant` type union:

```ts
// Delete this case:
case 'new-user':
// Delete the default that maps to new-user copy.
```

Update `HandoffVariant` type to `'org-create' | 'reconnect'`.

Remove the import of `HandoffBridge` from `ConnectScreen.tsx` (it is no longer used there).

### Developer note
`HandoffBridge` is also imported in `App.tsx` (currently for `ConnectScreen` pass-through — verify
it is not directly rendered at the App level). If the only remaining uses are in `GcoOrgCreate`
(org-create variant), the import at the App level can be removed.

---

## 5. OnboardPanel — audit and fix

**Finding:** `OnboardPanel` is a SECOND unauthenticated connect entry with a name-required field.
It is reached when `!session` inside `GcoView` (with `pendingGco === null`) and `KcView`. These
are the "no session" states of the workspace views, not the landing.

**Current problem:** A user who navigates directly to a workspace URL (or whose session expires)
sees `OnboardPanel`, which requires a name and uses `startConnect()` (full-page redirect only).
This is a regression against the credential-first design.

**Correct fix:** Replace the `OnboardPanel` render in both `GcoView` and `KcView` with a redirect
to `ConnectScreen`. The App already manages the `view` state; the cleanest path is to call
`onHub()` (or add an `onNeedsConnect` prop) so the user lands on the connect screen, then the hub
after connecting.

**Do not delete `OnboardPanel`.** The role-level explanatory content (flow steps, who/body copy)
is valuable for the "What you'll do here" section of the role hub. Consider refactoring:
- Move the copy (`GS.paths[kind]`) into the `RoleHub` card bodies where appropriate.
- Make `OnboardPanel` a content-only component (no name field, no `startConnect` call).
- Or: keep it as a static "what this role does" information card below the RoleHub CTA buttons.

**Interim fix (simpler):** Add an `onConnect: () => void` prop to `OnboardPanel`. When the user
clicks the SSO button, call `onConnect()` instead of `startConnect()`. The App passes `goConnect`
for this prop. This makes the flow credential-first without requiring a full refactor.

---

## 6. RoleHub — no structural changes

The RoleHub itself does not need changes for this spec. The welcome greeting already handles the
nameless case: `name` defaults to `'there'` from the App (`identity?.name ?? 'there'`), and the
App sets `identity.name` to `'you'` for a name-deferred member (via the `||` fallback in App.tsx
line ~344). Verify this renders as "Welcome, you" for the nameless path before shipping.

---

## 7. PopupBlocked — copy update

The existing `PopupBlocked` component in `ConnectScreen.tsx` needs its copy updated (the
structure can stay):

**Current heading:** "One tap to your secure home"  
**New heading:** "Blocked by your browser"

**Current body:** "Your browser blocked the popup, so we'll take you to your Global.Church home and bring you right back."  
**New body:** "Your browser blocked the secure sign-in window. We can take you to your Impact home in this tab and bring you back to Switchboard after you confirm."

**Current CTA:** "Continue to your home"  
**New CTA:** "Continue in this tab"

**Fine print (existing, update wording):** "The page that opens will say impact-agent.me — that is your home, not a new site."

The co-brand pill (`GS.community → Impact`) stays. The Cancel button stays.

---

## 8. Copy — complete strings

### Connect card

| Surface | String |
|---|---|
| Eyebrow | `Connect` |
| Heading | `Connect with Global.Church` |
| Body | `Use your Global.Church identity to enter Switchboard. You can offer your expertise or set up an organization after you connect. Switchboard only receives the access you approve, and your contact details stay private until you accept a connection.` |
| Trust Pill | `One identity · roles are workspaces` |
| Primary CTA (idle) | `Continue with Global.Church` |
| Primary CTA (busy, opening) | `Opening your Impact home…` |
| Primary CTA (busy, waiting) | `Waiting for confirmation…` |
| Secondary link | `Use my Impact name instead` |
| Name panel eyebrow | `Your Impact name` |
| Name panel body | `Your public handle — people can find your agent by this name.` |
| Name panel helper | `You do not need a name to sign back in — it is a public handle, not a password.` |
| Name panel collapse | `Hide — use Google or passkey without a name` |
| Helper (name panel closed) | `Your Impact name is a public handle people can use to find your agent. You do not need it to sign back in.` |
| Back link | `← Back` |

### Popup-blocked card

| Surface | String |
|---|---|
| Co-brand pill | `Global.Church → Impact` |
| Heading | `Blocked by your browser` |
| Body | `Your browser blocked the secure sign-in window. We can take you to your Impact home in this tab and bring you back to Switchboard after you confirm.` |
| Primary CTA | `Continue in this tab` |
| Cancel | `Cancel` |
| Fine print | `The page that opens will say impact-agent.me — that is your home, not a new site.` |

### Cancelled state

| Surface | String |
|---|---|
| Warn banner | `Sign-in was cancelled — you can try again below.` |

### Error state

| Surface | String |
|---|---|
| Error banner heading | `Sign-in failed` |
| Error banner body | `{err}` (the error from the exchange, surfaced verbatim) |
| Primary CTA | `Try again` (change from the idle label only when `err` is set — the CTA function is identical) |

### Success toast (App.tsx, unchanged)

| Surface | String |
|---|---|
| Toast | `Connected · welcome, {displayName}` (falls back to `Connected · welcome` for nameless) |

---

## 9. Interaction model

### Focus management

- On `ConnectScreen` mount: focus the primary CTA button (`autoFocus` or `useEffect` + `.focus()`).
- When `showNamePanel` transitions to `true`: focus the `TextField` (ref + `useEffect` on the
  state transition).
- When `showNamePanel` transitions to `false`: return focus to the "Use my Impact name instead"
  link.
- On `PopupBlocked` mount: focus the primary CTA ("Continue in this tab").
- On error banner appearing: the banner should be `role="alert"` so screen readers announce it.
- On cancelled banner appearing: `role="status"` (less urgent than an error).

### Keyboard navigation

- `Enter` on the name field calls `cont()` (existing behaviour, keep).
- `Escape` in the popup (handled by the popup itself, not the page) closes it; the page receives
  the `cancelled` result and shows the soft warn banner.
- The secondary link and the collapse link are `<button>` elements (not `<a>`) for keyboard
  accessibility and to avoid href-navigation semantics.
- All interactive elements have `min-width: 44px` and `min-height: 44px` on touch targets.

### Popup busy affordance

The dim overlay communicates that interaction with the underlying page is temporarily suspended.
Use `aria-busy="true"` on the main content area (or the card) while `busy === true`. Consider
`aria-live="polite"` on the progress text node so screen reader users hear the state change.

The popup itself is a separate browser window and is not controlled by the page's ARIA tree; the
browser's own window management provides the system-level affordance.

### Dim overlay implementation

```tsx
{busy && (
  <div
    aria-hidden="true"
    style={{
      position: 'fixed', inset: 0,
      background: 'rgba(11, 19, 36, 0.52)',
      zIndex: 10,         // below the card (card at z-index 20)
      pointerEvents: 'none',
    }}
  />
)}
```

The card itself should have `position: 'relative'` and `zIndex: 20` when `busy` is true, so it
reads as the focus point of the dimmed page. This is purely visual; the card is not a modal and
does not trap focus.

---

## 10. State inventory

| State var | Type | Purpose |
|---|---|---|
| `name` | `string` | The Impact name field value (existing) |
| `busy` | `boolean` | Popup is open / exchange in flight (existing) |
| `progress` | `string \| null` | CTA label during busy (existing) |
| `err` | `string \| null` | Error from exchange (existing) |
| `blocked` | `boolean` | Popup was blocked (existing) |
| `showNamePanel` | `boolean` | **NEW** — secondary name panel expanded |
| `cancelled` | `boolean` | **NEW** — soft cancelled banner shown |

Remove: `showBridge: boolean` (deleted with the new-user bridge).

---

## 11. Accessibility notes

- Contrast: all text against white background meets 4.5:1. Indigo `--c-primary` (#4f46e5) on white
  is ~6:1. The muted copy (#94a3b8 on white) is ~2.9:1 — this is below 4.5:1 for normal text.
  Review: the `mute` tokens on fine-print copy should use `--c-g500` (#64748b, ~4.6:1) rather than
  `#94a3b8` for compliance. Flag to developer.
- The `<button className="btn-sso">` element should have an accessible label that does not rely on
  the globe emoji alone. The text label is sufficient; mark the emoji with `aria-hidden="true"` (it
  already is).
- The name preview (monospace div below the field) is purely informational; it does not need a role.
  Consider wrapping it in `<output>` or an `aria-live="polite"` region so screen readers announce
  the computed name as the user types.
- The `Banner` component should be updated to include `role="alert"` for `tone="err"` and
  `role="status"` for `tone="warn"` — this is currently missing from `ui.tsx`.

---

## 12. Edge cases and risks

| Case | Design resolution |
|---|---|
| Nameless connect: `displayName === ''` | `finishConnect` already handles: `displayName \|\| ''`. Hub greeting: "Welcome, you". Toast: "Connected · welcome". Never render the SA address. |
| Named path: name resolves to a different home than the Google account's home | The broker (Impact Connect) owns resolution. demo-gs passes `trimmed` as a hint; the broker's `resolveAuthOrigin` is authoritative. No client-side disambiguation needed. |
| Popup blocked on first visit (very common in Safari) | The `PopupBlocked` card is shown immediately with "Continue in this tab". The user should not be confused because the card is explicit, not a silent fallback. |
| User opens popup, goes idle for a long time, popup times out | The `startConnectPopup` should surface an `error` result (timeout). The page shows the error banner. The user can retry. |
| Session already exists on load (returning member) | `App.tsx` `useEffect` restores the session and routes to `workspace` directly, never reaching `ConnectScreen`. |
| Two Google accounts, same browser — user connects with account A, tries to connect again | The second connect resolves to account A's home (warm Google session). The popup shows "Welcome back" for account A. To connect with account B, the user would need to use "Not you? Use a different sign-in" in the popup (Impact Connect's own UI). |
| `OnboardPanel` rendered when session expires mid-session | Interim fix: add `onConnect` prop, wire to `goConnect`. Full fix: no session → redirect to connect screen via `view = 'connect'`. |
| `showNamePanel` open when `busy` becomes `true` | The name panel stays visible (no state change). The `TextField` is `disabled={busy}`. The panel helps the user see which name is being used during the ceremony. |

---

## 13. Developer handoff notes

1. **Server vs Client**: `ConnectScreen` is a Client Component (`'use client'`) due to `useState` /
   `startConnectPopup`. No change to its RSC boundary.

2. **dim overlay z-index**: The `<Card>` currently has no explicit z-index. When `busy` is true,
   give the card `position: relative; z-index: 20` via inline style, and the overlay `z-index: 10`.
   If the `AppShellHeader` uses a higher z-index, ensure the header remains above the overlay
   (`z-index: 30` for the header is typical).

3. **`HandoffBridge` new-user deletion**: After removing the new-user case, the `HandoffVariant`
   type in `HandoffBridge.tsx` should narrow to `'org-create' | 'reconnect'`. TypeScript will
   catch any remaining callsites that pass `variant="new-user"`.

4. **`OnboardPanel` interim fix**: Add `onConnect?: () => void` prop. In the SSO button handler:
   ```tsx
   async function connect() {
     if (onConnect) { onConnect(); return; }
     // existing startConnect() path (fallback for direct URL access)
   }
   ```
   Wire in both `GcoView` and `KcView`: `<OnboardPanel kind="gco" onConnect={goConnect} />`.

5. **Progress sequence timing**: The `onProgress` callback in `startConnectPopup` receives
   `AC_PROGRESS` messages from the popup. The second label "Waiting for confirmation…" should be
   emitted by the popup after it has opened and is awaiting user input. Verify the popup sends this
   message via `postMessage` (check `lib/central-auth.ts`).

6. **`cancelled` state reset**: Reset `setCancelled(false)` at the top of `cont()` before calling
   `launch()` so the banner clears when the user tries again.

7. **Accessibility fix for Banner**: Add `role="alert"` to `tone="err"` and `role="status"` to
   `tone="warn"` in `ui.tsx`. This is a cross-cutting fix that benefits all Banner usages in
   demo-gs and demo-jp.

8. **`OnboardPanel` as content-only (deferred)**: The longer-term refactor (move
   `GS.paths[kind]` copy into RoleHub bullets, remove the SSO button from OnboardPanel) should be
   tracked as a separate task. It is not a blocker for this spec.

---

## 14. Open questions (for PM / Security / IA)

- **PM**: Should the "Use my Impact name instead" panel be remembered across sessions? If the user
  returns and had previously typed a name, should the panel be pre-expanded? (Current design: no —
  the LAST_NAME_KEY prefills the field but the panel starts collapsed. This is the simpler default.)

- **PM**: For the nameless-connect path, the `displayName` in the hub greeting is `'you'`. Is this
  the right fallback, or should we show nothing ("Welcome back" with no name)? The current App.tsx
  logic already uses `'you'` — confirm this is acceptable for production.

- **Security**: The dim overlay (`pointer-events: none`) does not trap focus or prevent interaction
  with the page behind the popup. Is this acceptable for the demo, or does the popup's own window
  management provide sufficient security boundary? (The popup is a separate origin; the relying site
  cannot read its contents. The dim is cosmetic only.)

- **IA**: The name preview (`toAgentName(trimmed)` / `personalHome(trimmed)`) uses `lib/domain.ts`.
  Confirm that these functions correctly handle all edge cases for the new credential-first path
  (empty string, very long names, names with hyphens and dots).
