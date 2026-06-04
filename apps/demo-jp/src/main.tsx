import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { App } from './App';
import { jpTheme } from './theme';

// The user chose Material UI for demo-jp. Mount the MUI ThemeProvider (a light corporate teal theme) at
// the root so the NEW shell / connect-entry / discovery / hub components render natively. We deliberately
// do NOT mount CssBaseline: the legacy dashboards still rely on the global CSS + design tokens in
// index.html, and CssBaseline would reset body/typography out from under them. MUI components style
// themselves via emotion regardless, so the theme applies without a global reset.
createRoot(document.getElementById('root')!).render(
  <ThemeProvider theme={jpTheme}>
    <App />
  </ThemeProvider>,
);
