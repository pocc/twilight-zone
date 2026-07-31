import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  if (command !== 'serve') {
    throw new Error('vite.oauth-local.config.ts is restricted to the local OAuth dev server');
  }
  return {
    server: {
      port: 5173,
      strictPort: true,
    },
    plugins: [
      tailwindcss(),
      cloudflare({
        configPath: './test/fixtures/wrangler.oauth-local.toml',
        viteEnvironment: { name: 'worker' },
      }),
    ],
  };
});
