// MUI theme for demo-jp (production UX spec §15.1; the user chose Material UI for demo-jp). A light
// corporate theme on demo-jp's existing teal palette (the index.html CSS vars: primary #0f766e, warm
// gold accent #b45309). Only the NEW shell/entry/hub/discovery components render with MUI; the existing
// dashboards keep their global-CSS styling, so the theme is intentionally restrained — it just makes
// the new surfaces look native alongside the legacy panels.

import { createTheme } from '@mui/material/styles';

export const jpTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0f766e', dark: '#115e59', light: '#2dd4bf', contrastText: '#ffffff' },
    secondary: { main: '#b45309', light: '#f59e0b', contrastText: '#ffffff' },
    success: { main: '#16a34a' },
    warning: { main: '#b45309' },
    error: { main: '#dc2626' },
    background: { default: '#ffffff', paper: '#ffffff' },
    text: { primary: '#0f172a', secondary: '#475569' },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    button: { textTransform: 'none', fontWeight: 700 },
    h1: { fontWeight: 800, letterSpacing: '-0.01em' },
    h2: { fontWeight: 800, letterSpacing: '-0.01em' },
    h3: { fontWeight: 700 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiCard: { styleOverrides: { root: { border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(15,23,42,.06)' } } },
    MuiPaper: { styleOverrides: { rounded: { borderRadius: 12 } } },
  },
});
