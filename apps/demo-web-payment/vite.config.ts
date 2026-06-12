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
    // Different port from demo-web (5173) so both apps can run side-by-side
    // in dev without conflict.
    port: 5273,
    proxy: {
      '/a2a': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/a2a/, ''),
      },
    },
  },
});
