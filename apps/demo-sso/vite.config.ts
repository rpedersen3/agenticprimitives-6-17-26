import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Distinct from demo-web (5173) + demo-web-pro (5273) so all run side-by-side.
    port: 5373,
  },
});
