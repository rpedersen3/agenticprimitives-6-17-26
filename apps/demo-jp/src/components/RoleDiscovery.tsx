// Post-connect role discovery (production UX spec §9/§13/§15a, mirrors demo-gs's RoleDiscovery). After
// a connect-return the related orgs + JP records hydrate async; instead of a blank/wrong workspace we
// show a visible connection-status timeline + the "what JP can access" table. The App routes on to the
// hub once `ready`; on a vault error we surface it with retry (never fall back — ADR-0013).
//
// §15b.1 / spec 248 caveat: the access table is owner-keyed today; record-scope is the intended model.

import {
  Box, Button, Card, CardContent, Chip, CircularProgress, Stack, Typography,
} from '@mui/material';
import { JP } from '../lib/brand';

interface Step { label: string; done: boolean; active: boolean }

export function RoleDiscovery({ relatedOrgsLoaded, recordsLoaded, error, onRetry }: {
  /** Connect's related-orgs read has completed (ready or error). */
  relatedOrgsLoaded: boolean;
  /** The JP adopter + facilitator record reads have completed their first load. */
  recordsLoaded: boolean;
  /** A discovery error (vault unreachable), or null. */
  error: string | null;
  onRetry: () => void;
}) {
  const steps: Step[] = [
    { label: `Signed in to ${JP.impactName}`, done: true, active: false },
    { label: 'Loaded your organizations', done: relatedOrgsLoaded || !!error, active: !relatedOrgsLoaded && !error },
    { label: `Loaded your ${JP.org} records`, done: recordsLoaded, active: relatedOrgsLoaded && !recordsLoaded && !error },
    { label: 'Ready', done: recordsLoaded && relatedOrgsLoaded && !error, active: false },
  ];

  const accessRows: Array<{ rec: string; access: string; tone: 'ok' | 'warn' }> = [
    { rec: `Your ${JP.impactName} profile (name + contact)`, access: 'read (approved fields)', tone: 'ok' },
    { rec: `Your ${JP.org} adopter + facilitator records`, access: 'read + write', tone: 'ok' },
    { rec: 'Match + agreement status', access: 'read', tone: 'ok' },
    { rec: 'Your contact details', access: 'only when you share', tone: 'warn' },
  ];

  return (
    <Card sx={{ maxWidth: 600, mx: 'auto' }}>
      <CardContent sx={{ p: { xs: 2.5, sm: 3.5 } }}>
        <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 800, letterSpacing: '.12em' }}>
          Connecting you to {JP.impactName}
        </Typography>
        <Typography variant="h6" sx={{ mt: 0.5, fontWeight: 800 }}>Getting things ready</Typography>

        <Stack spacing={1} sx={{ mt: 2 }}>
          {steps.map((s) => (
            <Box key={s.label} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Box
                aria-hidden
                sx={{
                  width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center',
                  justifyContent: 'center', color: '#fff', fontSize: '.7rem', fontWeight: 900,
                  bgcolor: s.done ? 'success.main' : s.active ? 'primary.main' : 'grey.300',
                }}
              >
                {s.done ? '✓' : s.active ? <CircularProgress size={12} color="inherit" /> : ''}
              </Box>
              <Typography sx={{ fontSize: '.9rem', fontWeight: 600, color: s.done ? 'text.primary' : 'text.secondary' }}>
                {s.label}
              </Typography>
            </Box>
          ))}
        </Stack>

        {error && (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ p: 1.5, bgcolor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 1.5, color: '#991b1b', fontSize: '.85rem' }}>
              Couldn&rsquo;t reach your vault: {error}. Please retry — {JP.org} never falls back to local data.
            </Box>
            <Button variant="outlined" size="small" onClick={onRetry} sx={{ mt: 1.5 }}>Retry discovery</Button>
          </Box>
        )}

        {/* "What JP can access" table (§15a discovery + §15b disclosure). */}
        <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          <Typography sx={{ fontWeight: 700, fontSize: '.9rem' }}>What {JP.org} can access</Typography>
          <Stack spacing={0.75} sx={{ mt: 1 }}>
            {accessRows.map((row) => (
              <Box key={row.rec} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ flex: 1, fontSize: '.82rem', color: 'text.secondary', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>{row.rec}</Typography>
                <Chip size="small" color={row.tone === 'ok' ? 'success' : 'warning'} variant="outlined" label={row.access} />
              </Box>
            ))}
          </Stack>
          <Typography variant="caption" sx={{ display: 'block', mt: 1.25, color: 'text.secondary' }}>
            Owner-keyed today; record-level scope is the intended model (spec 248), not yet enforced.
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}
