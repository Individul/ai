import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

// Testele ruleaza in workerd (miniflare) cu un D1 si un R2 reale, locale. Migratiile din
// ./migrations ajung in bindingul TEST_MIGRATIONS si sunt aplicate in src/test/setup.ts,
// deci schema din teste este exact cea din productie.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        // Cel mai nou suportat de workerd-ul din pool (productia are 2026-09-03 in wrangler.jsonc).
        compatibilityDate: "2026-08-22",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["FISIERE"],
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url))),
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./src/test/setup.ts"],
  },
});
