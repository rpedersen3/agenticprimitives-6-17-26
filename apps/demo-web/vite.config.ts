import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward /a2a/<route> in the browser to <route> on the a2a server,
      // stripping the /a2a prefix. Avoids CORS in dev without mounting
      // every demo-a2a route under /a2a server-side.
      '/a2a': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/a2a/, ''),
      },
    },
  },
});
