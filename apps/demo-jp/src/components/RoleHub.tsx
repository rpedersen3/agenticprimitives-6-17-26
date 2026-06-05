// Connected role hub (production UX spec §9/§15a, mirrors demo-gs's RoleHub, rendered with MUI). THIS is
// the connected intranet home — a person lands here right after connecting (NOT auto into a workspace,
// per §9) and chooses what to do. Two cards:
//   • Adopter — adopt a Frontier People Group + request a facilitator.
//   • Facilitator — declare coverage/capacity + receive adopter matches.
// Each card shows per-role state: ready → open; incomplete → resume; not-started → set up; grant-missing
// / load-failed → reconnect/retry. The actions are the App's responsibility; this is presentation.

import {
  Box, Button, Card, CardContent, Chip, Grid, Stack, Typography,
} from '@mui/material';
import { JP } from '../lib/brand';
import type { RoleCapabilities, RoleKind, RoleState } from '../lib/role-capabilities';

interface CardCopy { side: string; emoji: string; title: string; sub: string; bullets: string[] }

const COPY: Record<RoleKind, CardCopy> = {
  adopter: {
    side: 'ADOPT',
    emoji: '🙏',
    title: 'Adopt a people group',
    sub: 'As yourself, or a church / organization you create',
    bullets: ['Create / select an adopter organization', 'Sign the ADOPT MOU', 'Declare adoption + request a facilitator'],
  },
  facilitator: {
    side: 'FACILITATE',
    emoji: '🤝',
    title: 'Facilitate adoptions',
    sub: 'An organization already serving on the field',
    bullets: ['Create your facilitator organization', 'Declare coverage and capacity', 'Receive adopter match requests'],
  },
};

export function RoleHub({ name, caps, onOpen, onSetup, onReconnect, onOpenHome }: {
  /** The connected person's display name, or '' when name-deferred (signed in with Google/passkey and
   *  hasn't claimed a public handle yet). We NEVER render a placeholder name — the heading goes
   *  identity-light instead of saying "Welcome, you". */
  name: string;
  caps: RoleCapabilities;
  /** Open a ready/incomplete workspace. */
  onOpen: (kind: RoleKind) => void;
  /** Begin setup for a not-started role (opens the workspace onboarding). */
  onSetup: (kind: RoleKind) => void;
  /** Reconnect to refresh access (grant-missing / load-failed). */
  onReconnect: () => void;
  /** Open the person's Impact home. */
  onOpenHome: () => void;
}) {
  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          {name ? `Welcome, ${name}` : `You’re connected to ${JP.impactName}`}
        </Typography>
        <Typography sx={{ mt: 0.5, color: 'text.secondary', maxWidth: 720 }}>
          What would you like to do? You can do both and switch any time &mdash; it&rsquo;s all one
          connection, not separate accounts.
        </Typography>
      </Box>

      <Grid container spacing={2.5}>
        {(['adopter', 'facilitator'] as RoleKind[]).map((kind) => {
          const cap = caps.byKind[kind];
          const c = COPY[kind];
          return (
            <Grid key={kind} item xs={12} md={6}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ p: 2.5, display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box aria-hidden sx={{ fontSize: '1.4rem' }}>{c.emoji}</Box>
                    <Chip size="small" color="primary" variant="outlined" label={c.side} />
                  </Box>
                  <Typography variant="h6" sx={{ mt: 1, fontWeight: 800 }}>{c.title}</Typography>
                  <Typography sx={{ color: 'text.secondary', fontSize: '.85rem' }}>{c.sub}</Typography>
                  <Box component="ul" sx={{ pl: 2.25, mt: 1.25, mb: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {c.bullets.map((b) => (
                      <Typography component="li" key={b} sx={{ fontSize: '.85rem', color: 'text.secondary' }}>{b}</Typography>
                    ))}
                  </Box>
                  <Box sx={{ flexGrow: 1 }} />
                  <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <StatePill state={cap.state} />
                    <Box sx={{ flexGrow: 1 }} />
                    <RoleAction kind={kind} state={cap.state} onOpen={() => onOpen(kind)} onSetup={() => onSetup(kind)} onReconnect={onReconnect} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Card sx={{ bgcolor: 'grey.50' }}>
        <CardContent sx={{ p: 2.5 }}>
          <Button onClick={onOpenHome} sx={{ p: 0, color: 'primary.main', fontWeight: 700, textTransform: 'none' }}>
            Open {JP.impactName} home →
          </Button>
          <Typography sx={{ mt: 0.5, fontSize: '.82rem', color: 'text.secondary' }}>
            Your data lives in your {JP.impactName} home; {JP.org} reads only what you grant (its intended
            program scope — record-level enforcement lands with spec 248).
          </Typography>
        </CardContent>
      </Card>
    </Stack>
  );
}

function StatePill({ state }: { state: RoleState }) {
  switch (state) {
    case 'ready': return <Chip size="small" color="success" label="ready" />;
    case 'incomplete': return <Chip size="small" color="warning" variant="outlined" label="setup remains" />;
    case 'grant-missing': return <Chip size="small" color="error" variant="outlined" label="reconnect needed" />;
    case 'load-failed': return <Chip size="small" color="error" variant="outlined" label="couldn't load" />;
    default: return <Chip size="small" variant="outlined" label="not started" />;
  }
}

function RoleAction({ kind, state, onOpen, onSetup, onReconnect }: {
  kind: RoleKind; state: RoleState; onOpen: () => void; onSetup: () => void; onReconnect: () => void;
}) {
  const label = kind === 'adopter' ? 'adopter' : 'facilitator';
  if (state === 'ready') return <Button variant="contained" size="small" onClick={onOpen}>Continue as {label}</Button>;
  if (state === 'incomplete') return <Button variant="contained" size="small" onClick={onOpen}>Resume setup</Button>;
  if (state === 'grant-missing' || state === 'load-failed') return <Button variant="outlined" size="small" color="error" onClick={onReconnect}>Reconnect</Button>;
  return <Button variant="outlined" size="small" onClick={onSetup}>Set up {label}</Button>;
}
