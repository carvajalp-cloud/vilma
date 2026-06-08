import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api to the backend so the SPA and API share an origin in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
