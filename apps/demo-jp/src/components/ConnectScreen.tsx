// Role-agnostic, credential-first connect screen (spec 257 credential-first spine; spec 258 connect-UX
// redesign; MUI, mirrors demo-gs's reworked connect flow). Connecting is ONE simple action — no
// adopter/facilitator choice here; the role is chosen AFTER connecting from inside the intranet (the
// RoleHub).
//
// Spec 258: ONE card, ONE primary CTA. "Connect via Impact Community" launches the Connect ceremony in
// a POPUP over the (dimmed) site DIRECTLY — there is NO pre-popup handoff-bridge interstitial. The name
// is a SECONDARY disclosure ("Use my Impact name instead"): a public handle, not a login key. An empty
// name lets the broker show its W1 credential-first entry (the token `sub` binds the PROVEN credential,
// never a client name). The popup finishes IN PLACE — no page load.
//
// The audit-hardened launcher (`lib/central-auth.ts`) pins the resolved Connect origin. On popup-BLOCKED
// we render the co-branded interstitial then fall back to the full-page redirect `startConnect` — an
// EXPLICIT fallback, never a silent reflow (ADR-0013). On cancel we show a soft warn banner; on error we
// surface it and let the user retry ("Try again").
//
// §15b / spec 248 CAVEAT: the scope copy says "intended JP program scope" — record-level enforcement is
// owner-keyed today (spec 248 C-2), so we NEVER claim cryptographic record-type isolation here.

import { useEffect, useRef, useState } from 'react';
import {
  Box, Button, Card, CardContent, Chip, CircularProgress, Stack, TextField, Typography,
} from '@mui/material';
import { JP } from '../lib/brand';
import { personalHome, toAgentName as fullName } from '../lib/domain';
import { startConnect, startConnectPopup, LAST_NAME_KEY, type ConnectPopupSuccess } from '../lib/connect-launch';

export function ConnectScreen({ onBack, onConnected }: {
  /** Back to the landing. */
  onBack: () => void;
  /** POPUP success → finish the connect IN PLACE (the App exchanges the code, sets the session, routes).
   *  Returns true on success; on a surfaced error we return to the form. */
  onConnected: (r: ConnectPopupSuccess) => Promise<boolean>;
}) {
  // Credential-first: the primary path NEVER carries a name, so this starts EMPTY (no LAST_NAME
  // prefill). A prefilled name would make social login silently bind to that handle. The remembered
  // last name is read only when the user EXPLICITLY opens the named path (see the disclosure below).
  const [name, setName] = useState<string>('');
  const [busy, setBusy] = useState(false);
  // Driven by the popup `AC_PROGRESS` messages; shown on the CTA while the popup is open. Falls back to a
  // default opener label.
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The "Use my Impact name instead" disclosure. ALWAYS collapsed by default — the relying site leads
  // credential-first and must NOT present name entry (or imply a named bind) up front. Opening it is a
  // deliberate, intentional fallback for someone who knows the handle they want to open.
  const [showNamePanel, setShowNamePanel] = useState(false);
  // spec 258 — soft "sign-in was cancelled" banner; cleared on the next cont().
  const [cancelled, setCancelled] = useState(false);
  // popups blocked → co-branded "Impact Community → JP" interstitial, then the redirect.
  const [blocked, setBlocked] = useState(false);
  const trimmed = name.trim();

  const ctaRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // The in-flight popup's AbortController — the parent-side Cancel signals it (the only reliable cancel
  // under COOP; there is no popup.closed poll). Cleared when launch finishes/returns.
  const abortRef = useRef<AbortController | null>(null);
  // The name the active connect is carrying: `undefined` = nameless (the primary, credential-first
  // path); a handle = the explicit named path. Used by BOTH the popup launch and the popup-blocked
  // redirect fallback so they agree on whether this is a named or nameless connect.
  const launchNameRef = useRef<string | undefined>(undefined);

  // Focus the primary CTA on mount (spec 258 §9 focus management).
  useEffect(() => { ctaRef.current?.focus(); }, []);
  // When the name panel expands, move focus into the field (spec 258 §9).
  useEffect(() => { if (showNamePanel) nameRef.current?.focus(); }, [showNamePanel]);

  // `named=false` → the primary, credential-first connect (NO name; Impact handles Google/passkey/
  // wallet and shows the handle after it resolves). `named=true` → the explicit named path; only then
  // do we carry the typed handle AND remember it as the last name.
  function cont(named: boolean) {
    setErr(null);
    setCancelled(false);
    const n = named && trimmed ? trimmed : undefined;
    launchNameRef.current = n;
    if (n) { try { localStorage.setItem(LAST_NAME_KEY, n); } catch { /* ignore */ } }
    void launch();
  }

  // Launch the POPUP ceremony directly (no bridge). On success the App finishes in place; on blocked we
  // segue to the co-branded interstitial; on cancel we show the soft warn banner; on error we surface it.
  async function launch() {
    setBusy(true); setErr(null);
    setProgress('Opening your Impact home…'); // spec 258 — segue label until the broker posts progress
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await startConnectPopup(launchNameRef.current, (msg) => setProgress(msg), ac.signal);
      if (res.status === 'success') {
        // Hand the CODE (only) to the App; it exchanges at /token + sets the session in place.
        const ok = await onConnected(res);
        if (!ok) { setBusy(false); setProgress(null); } // error surfaced by the App; let the user retry
        return;
      }
      if (res.status === 'blocked') {
        // EXPLICIT fallback (ADR-0013) — show the co-branded interstitial, then the full-page redirect.
        setProgress(null);
        setBlocked(true);
        return;
      }
      if (res.status === 'cancelled') {
        // Parent-side Cancel (or the 2-min abandon backstop) — soft warn banner, return to the form.
        setBusy(false); setProgress(null);
        setCancelled(true); // soft warn banner — try again below
        return;
      }
      setErr(res.error);
      setBusy(false); setProgress(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false); setProgress(null);
    } finally {
      abortRef.current = null;
    }
  }

  // Parent-side Cancel: abort the in-flight popup. The launcher resolves `cancelled`, which clears busy
  // and shows the soft banner above. We also clear busy defensively so the spinner never sticks.
  function cancelInFlight() {
    abortRef.current?.abort();
    setBusy(false); setProgress(null);
  }

  // The popup-blocked redirect fallback: the same `startConnect` ceremony, full-page (stashes PKCE +
  // navigates to the home, returns with ?code&state to the App's redirect-return handler).
  async function redirectFallback() {
    setBusy(true); setErr(null);
    try {
      await startConnect(launchNameRef.current);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setBlocked(false);
    }
  }

  if (blocked) {
    // co-branded "Impact Community → JP" interstitial; the load-bearing trust element is the co-brand
    // chip. Continue → the full-page redirect to the home.
    return <PopupBlocked onContinue={() => void redirectFallback()} onCancel={() => { setBlocked(false); setBusy(false); }} busy={busy} />;
  }

  return (
    <>
      {/* spec 258 §3c — dim the page behind the card while the popup is in flight. Cosmetic only (not a
          modal; does not trap focus). The card lifts above it via position/z-index. */}
      {busy && (
        <Box aria-hidden="true" sx={{ position: 'fixed', inset: 0, bgcolor: 'rgba(11, 19, 36, 0.52)', zIndex: 10, pointerEvents: 'none' }} />
      )}
      <Card sx={{ maxWidth: 600, mx: 'auto', ...(busy ? { position: 'relative', zIndex: 20 } : {}) }}>
        <CardContent sx={{ p: { xs: 2.5, sm: 3.5 } }}>
          {cancelled && (
            <Box sx={{ mb: 1.5, p: 1.25, bgcolor: '#fffbeb', border: '1px solid #fde68a', borderRadius: 1.5, color: '#92400e', fontSize: '.85rem' }}>
              Sign-in was cancelled — you can try again below.
            </Box>
          )}
          {err && (
            <Box sx={{ mb: 1.5, p: 1.25, bgcolor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 1.5, color: '#991b1b', fontSize: '.85rem' }}>
              {err}
            </Box>
          )}

          <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 800, letterSpacing: '.12em' }}>
            Connect
          </Typography>
          <Typography variant="h5" sx={{ mt: 0.5, fontWeight: 800 }}>Connect with {JP.impactName}</Typography>
          <Typography sx={{ mt: 1, color: 'text.secondary', lineHeight: 1.6, fontSize: '.92rem' }}>
            Sign in with Google, passkey, or wallet through your {JP.impactName} home. Your {JP.impactName}
            name is only a public handle &mdash; you do not need it to sign in. {JP.org} only receives the
            access you approve, and your contact details stay private in your home until you choose to share them.
          </Typography>

          <Box sx={{ mt: 1.5 }}>
            <Chip size="small" color="primary" variant="outlined" label="One identity · roles are workspaces" />
          </Box>

          {/* Grant review (§15b): owner / scope / purpose / limit before the Impact handoff. Kept from
              demo-jp's name-required screen — never claim cryptographic record-level enforcement. */}
          <Box sx={{ mt: 2.5, p: 2, bgcolor: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 2 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '.9rem', color: '#115e59' }}>
              What you&rsquo;re granting {JP.org}
            </Typography>
            <Stack spacing={0.75} sx={{ mt: 1 }}>
              <GrantRow label="Data owner" value={`You — your ${JP.impactName} home holds your profile, organizations, and signed documents.`} />
              <GrantRow label="Receives access" value={`${JP.org} (the adoption program broker), for this demo.`} />
              <GrantRow label="Scope" value="The intended JP program scope — your adopter/facilitator records and the minimal profile fields JP needs." />
              <GrantRow label="What JP can do" value="Read and write your JP-program records through a delegation you approve at your home." />
              <GrantRow label="You stay in control" value={`Revoke this access anytime from your ${JP.impactName} home, and JP's visibility goes to zero.`} />
            </Stack>
            {/* spec 248 caveat — never claim cryptographic record-level enforcement. */}
            <Typography variant="caption" sx={{ display: 'block', mt: 1.25, color: 'text.secondary', lineHeight: 1.5 }}>
              Note: today the vault boundary is owner-keyed. Record-level scope is the intended product
              model but is not yet cryptographically enforced (spec 248). This demo does not claim
              production record-level isolation.
            </Typography>
          </Box>

          <Stack spacing={1.25} sx={{ mt: 3 }} aria-busy={busy}>
            {/* Primary CTA — ALWAYS credential-first / nameless. It never carries a name; Impact handles
                Google/passkey/wallet in the popup and shows the handle after the credential resolves. */}
            <Button
              ref={ctaRef}
              variant="contained"
              color="primary"
              size="large"
              disabled={busy}
              onClick={() => cont(false)}
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <span aria-hidden>🌍</span>}
            >
              <span aria-live="polite">
                {busy ? (progress ?? 'Opening your Impact home…') : err ? 'Try again' : JP.ssoCta}
              </span>
            </Button>

            {/* Parent-side Cancel — visible only while the popup is in flight. The only reliable way to
                abort under COOP (no popup.closed poll). Sits directly under the busy CTA, above the dim. */}
            {busy && (
              <Button
                onClick={cancelInFlight}
                size="small"
                sx={{ alignSelf: 'center', color: 'primary.main', textTransform: 'none' }}
              >
                Cancel
              </Button>
            )}

            {/* Secondary disclosure — collapsed by default. Opening it is the ONLY moment we read the
                remembered last name (so social login never feels like a named bind). */}
            {!showNamePanel && !busy && (
              <Button
                onClick={() => { try { setName(localStorage.getItem(LAST_NAME_KEY) ?? ''); } catch { /* ignore */ } setShowNamePanel(true); }}
                size="small"
                sx={{ alignSelf: 'flex-start', color: 'primary.main', textTransform: 'none', textDecoration: 'underline', p: 0, minWidth: 0 }}
              >
                Use my Impact name instead
              </Button>
            )}

            {/* Name panel — expanded inline (no new screen). */}
            {showNamePanel && (
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography component="label" htmlFor="jp-connect-name" sx={{ fontWeight: 800, fontSize: '.72rem', letterSpacing: '.08em', textTransform: 'uppercase', color: 'text.secondary' }}>
                  Use my {JP.impactName} name
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Only use this if you know the {JP.impactName} handle you want to open.
                </Typography>
                <TextField
                  id="jp-connect-name"
                  inputRef={nameRef}
                  value={name}
                  placeholder="e.g. rich-pedersen"
                  disabled={busy}
                  fullWidth
                  size="small"
                  inputProps={{ autoCapitalize: 'none', autoComplete: 'username', spellCheck: false, style: { fontFamily: "'SF Mono','Roboto Mono',monospace" } }}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && trimmed) cont(true); }}
                />
                {trimmed && (
                  <Typography component="output" variant="caption" sx={{ color: 'text.secondary', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
                    {fullName(trimmed)} · home at {personalHome(trimmed)}
                  </Typography>
                )}
                {/* The named path's OWN CTA — the only path that does a NAMED connect. The primary CTA
                    above stays credential-first/nameless. */}
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => cont(true)}
                  disabled={busy || !trimmed}
                  startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <span aria-hidden>🌍</span>}
                  sx={{ textTransform: 'none' }}
                >
                  Continue with this name
                </Button>
                <Button
                  onClick={() => setShowNamePanel(false)}
                  disabled={busy}
                  size="small"
                  sx={{ alignSelf: 'flex-start', color: 'primary.main', textTransform: 'none', textDecoration: 'underline', p: 0, minWidth: 0 }}
                >
                  Hide — use Google or passkey without a name
                </Button>
              </Box>
            )}

            <Button onClick={onBack} disabled={busy} size="small" sx={{ alignSelf: 'flex-start', color: 'primary.main', textTransform: 'none' }}>
              ← Back
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </>
  );
}

// The popup-blocked, co-branded "Impact Community → JP" interstitial. The co-brand chip is the
// load-bearing trust element; Continue runs the full-page redirect fallback (ADR-0013, explicit).
function PopupBlocked({ onContinue, onCancel, busy }: { onContinue: () => void; onCancel: () => void; busy: boolean }) {
  const ctaRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { ctaRef.current?.focus(); }, []);
  return (
    <Card sx={{ maxWidth: 560, mx: 'auto' }}>
      <CardContent sx={{ p: { xs: 2.5, sm: 3.5 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1.5 }}>
          <Chip size="small" color="primary" variant="outlined" label={`${JP.impactName} → ${JP.org}`} />
        </Box>
        <Typography variant="h6" sx={{ textAlign: 'center', fontWeight: 800 }}>Blocked by your browser</Typography>
        <Typography sx={{ mt: 1, color: 'text.secondary', textAlign: 'center', lineHeight: 1.6, fontSize: '.92rem' }}>
          Your browser blocked the secure sign-in window. We can take you to your {JP.impactName} home in
          this tab and bring you back to {JP.org} after you confirm.
        </Typography>
        <Stack spacing={1} alignItems="center" sx={{ mt: 3 }}>
          <Button ref={ctaRef} variant="contained" color="primary" onClick={onContinue} disabled={busy}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
            Continue in this tab
          </Button>
          <Button onClick={onCancel} disabled={busy} size="small" sx={{ color: 'primary.main', textTransform: 'none' }}>
            Cancel
          </Button>
          <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            The page that opens will say impact-agent.me — that is your home, not a new site.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

function GrantRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
      <Typography sx={{ fontWeight: 700, fontSize: '.78rem', color: '#115e59', minWidth: 120, flexShrink: 0 }}>{label}</Typography>
      <Typography sx={{ fontSize: '.82rem', color: 'text.secondary' }}>{value}</Typography>
    </Box>
  );
}
