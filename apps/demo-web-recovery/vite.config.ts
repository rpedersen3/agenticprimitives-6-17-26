import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@agenticprimitives/agent-account': new URL(
        '../../packages/agent-account/src/index.ts',
        import.meta.url,
      ).pathname,
    },
  },
  server: {
    // Sibling to demo-web (5173) + demo-web-pro (5273). All three run
    // in parallel during dev so the recovery demo can read demo-web-pro
    // state directly via window.localStorage (same origin pattern in
    // production where both ship as Cloudflare Pages subdomains, then
    // share state via a documented import/export — Wave R3.5).
    port: 5373,
    proxy: {
      '/a2a': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/a2a/, ''),
      },
    },
  },
});
