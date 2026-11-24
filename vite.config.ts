import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = `http://localhost:${process.env.PORT ?? 8080}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/ui': { target, ws: true },
    },
  },
});
