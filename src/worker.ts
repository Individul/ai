// Punctul de intrare al Workerului: cererile HTTP merg la Astro (adaptorul Cloudflare), iar
// declansarile programate (wrangler.jsonc -> triggers.crons) fac incalzirea cache-ului DeepSeek
// pentru culegerile din setari.incalzire. Local: `wrangler dev --test-scheduled`, apoi
// `curl "http://localhost:8787/__scheduled?cron=0+5+*+*+1-5"`.
import astro from "@astrojs/cloudflare/entrypoints/server";
import { incalzesteToate } from "./lib/incalzire";

export default {
  fetch: astro.fetch,
  async scheduled(controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const rezultate = await incalzesteToate(env);
        for (const r of rezultate) console.log(`[incalzire ${controller.cron}]`, JSON.stringify(r));
      })()
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;
