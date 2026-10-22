import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // The server tests start a real embedded database and hash passwords; give them room on slow machines.
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 30_000 },
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
    hmr: false,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://127.0.0.1:4000',
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (res && 'writeHead' in res && !res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Backend server initializing...' }));
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
  },
});
