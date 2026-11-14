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
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      // /__api (двойное подчёркивание) — намеренно не пересекается
      // с файловой структурой src/web/api. Иначе Vite попытается
      // проксировать /api/client.ts как backend-запрос.
      '/__api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__api/, ''),
      },
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // A42: разделяем вендоров по библиотекам. Роуты пока не lazy (6b) —
        // но даже без lazy main-chunk упадёт до ~700 KB.
        manualChunks(id) {
          if (!id.includes('node_modules')) {return undefined;}

          // react-стек — грузится везде.
          if (
            /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)
          ) {
            return 'react-vendor';
          }

          // state / формы / запросы — грузятся почти везде.
          if (
            id.includes('node_modules/@tanstack/') ||
            id.includes('node_modules/zustand/') ||
            id.includes('node_modules/react-hook-form/') ||
            id.includes('node_modules/@hookform/')
          ) {
            return 'state-vendor';
          }

          // Графики (recharts) — только для страниц с Chart.
          if (id.includes('node_modules/recharts/') || id.includes('node_modules/d3-')) {
            return 'charts';
          }

          // Карты (leaflet) — только для страниц с Map.
          if (
            id.includes('node_modules/leaflet/') ||
            id.includes('node_modules/react-leaflet/') ||
            id.includes('node_modules/@react-leaflet/')
          ) {
            return 'maps';
          }

          // Сетки (drag-and-drop).
          if (
            id.includes('node_modules/react-grid-layout/') ||
            id.includes('node_modules/react-resizable/') ||
            id.includes('node_modules/react-draggable/')
          ) {
            return 'grid';
          }

          // Даты.
          if (id.includes('node_modules/date-fns/')) {
            return 'date-vendor';
          }

          // Остальное — один vendor. Если окажется большим — разделим по пакетам.
          return 'vendor';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': webRoot,
    },
  },
});