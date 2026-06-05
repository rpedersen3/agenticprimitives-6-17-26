# Spec 255 — Passkey-signing clarity (combined demo-gs ↔ impact onboarding)

**Status:** draft, 2026-06-04.
**Owner:** `apps/demo-gs` (relying-app side) + `apps/demo-sso-next` (the Impact home / ceremony side).
App-layer UX only (ADR-0021) — display/copy + one new demo-gs component. **No `connect-client.ts`
logic changes; no change to the passkey prompt COUNT** (it is at the security floor — see §1).

## 1. Problem + non-goal

Person signup is `create` (mint the passkey) + ONE assertion (the deploy-sign, which does triple duty:
prove possession + authorize deploy+name + sign in). Org-create is ONE assertion (reuses the ROOT passkey).
Both are at the **security floor** — you cannot prove possession of a new key without one assertion, and
you cannot skip `create()`. **NON-GOAL: reducing the count.** The goal is making those prompts intuitive.

The confusion is the EXPERIENCE: the user starts on Global.Church, is silently redirected to
`<name>.impact-agent.me`, and a generic OS dialog ("use your passkey for impact-agent.me") appears with no
context — it reads like phishing. The two new-user prompts (`create` vs `sign`) look identical to the OS but
are different actions; nothing distinguishes them; no tap-count expectation is set.

## 2. Scope — PASSKEY PATH ONLY (Google stays clean)

The **Google/social path fires no WebAuthn** (server-side KMS) and is already clean — it MUST be untouched.
Scoping that guarantees it:
- The impact-side pre-prompt explainers render ONLY on the passkey create/deploy/org-sign screens (which
  exist only when passkey is chosen). The Google sign-in screen is never modified.
- The method is chosen at the IMPACT side (after the demo-gs redirect), so the demo-gs **handoff bridge** for
  the new-user connect entry stays **method-agnostic + minimal** (domain reassurance only — helps everyone,
  no passkey jargon); all passkey-specific detail lives at impact AFTER passkey is chosen. The org-create +
  reconnect bridges are inherently passkey (known method) and get the full treatment. Net: **Google never
  sees a passkey-flavored screen.**

## 3. Design (the clarity layer)

Trust narrative threaded everywhere: *"Your Impact home holds your identity + passkey; apps connect to it but
never hold it and can't act without your approval."*

1. **Pre-prompt explainers (impact, before each WebAuthn call)** — distinguish "Create your passkey"
   (one-time, nothing leaves the device) from "Approve my setup" (*using* the key you just made to start your
   home + claim your name), list exactly what's being approved, and pre-empt the domain ("the prompt will say
   impact-agent.me — that's this page"). Org-create: "one tap approves org home + name + scoped app access."
2. **Handoff bridge (demo-gs, before the redirect)** — a short interstitial naming the domain transition +
   (for passkey-known paths) the tap-count preview, with cancel. New-user connect = minimal/method-agnostic.
3. **Post-prompt receipts** — "✓ Passkey created" / "✓ [org] is ready and connected"; a receipt strip on the
   demo-gs discovery screen.
4. **Expectation-setting** — connect-screen copy stating the tap count + what each does.

## 4. Waves

- **W1 (copy only, Google-safe by construction, highest clarity/effort):** impact `key-ready` screen
  create-vs-approve + domain note; button renames ("Create your passkey" / "Approve my setup"); connect-screen
  + onboard step copy. demo-sso-next `whitelabel/config.ts` + `OnboardingJourney.tsx`; demo-gs `ConnectScreen`
  + `gs-brand.ts`.
- **W2:** demo-gs `HandoffBridge` component (lightweight kit) wired into `ConnectScreen` (minimal variant) +
  `GcoOrgCreate` (org-create variant) + the reconnect variant. Auto-advance + cancel.
- **W3:** impact pre-prompt explainer blocks (pre-create on `overview`, pre-deploy on `key-ready`, pre-org in
  `OrgConsent`) + `OnboardingProgress` step labels. Passkey-screen-only.
- **W4:** receipts — impact `ReceiptCard`/`OrgConsent` connected copy + demo-gs `RoleDiscovery` receipt strip.

## 5. Constraints + acceptance

- Google path untouched (no passkey explainers on its screens; bridge stays method-agnostic where the method
  is unknown). Verify the Google sign-in screens render identically.
- demo-gs = lightweight kit (no MUI); demo-sso-next = Next/MUI. No `connect-client.ts` logic changes (display
  only); the WebAuthn calls fire on the same buttons. Domain note gated to non-localhost.
- Acceptance: a new user knows, before the OS dialog, that they're going to impact-agent.me, how many taps,
  and what each does; the second prompt is clearly distinguished from the first; returning to demo-gs shows a
  receipt. `cd apps/demo-gs && pnpm typecheck && pnpm test && pnpm build` + `cd apps/demo-sso-next && pnpm
  typecheck && pnpm build` green.
