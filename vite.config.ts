import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async ({ mode }) => {
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const appEnv = loadEnv(mode, process.cwd(), "");
  const envValue = (name: string, fallback = "") =>
    appEnv[name] || process.env[name] || fallback;

  const localBindingConfig = {
    main: "vinext/server/fetch-handler",
    compatibility_flags: ["nodejs_compat"],
    vars: {
      META_ACCESS_TOKEN: envValue("META_ACCESS_TOKEN"),
      META_API_VERSION: envValue("META_API_VERSION", "v26.0"),
      META_APP_ID: envValue("META_APP_ID"),
      META_APP_SECRET: envValue("META_APP_SECRET"),
      META_OAUTH_REDIRECT_URI: envValue("META_OAUTH_REDIRECT_URI"),
      TOKEN_ENCRYPTION_KEY: envValue("TOKEN_ENCRYPTION_KEY"),
      BVAGC_RESOURCE_GATEWAY_URL: envValue("BVAGC_RESOURCE_GATEWAY_URL"),
      BVAGC_RESOURCE_API_KEY: envValue("BVAGC_RESOURCE_API_KEY"),
      BVAGC_GUIDE_GATEWAY_URL: envValue("BVAGC_GUIDE_GATEWAY_URL"),
    },
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: "site-creator-d1",
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: "site-creator-r2",
          },
        ]
      : [],
  };

  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    // Vinext beta + Vite can otherwise pre-bundle this RSC/client shim in one
    // environment and leave it unbundled in another. On Windows dev this can
    // result in a fully blank page even though API requests still return 200.
    optimizeDeps: {
      exclude: ["vinext/dist/shims/internal/app-prefetch-fetch-queue.js"],
    },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
