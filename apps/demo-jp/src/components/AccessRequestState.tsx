// Request-access / missing-delegation state (production UX Wave 3, design spec §3a "missing-delegation
// is not a first-class state" + §15c + §15b.1; mirrors demo-gs's `AccessRequestState`). Shown when a
// member workspace needs vault data but the scoped JP grant is missing/expired — instead of a raw
// error banner. Per ADR-0013 there is NO silent fallback: the member→JP grant is the ONE mechanism to
// read the member's JP-program records, so the recovery is to reconnect (re-mint the session grant),
// with an explicit limited-view escape.
//
// Reusable: the access disclosure (owner / scope / grantee / revoke) + the primary recovery CTA + the
// optional limited-view option are passed in, so the facilitator variant (Wave 4) reuses this shell.
// Material UI. No adopter/facilitator literals here — the caller supplies all copy.

import { Card, CardContent, Typography, Button, Box, Stack } from '@mui/material';

export interface GrantDisclosure {
  owner: string; // who owns the data, e.g. "you (your Impact home)"
  scope: string; // what would be read, e.g. "your JP adopter program records"
  grantee: string; // who receives access, e.g. "Joshua Project"
  /** How the user revokes; defaults to a generic "from your home" line. */
  revoke?: string;
}

export function AccessRequestState({
  title,
  body,
  disclosure,
  primary,
  limited,
}: {
  title: string;
  body: string;
  disclosure: GrantDisclosure;
  /** The recovery action — re-mint the grant (e.g. reconnect to refresh access). */
  primary: { label: string; onClick: () => void };
  /** Optional escape to a limited view without the grant. */
  limited?: { label: string; onClick: () => void };
}) {
  return (
    <Card sx={{ maxWidth: 560, mx: 'auto', my: 2, borderColor: 'warning.main' }}>
      <CardContent>
        <Box sx={{ fontSize: '2rem', textAlign: 'center' }} aria-hidden>
          🔒
        </Box>
        <Typography variant="h5" sx={{ fontWeight: 800, textAlign: 'center', mt: 0.5 }}>
          {title}
        </Typography>
        <Typography sx={{ fontSize: '.88rem', color: 'text.secondary', textAlign: 'center', mt: 1, lineHeight: 1.5 }}>
          {body}
        </Typography>

        <Stack
          spacing={0.5}
          sx={{
            bgcolor: (t) => `${t.palette.warning.light}1f`,
            border: '1px solid',
            borderColor: 'warning.main',
            borderRadius: 2,
            px: 1.5,
            py: 1,
            my: 2,
          }}
        >
          <Row k="Owner" v={disclosure.owner} />
          <Row k="Scope" v={disclosure.scope} />
          <Row k="Grantee" v={disclosure.grantee} />
          <Row k="Revoke" v={disclosure.revoke ?? 'Anytime, from your Impact home'} />
        </Stack>

        <Button variant="contained" fullWidth onClick={primary.onClick} sx={{ fontWeight: 700 }}>
          {primary.label}
        </Button>
        {limited && (
          <Button variant="text" fullWidth onClick={limited.onClick} sx={{ mt: 1, fontWeight: 700 }}>
            {limited.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, fontSize: '.82rem' }}>
      <Typography component="span" sx={{ fontWeight: 800, minWidth: 64, color: 'warning.dark', fontSize: 'inherit' }}>
        {k}
      </Typography>
      <Typography component="span" sx={{ color: 'text.primary', fontSize: 'inherit' }}>
        {v}
      </Typography>
    </Box>
  );
}
