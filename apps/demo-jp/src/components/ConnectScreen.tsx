// Role-agnostic connect entry + grant review (production UX spec §8/§15a/§15b, mirrors demo-gs's
// reworked connect flow). Connecting is ONE simple action — there is NO adopter/facilitator choice
// here. The member sees a grant-review disclosure (owner / scope / purpose / limit per §15b) + a name
// field, then launches the SAME `startSiteEnrollment` person connect the old OnboardPanel used. The
// role is chosen AFTER connecting, in the RoleHub.
//
// §15b.1 / spec 248 CAVEAT: the scope copy says "intended JP program scope" — record-level enforcement
// is owner-keyed today (spec 248 C-2), so we NEVER claim cryptographic record-type isolation here.
//
// This component does NOT touch the connect-client or the App's connect-return handler; it only renders
// the entry UI and calls back to the App's `onConnect(name)` (which preserves `beginConnect`).

import { useState } from 'react';
import {
  Box, Button, Card, CardContent, Chip, CircularProgress, Stack, TextField, Typography,
} from '@mui/material';
import { JP } from '../lib/brand';
import { personalHome, toAgentName as fullName } from '../lib/domain';

const LAST_NAME_KEY = 'agenticprimitives:demo-jp:last-name';

export function ConnectScreen({ busy, error, onConnect, onBack }: {
  /** A busy label while the redirect is being prepared (the App owns the redirect). */
  busy: string | null;
  error: string | null;
  /** Launch the role-agnostic person connect for this Impact name. */
  onConnect: (name: string) => void;
  /** Back to the landing. */
  onBack: () => void;
}) {
  const [name, setName] = useState<string>(() => {
    try { return localStorage.getItem(LAST_NAME_KEY) ?? ''; } catch { return ''; }
  });
  const trimmed = name.trim();

  const submit = () => {
    if (!trimmed || busy) return;
    try { localStorage.setItem(LAST_NAME_KEY, trimmed); } catch { /* ignore */ }
    onConnect(trimmed);
  };

  return (
    <Card sx={{ maxWidth: 600, mx: 'auto' }}>
      <CardContent sx={{ p: { xs: 2.5, sm: 3.5 } }}>
        <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 800, letterSpacing: '.12em' }}>
          Connect
        </Typography>
        <Typography variant="h5" sx={{ mt: 0.5, fontWeight: 800 }}>{JP.ssoCta}</Typography>
        <Typography sx={{ mt: 1, color: 'text.secondary', lineHeight: 1.6, fontSize: '.92rem' }}>
          Connect your {JP.impactName} home. {JP.org} reads only what you grant; your contact stays in
          your home until you choose to share it. You&rsquo;ll pick what you want to do — adopt a people
          group, or facilitate adoptions — once you&rsquo;re inside.
        </Typography>

        <Box sx={{ mt: 1.5 }}>
          <Chip size="small" color="primary" variant="outlined" label="One identity · roles are workspaces" />
        </Box>

        {/* Grant review (§15b): owner / scope / purpose / limit before the Impact handoff. */}
        <Box sx={{ mt: 2.5, p: 2, bgcolor: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 2 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '.9rem', color: '#115e59' }}>
            What you&rsquo;re granting {JP.org}
          </Typography>
          <Stack spacing={0.75} sx={{ mt: 1 }}>
            <GrantRow label="Data owner" value={`You — your ${JP.impactName} home holds your profile, organizations, and signed documents.`} />
            <GrantRow label="Receives access" value={`${JP.org} (the adoption program broker), for this demo.`} />
            <GrantRow
              label="Scope"
              value={`The intended JP program scope — your adopter/facilitator records and the minimal profile fields JP needs.`}
            />
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

        <Stack spacing={1.25} sx={{ mt: 3 }}>
          <Typography component="label" htmlFor="jp-connect-name" sx={{ fontWeight: 800, fontSize: '.8rem', color: 'text.secondary' }}>
            Your {JP.impactName} name
          </Typography>
          <TextField
            id="jp-connect-name"
            value={name}
            placeholder="e.g. rich-pedersen"
            disabled={!!busy}
            fullWidth
            size="small"
            inputProps={{ autoCapitalize: 'none', autoComplete: 'username', spellCheck: false, style: { fontFamily: "'SF Mono','Roboto Mono',monospace" } }}
            onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          {trimmed && (
            <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
              {fullName(trimmed)} · home at {personalHome(trimmed)}
            </Typography>
          )}
          <Button
            variant="contained"
            color="primary"
            size="large"
            disabled={!trimmed || !!busy}
            onClick={submit}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <span aria-hidden>🌍</span>}
          >
            {busy ?? JP.ssoCta}
          </Button>
          {error && (
            <Box sx={{ p: 1.25, bgcolor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 1.5, color: '#991b1b', fontSize: '.85rem' }}>
              {error}
            </Box>
          )}
          <Button onClick={onBack} sx={{ alignSelf: 'flex-start', color: 'primary.main', textTransform: 'none' }} size="small">
            ← Back
          </Button>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            You&rsquo;ll confirm with your device at <b>{personalHome(trimmed || 'your-name')}</b>, then come back here.
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
