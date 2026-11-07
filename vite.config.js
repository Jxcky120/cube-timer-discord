import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  envDir: '..',
  // Exposes DISCORD_CLIENT_ID to the browser. The bot token and client secret stay server-only.
  envPrefix: ['VITE_', 'DISCORD_CLIENT_ID'],
  server: {
    port: 5173,
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.io'],
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
