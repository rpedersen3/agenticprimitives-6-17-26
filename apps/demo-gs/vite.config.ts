import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Distinct from demo-web (5173) / demo-web-pro (5273) / demo-sso (5373) /
    // demo-org (5473) / demo-jp (5573).
    port: 5673,
    proxy: {
      // Dev: forward /a2a/<route> to the demo-a2a Worker (strip prefix) — used once the
      // demo-sso connect wiring lands (Phase 1). Harmless for the fixture-only build.
      '/a2a': {
        target: process.env.VITE_DEMO_A2A_URL || 'https://demo-a2a-production.richardpedersen3.workers.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/a2a/, ''),
      },
    },
  },
});
