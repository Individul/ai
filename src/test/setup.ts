import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeEach } from "vitest";

// Ruleaza o data per fisier de test. D1-ul si R2-ul locale persista intre teste, asa ca
// fiecare test porneste de la tabele si bucket goale.
// TEST_MIGRATIONS exista doar in vitest.config.ts, nu in Cloudflare.Env.
const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };
await applyD1Migrations(env.DB, TEST_MIGRATIONS);

beforeEach(async () => {
  await env.DB.exec("DELETE FROM audio");
  await env.DB.exec("DELETE FROM surse");
  await env.DB.exec("DELETE FROM cataloage");
  const obiecte = await env.FISIERE.list();
  if (obiecte.objects.length) await env.FISIERE.delete(obiecte.objects.map((o) => o.key));
});
