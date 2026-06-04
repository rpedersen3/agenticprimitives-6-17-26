// A reusable next-best-action card (production UX Wave 3, design spec §3b "next-best-action cards" +
// the §10 right rail; mirrors demo-gs's `NextBestAction`). GENERIC: the caller computes the single
// most useful next step (title + body + optional CTA) from its lifecycle position and passes it in;
// this is pure presentation, so Wave 4 (the facilitator workspace) reuses it with facilitator actions.
// No adopter/facilitator-specific copy lives here. Material UI.

import { Card, CardContent, Typography, Button } from '@mui/material';

export interface NextAction {
  /** A short eyebrow, e.g. "Next best action". */
  eyebrow?: string;
  title: string;
  body: string;
  /** Optional call-to-action; omit for a purely informational nudge (e.g. "awaiting review"). */
  cta?: { label: string; onClick: () => void };
  /** `wait` renders an informational (non-action) tone. */
  tone?: 'action' | 'wait';
}

export function NextBestAction({ action }: { action: NextAction }) {
  const wait = action.tone === 'wait';
  return (
    <Card
      sx={{
        bgcolor: wait ? 'grey.50' : (t) => `${t.palette.primary.light}1f`,
        borderColor: 'primary.main',
      }}
    >
      <CardContent>
        <Typography
          variant="overline"
          sx={{ display: 'block', color: 'text.secondary', letterSpacing: '.08em', fontWeight: 700 }}
        >
          {action.eyebrow ?? 'Next best action'}
        </Typography>
        <Typography variant="h6" sx={{ mt: 0.5, fontWeight: 800 }}>
          {action.title}
        </Typography>
        <Typography sx={{ mt: 0.5, fontSize: '.85rem', color: 'text.secondary', lineHeight: 1.5 }}>
          {action.body}
        </Typography>
        {action.cta && (
          <Button variant="contained" onClick={action.cta.onClick} sx={{ mt: 1.5, fontWeight: 700 }}>
            {action.cta.label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
