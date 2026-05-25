import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Distinct from demo-web (5173) + demo-web-pro (5273) so all run side-by-side.
    port: 5373,
    proxy: {
      // Dev: forward /a2a/<route> to <route> on the demo-a2a Worker (strip prefix),
      // matching the prod Pages proxy (functions/a2a/[[path]].ts). Override the
      // target with VITE_DEMO_A2A_URL for a local demo-a2a.
      '/a2a': {
        target: process.env.VITE_DEMO_A2A_URL || 'https://demo-a2a-production.richardpedersen3.workers.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/a2a/, ''),
      },
    },
  },
});
