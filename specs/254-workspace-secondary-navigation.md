# Spec 254 — Workspace secondary navigation (role-workspace tab bar)

**Status:** draft, 2026-06-04.
**Owner:** `apps/demo-gs` + `apps/demo-jp` (app-layer UX; ADR-0021 — no package changes).
**Problem source:** the role-workspace pages render their entire content (lifecycle rail → summary cards →
primary-task form → next-best-action → published record → request queue → agreements → directory →
substrate claims → trust footer) as ONE long vertical scroll, all at equal visual weight. The primary task
is buried mid-page, passive reference sections compete with actions, there is no wayfinding, and
lifecycle-irrelevant sections are always visible. Confirmed across all four roles (demo-gs KC Expert + GCO,
demo-jp Adopter + Facilitator). UX review (ux-designer, 2026-06-04) recommended secondary navigation.

## Reference: smart-agent patterns to port

No direct smart-agent analog (smart-agent has no equivalent multi-section relying-app workspace). This is an
app-layer IA pattern; we follow our OWN established shared-shell architecture (landing → connect → role hub →
workspace; AppShellHeader; lifecycle-driven IA — specs 236/250 + the production-ux-design-specs). The tab bar
is a NEW shared primitive expressed in each app's existing component system.

## 1. Decision — in-workspace tab bar

A horizontal **tab bar** docked immediately below the persistent lifecycle rail + intranet header, controlling
which section group is visible in the workspace body. Only one section group renders at a time.

**Rejected alternatives** (and why): a **left rail** starves the 1100px single-column forms (the SkillPicker /
multi-selects need the width) and adds a mobile hamburger the apps don't otherwise need; an **accordion** only
shortens the scroll, keeps every section header visible, and gives false equivalence; **pure
progressive-disclosure** (show only the current-lifecycle section) traps a user who isn't at the expected step
(e.g. a published KC who just wants the directory). A **modal** for the big form is folded in as a refinement
(form-as-its-own-tab + collapse-to-card), not the primary model.

Tabs win: scroll → zero, persistent wayfinding, matches the "I'm doing X vs browsing Y" mental model, degrades
to a scrollable strip on mobile, and lets existing section components be **re-homed, not rewritten**.

## 2. The shared 5-tab pattern

Persistent ABOVE the tabs on every view (unchanged): `AppShellHeader` (brand + identity/admin dropdown),
the intranet header (role pill · hub link · sign-out), and the **`LifecycleRail`** (stays the orientation
anchor — NOT moved into a tab). Everything below is tab-controlled.

Five tabs in fixed order — positions 1 and 5 are identical across all roles; the middle three are
role-specialized but follow `primary-task | browse | connections`:

| Pos | Tab id | KC Expert | GCO Org | Adopter | Facilitator |
| --- | --- | --- | --- | --- | --- |
| 1 | `overview` | summary cards + next-best-action | needs list + NBA | summary + NBA + profile banner | command center + NBA |
| 2 | (primary) | `offering` — Offering | `need` — Post a Need | `setup` — Setup | `coverage` — Coverage |
| 3 | (browse) | `directory` — Directory | `directory` — Directory | `declare` — Declare | `matches` — Matches |
| 4 | `connections` | requests + agreements | agreements | match/agreement | agreements |
| 5 | `data-access` | substrate claims + trust | trust | member trust panel + trust | member trust panel + trust |

- **Overview is the default landing** — orients returning users (is my record published? any requests?) and
  hosts the **next-best-action**, which gains a deep-link CTA (`"Go to Connections"` etc.) that sets the active
  tab. No automatic tab switching — always user-initiated.
- **Connections (and Matches) tabs carry a dot/count badge** when the relevant count > 0.
- Tab labels: max 2 words, noun-style for nav; exception "Post a Need" (3 words — doubles as the
  before-first-post CTA, clearer than "Needs"). Adopter primary-task browse tab = "Declare" (the
  adoption-declaration event), connections vocab per app.

## 3. The form refinement

The primary-task FORM (ExpertOfferingWizard / GcoNeedWizard / FacilitatorPrimaryTaskCard) lives in its own
tab (pos 2), NOT a modal (multi-minute multi-field forms are poor modal hosts + the tab already isolates it
from reference sections). On the Offering/Need tab: when a record is already published, the default is the
**compact published-record card** with an **"Edit" toggle** that expands the wizard in-place
(`useState(!hasRecord)`) — removing today's "form always open after publish" problem.

## 4. Cross-app consistency (ADR-0021: shared IA, two component systems)

ONE pattern, two expressions. Shared: the 5 tab IDs + order, the section→tab assignment, the lifecycle-rail
placement, the badge semantics, the active-tab persistence model. Differs: components only.

- **Tab IDs/constants** — `src/lib/workspace-tabs.ts` in each app (`TAB_IDS` const), imported by both the tab
  bar render and the persistence helpers.
- **demo-gs** — a new `WorkspaceTabBar` in the lightweight kit (`src/components/ui.tsx` / `ui.tsx`):
  `role="tablist"` + `role="tab"` buttons, `.workspace-tabs` CSS in `index.html` (indigo palette, 8px grid,
  44px touch targets, `overflow-x:auto` strip). NO Material UI.
- **demo-jp** — MUI `Tabs`/`Tab`/`Badge` (`variant="scrollable"`); no new dep.
- **Persistence** — `loadActiveTab(personKey, role)` / `saveActiveTab(...)` alongside the existing
  active-role helpers; key includes the person SA/address + role (a dual-role user's tab prefs don't collide).
  Restored on workspace mount AND after the home handoffs (org-create / profile / WEA return to `/`).

## 5. Accessibility (required)

`role="tablist"` with left/right **arrow-key** navigation (wrap) + `Enter`/`Space` activate; on activation
move focus to the panel's first focusable element. Inactive panels use the **`hidden` attribute** (not
`{active && …}` conditional render) so (a) screen readers skip them AND (b) **form state is preserved across
tab switches** — do NOT unmount the wizard panels or a half-filled form is lost. Active tab contrast ≥ 4.5:1.

## 6. Wave plan

- **F0+F1** — the `WorkspaceTabBar` primitive (both kits) + `workspace-tabs.ts` constants + `load/saveActiveTab`
  + re-home **KC Expert** (demo-gs) and **Facilitator** (demo-jp) into tabs. (F0 shipped with its first
  consumer rather than as an empty primitive.)
- **F2** — re-home **GCO** (demo-gs) + **Adopter** (demo-jp).
- **F3** — Connections/Matches badges in all four roles + the next-best-action deep-link CTA (`cta?: {label;
  onClick}` added additively to the `NextAction` type) + active-tab restore across the home handoffs.

## 7. Constraints

- **Re-home, don't rewrite** — every existing section component moves into a tab panel with no internal-logic
  change (vault reads/writes, validation, state preserved). Only eyebrow/title props may change.
- Do NOT change the connect-first navigation architecture or the role model; no router library (both apps are
  Vite SPAs with `useState`-based view state — tab state is the same pattern).
- demo-gs = lightweight kit (no MUI); demo-jp = MUI. Don't cross them.
- Preserve **spec-248 caveats** everywhere (the Data & Access tab is the natural home for "intended program
  scope; record-level enforcement pending" — isolating it there is not burying it). No production-data-readiness
  claims. NO admin links on member pages (admin stays in the header dropdown).

## 8. Acceptance

- Each role workspace opens on **Overview** with no long scroll; the primary-task form is reachable in ONE click
  (its tab), not buried mid-page; reference sections (directory, substrate, trust) are their own tabs.
- Tab state persists + restores on reload AND after org-create/profile/WEA handoffs; a half-filled form survives
  a tab switch.
- Connections/Matches show a badge when there's something to act on; the Overview next-best-action deep-links to
  the right tab.
- Same 5-tab IA in both apps; demo-gs uses the kit, demo-jp uses MUI; both green on `typecheck`/`test`/`build`.
- spec-248 caveats intact; no admin on member pages.
