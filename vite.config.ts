import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Port is overridable via DEV_PORT so a busy 5173 (e.g. a stale dev server)
  // doesn't block a run — pick a free port and point the harness at it with
  // DEV_SERVER_URL=http://localhost:$DEV_PORT. strictPort stays true so a
  // conflict fails LOUDLY at startup instead of silently drifting to another
  // port the harness wouldn't know about.
  // E2E_NO_HMR=1 disables Hot Module Replacement. The e2e harness drives long
  // SSE migrations through the running app; if any served file (app/* or src/*)
  // is edited mid-run, Vite's HMR would full-reload the page and abort the
  // in-flight migration (observed: a `page reload` lands during the account
  // phase → 6-min timeout). Serving a production build via `vite preview` isn't
  // a drop-in substitute because the catch-all asset route relies on env.ASSETS,
  // which isn't bound in preview. So for e2e we keep `vite dev` (correct asset
  // serving) but turn HMR off so concurrent edits can't reload the page.
  server: {
    port: Number(process.env.DEV_PORT) || 5173,
    strictPort: true,
    hmr: process.env.E2E_NO_HMR ? false : undefined,
  },
  plugins: [
    tailwindcss(),
    cloudflare({
      configPath: "./wrangler.toml",
      viteEnvironment: { name: "worker" },
    }),
  ],
});
