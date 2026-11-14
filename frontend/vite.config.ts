import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // VITE_API_TARGET (shell or .env) points the dev proxy at another API, e.g. the e2e one on :3100.
  const apiTarget = loadEnv(mode, '.', 'VITE_').VITE_API_TARGET ?? 'http://localhost:3000';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: { '/api': apiTarget },
    },
    test: {
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  };
});
