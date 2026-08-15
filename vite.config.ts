import vinext from "vinext";
import { defineConfig } from "vite";

const LOCAL_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const isPollingWatch = process.env.VINEXT_POLLING === "true";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [
    {
      binding: "DB",
      database_name: "spamkill-local",
      database_id: LOCAL_DATABASE_ID,
      // The generated Wrangler config lives under dist/server.
      migrations_dir: "../../drizzle",
    },
  ],
  r2_buckets: [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      allowedHosts: ["spamkill.luiszamora.dev"],
      ...(isPollingWatch
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
