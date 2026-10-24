// Vite-конфиг для src/web.
// Dev-сервер на 5173, проксирует /api на backend (localhost:3000).

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, 'src/web');

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // /__api (двойное подчёркивание) — намеренно не пересекается
      // с файловой структурой src/web/api. Иначе Vite попытается
      // проксировать /api/client.ts как backend-запрос.
      '/__api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__api/, ''),
      },
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': webRoot,
    },
  },
});