// GET /api/chat/istoric?catalog=<id> — ultimele intrebari reusite ale utilizatorului curent
// in catalogul dat, in ordine cronologica. Alimenteaza chatul de pe pagina catalogului.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { istoricCatalog } from "../../../lib/consum";
import { eroare, json } from "../../../lib/api";

export const GET: APIRoute = async ({ url, locals }) => {
  const catalog = url.searchParams.get("catalog") ?? "";
  if (!catalog) return eroare(400, "Lipsește catalogul.");
  const randuri = await istoricCatalog(env.DB, locals.email, catalog, 30);
  return json({
    istoric: randuri.map((r) => ({
      id: r.id, intrebare: r.intrebare, raspuns: r.raspuns, creat_la: r.creat_la,
      citari: (() => { try { return JSON.parse(r.citari); } catch { return []; } })(),
    })),
  });
};
