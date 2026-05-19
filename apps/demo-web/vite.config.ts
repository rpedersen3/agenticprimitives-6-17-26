import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward a2a calls during local dev so the browser can call /a2a/*
      // without CORS pain.
      '/a2a': 'http://127.0.0.1:8787',
    },
  },
});
