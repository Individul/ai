// POST /api/chat { catalog, intrebare, istoric: [{intrebare, raspuns}] }
// Intrebarea unui coleg catre catalogul dat: verifica limita zilnica, intreaba motorul ales in Admin
// (Gemini File Search, sau Z.AI / DeepSeek cu textul extras), scrie in jurnal si intoarce raspunsul
// cu citari si cate intrebari mai are azi.
//
// Blocarea si identitatea sunt in middleware. Istoricul vine de la client (stateless).
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { citesteCatalog, listeazaSurse } from "../../../lib/db";
import { citesteBuget, citesteSetare, inregistreazaIntrebare, intrebariAzi, limitaPentru } from "../../../lib/consum";
import { EroareGemini, type Schimb } from "../../../lib/gemini";
import { EroareZai } from "../../../lib/zai";
import { cheieMotor, disponibilePentruChat, raspunde } from "../../../lib/motor";
import { citesteJson, eroare, json } from "../../../lib/api";
import { aziChisinau } from "../../../lib/data";
import { LIMITA_INTREBARE, esteModel, motorModel } from "../../../lib/validare";

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
  if (!catalog || (catalog.stare === "arhivat" && !locals.admin)) return eroare(404, "Culegerea nu există.");

  let model = await citesteSetare(env.DB, "model");
  if (!esteModel(model)) model = "gemini-3.5-flash-lite";
  const motor = motorModel(model) ?? "gemini";
  const surse = await listeazaSurse(env.DB, catalog.id);
  if (disponibilePentruChat(motor, catalog.magazin, surse) === 0) {
    return eroare(409, "Culegerea nu are încă documente pregătite pentru chat.");
  }
  if (!cheieMotor(env, motor)) return eroare(503, "Chatul nu este configurat încă pe server.");

  const zi = aziChisinau();
  const email = locals.email;
  const [folosite, limita] = await Promise.all([intrebariAzi(env.DB, email, zi), limitaPentru(env.DB, email)]);
  if (folosite >= limita) {
    await inregistreazaIntrebare(env.DB, {
      email, catalog_id: catalog.id, zi, intrebare, raspuns: "", citari: [], model: "",
      tokens_intrare: 0, tokens_iesire: 0, cost_microdolari: 0, credite: 0, stare: "refuzat", durata_ms: null,
    });
    return json({ eroare: `Ai atins limita de ${limita} întrebări pe zi. Revino mâine.`, ramase: 0, limita }, 429);
  }

  const buget = await citesteBuget(env.DB);
  const start = Date.now();
  try {
    const r = await raspunde(env, { model, catalog, istoric, intrebare, buget });
    const durata_ms = Date.now() - start;
    await inregistreazaIntrebare(env.DB, {
      email, catalog_id: catalog.id, zi, intrebare, raspuns: r.text, citari: r.citari, model,
      tokens_intrare: r.tokens_intrare, tokens_iesire: r.tokens_iesire,
      cost_microdolari: r.cost_microdolari, credite: r.credite, stare: "ok", durata_ms,
    });
    return json({ raspuns: r.text, citari: r.citari, ramase: Math.max(0, limita - folosite - 1), limita, model, mod: r.mod });
  } catch (e) {
    const mesaj = (e as Error).message;
    await inregistreazaIntrebare(env.DB, {
      email, catalog_id: catalog.id, zi, intrebare, raspuns: `[eroare] ${mesaj}`, citari: [], model,
      tokens_intrare: 0, tokens_iesire: 0, cost_microdolari: 0, credite: 0, stare: "eroare", durata_ms: Date.now() - start,
    });
    const status = (e instanceof EroareGemini || e instanceof EroareZai) && e.status === 503 ? 503 : 502;
    return eroare(status, `Nu am putut obține răspunsul: ${mesaj}`);
  }
};
