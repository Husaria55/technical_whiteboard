import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';

// MathJax reads its version from package.json via `require` unless this is defined.
const mathjaxVersion = createRequire(import.meta.url)('mathjax-full/package.json').version as string;

const server = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  define: {
    PACKAGE_VERSION: JSON.stringify(mathjaxVersion),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: server, ws: true, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
