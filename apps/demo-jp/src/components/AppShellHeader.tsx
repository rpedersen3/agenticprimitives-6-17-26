// App shell header (production UX spec §6/§15a; mirrors demo-gs's connect-first header, rendered with
// MUI per the user's choice). Replaces PersonaBar. Member roles require a real Connect session.
// Connecting is ONE simple action (signed-out → a single `Connect` button — NO role selection up front;
// the user picks adopter/facilitator AFTER connecting, in the RoleHub). Pete/Jill are DEMO ADMIN
// shortcuts hidden behind a collapsed "Admin ▾" expander inside the dropdown so regular users don't see
// them prominently.
//
// Two states:
//   • signed out  — JP Adopt brand (left) + a primary `Connect` button (right). The dropdown is just the
//                   Admin expander + a privacy link.
//   • connected   — an identity pill (display name · active role, or "· choose a workspace" in the hub)
//                   + a Menu with the identity summary (name + <name>.impact-agent.me), Open Impact
//                   home, role switch/setup (when caps known), Disconnect, and the Admin expander.
// All actions are lifted to the App (it owns routing + session); this is presentation only.

import { useState, type MouseEvent, type ReactElement } from 'react';
import {
  AppBar, Box, Button, Chip, Collapse, Divider, ListItemText, Menu, MenuItem, Toolbar, Typography,
} from '@mui/material';
import { JP } from '../lib/brand';
import { personalHome } from '../lib/domain';
import type { RoleCapabilities, RoleKind } from '../lib/role-capabilities';

const ROLE_LABEL: Record<RoleKind, string> = { adopter: 'Adopter', facilitator: 'Facilitator' };

export interface ConnectedIdentity {
  /** Display name (friendly when known, else the handle). */
  displayName: string;
  /** The Impact handle/name (drives the <name>.impact-agent.me home line). */
  handle: string;
  /** The active workspace role, or null when in the hub (no workspace open → "choose a workspace"). */
  activeRole: RoleKind | null;
}

export function AppShellHeader({
  admin = false, identity, caps,
  onConnect, onDemoPete, onDemoJill, onHelp,
  onOpenHome, onDisconnect, onSwitchRole, onSetupRole,
}: {
  /** In a Pete/Jill demo-admin surface → a distinct dark header so it's obvious you're in the
   *  demo-admin area, not a connected user page. */
  admin?: boolean;
  /** The connected member, or null when signed out. */
  identity: ConnectedIdentity | null;
  /** Role capabilities (connected only) — drives the switch/setup entries. */
  caps: RoleCapabilities | null;
  /** Signed-out: open the role-agnostic connect entry. */
  onConnect: () => void;
  /** Demo-admin shortcuts (behind the Admin expander). */
  onDemoPete: () => void;
  onDemoJill: () => void;
  onHelp: () => void;
  /** Connected actions. */
  onOpenHome: () => void;
  onDisconnect: () => void;
  /** Switch to a ready role. */
  onSwitchRole: (kind: RoleKind) => void;
  /** Begin setup for a not-yet-ready role. */
  onSetupRole: (kind: RoleKind) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const open = !!anchor;
  const openMenu = (e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget);
  const close = () => { setAnchor(null); setAdminOpen(false); };
  const run = (fn: () => void) => () => { close(); fn(); };

  // Role switch/setup entries — the role(s) OTHER than the active one (both in the hub, where there is
  // no active role), only when capabilities are known.
  const others: RoleKind[] = (['adopter', 'facilitator'] as RoleKind[]).filter((k) => k !== identity?.activeRole);

  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        bgcolor: admin ? '#0f172a' : '#ffffff',
        color: admin ? '#fff' : 'text.primary',
        borderBottom: '1px solid',
        borderColor: admin ? '#0f172a' : 'divider',
      }}
    >
      <Toolbar sx={{ maxWidth: 1080, mx: 'auto', width: '100%', gap: 1 }}>
        {admin && (
          <Chip
            size="small" label="DEMO ADMIN"
            sx={{ mr: 1, bgcolor: '#b45309', color: '#fff', fontWeight: 800, letterSpacing: '.06em' }}
          />
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1 }}>
          <Box aria-hidden sx={{ fontSize: '1.25rem' }}>🌍</Box>
          <Box sx={{ lineHeight: 1.1 }}>
            <Typography component="span" sx={{ fontWeight: 800, fontSize: '1.05rem' }}>{JP.appName}</Typography>
            <Typography component="div" variant="caption" sx={{ color: admin ? 'rgba(255,255,255,.7)' : 'text.secondary' }}>
              {JP.org} · Frontier People Groups
            </Typography>
          </Box>
        </Box>

        {identity ? (
          <Button
            onClick={openMenu}
            variant="contained"
            color="primary"
            aria-haspopup="menu"
            aria-expanded={open}
            sx={{ textTransform: 'none', fontWeight: 700 }}
            endIcon={<span aria-hidden>▾</span>}
          >
            {identity.displayName}
            {identity.activeRole ? ` · ${ROLE_LABEL[identity.activeRole]}` : ' · choose a workspace'}
          </Button>
        ) : (
          <Button
            onClick={openMenu}
            variant="contained"
            color="primary"
            aria-haspopup="menu"
            aria-expanded={open}
            sx={{ textTransform: 'none', fontWeight: 700 }}
            endIcon={<span aria-hidden>▾</span>}
          >
            Connect
          </Button>
        )}

        <Menu
          anchorEl={anchor}
          open={open}
          onClose={close}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { sx: { width: 320, mt: 0.5 } } }}
        >
          {identity
            ? connectedItems(identity, caps, others, { onOpenHome, onDisconnect, onSwitchRole, onSetupRole }, run)
            : signedOutItems({ onConnect }, run)}

          <Divider />
          <AdminSection
            open={adminOpen}
            onToggle={() => setAdminOpen((v) => !v)}
            onDemoPete={run(onDemoPete)}
            onDemoJill={run(onDemoJill)}
          />
          <Divider />
          <MenuItem onClick={run(onHelp)} sx={{ color: 'text.secondary', fontSize: '.85rem' }}>
            Privacy &amp; data access
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}

function signedOutItems(
  { onConnect }: { onConnect: () => void },
  run: (fn: () => void) => () => void,
) {
  return [
    <MenuItem key="connect" onClick={run(onConnect)} sx={{ color: 'primary.main', fontWeight: 700 }}>
      Connect via {JP.impactName}
    </MenuItem>,
  ];
}

function connectedItems(
  identity: ConnectedIdentity,
  caps: RoleCapabilities | null,
  others: RoleKind[],
  actions: {
    onOpenHome: () => void; onDisconnect: () => void;
    onSwitchRole: (k: RoleKind) => void; onSetupRole: (k: RoleKind) => void;
  },
  run: (fn: () => void) => () => void,
) {
  const items: ReactElement[] = [
    <Box key="summary" sx={{ px: 2, py: 1 }}>
      <Typography sx={{ fontWeight: 800, fontSize: '.95rem' }}>{identity.displayName}</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: "'SF Mono','Roboto Mono',monospace" }}>
        {personalHome(identity.handle)}
      </Typography>
      <Box sx={{ mt: 0.75 }}>
        <Chip
          size="small"
          label={identity.activeRole ? `Working as ${ROLE_LABEL[identity.activeRole]}` : 'Choose a workspace'}
          sx={{ bgcolor: 'primary.light', color: 'primary.dark', fontWeight: 700 }}
        />
      </Box>
    </Box>,
    <Divider key="d1" />,
    <MenuItem key="home" onClick={run(actions.onOpenHome)}>Open {JP.impactName} home</MenuItem>,
  ];

  if (caps) {
    for (const k of others) {
      const cap = caps.byKind[k];
      items.push(
        cap.ready
          ? <MenuItem key={`role-${k}`} onClick={run(() => actions.onSwitchRole(k))}>Switch workspace: {ROLE_LABEL[k]}</MenuItem>
          : <MenuItem key={`role-${k}`} onClick={run(() => actions.onSetupRole(k))} sx={{ color: 'text.secondary' }}>Set up {ROLE_LABEL[k]} workspace</MenuItem>,
      );
    }
  }

  items.push(
    <MenuItem key="disconnect" onClick={run(actions.onDisconnect)} sx={{ color: 'warning.main', fontWeight: 700 }}>
      Disconnect
    </MenuItem>,
  );
  return items;
}

// Demo-admin (Pete/Jill) shortcuts behind a collapsed "Admin ▾" expander so they aren't prominent for
// regular users. Collapsed by default; expanding reveals the demo-admin label + the two shortcuts.
function AdminSection({ open, onToggle, onDemoPete, onDemoJill }: {
  open: boolean; onToggle: () => void; onDemoPete: () => void; onDemoJill: () => void;
}) {
  return (
    <Box>
      <MenuItem onClick={onToggle} aria-expanded={open} sx={{ color: 'text.secondary', fontSize: '.85rem' }}>
        <ListItemText primary="Admin" />
        <span aria-hidden style={{ fontSize: '.75rem' }}>{open ? '▴' : '▾'}</span>
      </MenuItem>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <Box sx={{ px: 2, pb: 1 }}>
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 800, letterSpacing: '.06em', color: 'text.disabled', pb: 0.5 }}>
            DEMO ADMIN — NOT PRODUCTION AUTHORIZATION
          </Typography>
          <Button fullWidth size="small" variant="outlined" color="secondary" onClick={onDemoPete} sx={{ justifyContent: 'flex-start', mb: 0.75 }}>
            ⛪ Pete / Global Church (issuer)
          </Button>
          <Button fullWidth size="small" variant="outlined" color="secondary" onClick={onDemoJill} sx={{ justifyContent: 'flex-start' }}>
            🛰️ Jill / JP (broker)
          </Button>
        </Box>
      </Collapse>
    </Box>
  );
}
