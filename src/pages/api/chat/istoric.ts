// GET /api/chat/istoric?catalog=<id>&n=<1..50>&inainte=<creat_la> — intrebarile reusite ale
// utilizatorului curent in catalogul dat, in ordine cronologica, cate `n` (implicit 5), mai vechi
// decat `inainte` cand e dat. `mai_vechi` spune daca mai exista altele inainte de prima intoarsa,
// ca pagina sa arate butonul "arata mai multe".
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { istoricCatalog } from "../../../lib/consum";
import { eroare, json } from "../../../lib/api";

export const GET: APIRoute = async ({ url, locals }) => {
  const catalog = url.searchParams.get("catalog") ?? "";
  if (!catalog) return eroare(400, "Lipsește culegerea.");
  const n = Math.min(50, Math.max(1, Number(url.searchParams.get("n")) || 5));
  const inainte = url.searchParams.get("inainte") || undefined;
  // Cerem unul in plus doar ca sa stim daca mai sunt; nu il trimitem.
  const randuri = await istoricCatalog(env.DB, locals.email, catalog, n + 1, inainte);
  const mai_vechi = randuri.length > n;
  const pagina = mai_vechi ? randuri.slice(1) : randuri;
  return json({
    istoric: pagina.map((r) => ({
      id: r.id, intrebare: r.intrebare, raspuns: r.raspuns, creat_la: r.creat_la,
      citari: (() => { try { return JSON.parse(r.citari); } catch { return []; } })(),
    })),
    mai_vechi,
  });
};
