// POST /api/chat { catalog, intrebare, istoric: [{intrebare, raspuns}] }
// Intrebarea unui coleg catre catalogul dat: verifica limita zilnica, intreaba Gemini File Search,
// scrie in jurnal si intoarce raspunsul cu citari si cate intrebari mai are azi.
//
// Blocarea si identitatea sunt in middleware. Istoricul vine de la client (stateless).
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { citesteCatalog, surseIndexate } from "../../../lib/db";
import { citesteSetare, inregistreazaIntrebare, intrebariAzi, limitaPentru } from "../../../lib/consum";
import { costMicrodolari, intreaba, EroareGemini, type Schimb } from "../../../lib/gemini";
import { citesteJson, eroare, json } from "../../../lib/api";
import { aziChisinau } from "../../../lib/data";
import { LIMITA_INTREBARE, esteModel } from "../../../lib/validare";

interface Corp {
  catalog?: string;
  intrebare?: string;
  istoric?: { intrebare?: string; raspuns?: string }[];
}

export const POST: APIRoute = async ({ request, locals }) => {
  const c = await citesteJson<Corp>(request);
  if (!c.ok) return c.raspuns;
  const intrebare = (c.date.intrebare ?? "").trim();
  if (!intrebare) return eroare(400, "Scrie o întrebare.");
  if (intrebare.length > LIMITA_INTREBARE) return eroare(400, `Întrebarea are peste ${LIMITA_INTREBARE} de caractere.`);
  const istoric: Schimb[] = (Array.isArray(c.date.istoric) ? c.date.istoric : [])
    .slice(-8)
    .map((s) => ({ intrebare: String(s?.intrebare ?? ""), raspuns: String(s?.raspuns ?? "") }));

  const catalog = await citesteCatalog(env.DB, c.date.catalog ?? "");
  if (!catalog || (catalog.stare === "arhivat" && !locals.admin)) return eroare(404, "Catalogul nu există.");
  if (!catalog.magazin || (await surseIndexate(env.DB, catalog.id)) === 0) {
    return eroare(409, "Catalogul nu are încă documente indexate.");
  }
  if (!env.GEMINI_API_KEY) return eroare(503, "Chatul nu este configurat încă pe server.");

  const zi = aziChisinau();
  const email = locals.email;
  const [folosite, limita] = await Promise.all([intrebariAzi(env.DB, email, zi), limitaPentru(env.DB, email)]);
  if (folosite >= limita) {
    await inregistreazaIntrebare(env.DB, {
      email, catalog_id: catalog.id, zi, intrebare, raspuns: "", citari: [], model: "",
      tokens_intrare: 0, tokens_iesire: 0, cost_microdolari: 0, stare: "refuzat", durata_ms: null,
    });
    return json({ eroare: `Ai atins limita de ${limita} întrebări pe zi. Revino mâine.`, ramase: 0, limita }, 429);
  }

  let model = await citesteSetare(env.DB, "model");
  if (!esteModel(model)) model = "gemini-3.5-flash-lite";
  const start = Date.now();
  try {
    const r = await intreaba(env.GEMINI_API_KEY, { model, magazin: catalog.magazin, istoric, intrebare });
    const durata_ms = Date.now() - start;
    await inregistreazaIntrebare(env.DB, {
      email, catalog_id: catalog.id, zi, intrebare, raspuns: r.text, citari: r.citari, model,
      tokens_intrare: r.tokens_intrare, tokens_iesire: r.tokens_iesire,
      cost_microdolari: costMicrodolari(model, r.tokens_intrare, r.tokens_iesire), stare: "ok", durata_ms,
    });
    return json({ raspuns: r.text, citari: r.citari, ramase: Math.max(0, limita - folosite - 1), limita, model });
  } catch (e) {
    const mesaj = (e as Error).message;
    await inregistreazaIntrebare(env.DB, {
      email, catalog_id: catalog.id, zi, intrebare, raspuns: `[eroare] ${mesaj}`, citari: [], model,
      tokens_intrare: 0, tokens_iesire: 0, cost_microdolari: 0, stare: "eroare", durata_ms: Date.now() - start,
    });
    const status = e instanceof EroareGemini && e.status === 503 ? 503 : 502;
    return eroare(status, `Nu am putut obține răspunsul: ${mesaj}`);
  }
};
