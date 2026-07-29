import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    proxy: {
      '/__petdex/manifest': {
        target: 'https://assets.petdex.dev',
        changeOrigin: true,
        headers: {
          Origin: 'https://petdex.dev',
          Referer: 'https://petdex.dev/',
        },
        rewrite: () => '/manifests/petdex-v2.json',
      },
      '/__petdex/assets': {
        target: 'https://assets.petdex.dev',
        changeOrigin: true,
        headers: {
          Origin: 'https://petdex.dev',
          Referer: 'https://petdex.dev/',
        },
        rewrite: (path) => path.replace(/^\/__petdex\/assets/, ''),
      },
      '/__petshare/catalog': {
        target: 'https://petshare.idevlab.dev',
        changeOrigin: true,
        rewrite: () => '/pets.json',
      },
      '/__petshare/assets': {
        target: 'https://petshare.idevlab.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__petshare\/assets/, ''),
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'oxc',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
