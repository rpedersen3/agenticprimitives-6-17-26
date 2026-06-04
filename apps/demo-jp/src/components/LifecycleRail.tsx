// A reusable horizontal lifecycle rail (production UX Wave 3, design spec §10 progress rail + §15a
// "lifecycle rail"; mirrors demo-gs's `LifecycleRail`). GENERIC: it renders any ordered list of
// `{ key, label, done, current }` steps with done / current / upcoming visuals, so Wave 4 (the
// facilitator workspace) can reuse it with its own steps. No adopter/facilitator-specific copy lives
// here — the caller passes the steps + an optional eyebrow. Material UI.

import { Card, CardContent, Stack, Typography, Box } from '@mui/material';

export interface RailStep {
  key: string;
  label: string;
  done: boolean;
  current: boolean;
}

export function LifecycleRail({ steps, eyebrow }: { steps: RailStep[]; eyebrow?: string }) {
  return (
    <Card>
      <CardContent sx={{ py: 1.5, px: 2 }}>
        {eyebrow && (
          <Typography
            variant="overline"
            sx={{ display: 'block', mb: 0.75, color: 'text.secondary', letterSpacing: '.08em', fontWeight: 700 }}
          >
            {eyebrow}
          </Typography>
        )}
        <Stack direction="row" alignItems="center" flexWrap="wrap" sx={{ rowGap: 0.75 }}>
          {steps.map((s, i) => (
            <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', flex: '1 1 auto', minWidth: 0 }}>
              <Dot done={s.done} current={s.current} />
              <Typography
                component="span"
                sx={{
                  ml: 0.6,
                  whiteSpace: 'nowrap',
                  fontSize: '.78rem',
                  fontWeight: s.done || s.current ? 700 : 400,
                  color: s.done || s.current ? 'text.primary' : 'text.disabled',
                }}
              >
                {s.label}
              </Typography>
              {i < steps.length - 1 && (
                <Box
                  aria-hidden
                  sx={{ flex: '1 1 16px', minWidth: 16, height: '2px', mx: 0.75, bgcolor: 'divider' }}
                />
              )}
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

function Dot({ done, current }: { done: boolean; current: boolean }) {
  const filled = done || current;
  return (
    <Box
      aria-hidden
      sx={{
        width: 14,
        height: 14,
        borderRadius: '999px',
        flex: '0 0 auto',
        bgcolor: filled ? 'primary.main' : 'background.paper',
        border: '2px solid',
        borderColor: filled ? 'primary.main' : 'grey.300',
        boxShadow: current ? (t) => `0 0 0 3px ${t.palette.primary.light}55` : 'none',
      }}
    />
  );
}
