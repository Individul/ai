// POST /api/corector/{id}/lot { paragrafe: [{i, text}] }
// Un lot de paragrafe catre modelul corectorului; intoarce corecturile, iar consumul se adauga la
// linia din jurnal (si cand raspunsul modelului nu se poate citi, fiindca s-a platit).
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { adaugaLaCorectare, citesteCorectare } from "../../../../lib/consum";
import { corecteazaLot, EroareCorectare } from "../../../../lib/motor";
import { citesteJson, eroare, json } from "../../../../lib/api";
import { EroareGemini } from "../../../../lib/gemini";
import { EroareZai } from "../../../../lib/zai";
import { LIMITA_LOT_SERVER, LIMITA_LOTURI } from "../../../../lib/corector";
import type { ParagrafText } from "../../../../lib/docx";

export const POST: APIRoute = async ({ params, request, locals }) => {
  const corectare = await citesteCorectare(env.DB, params.id ?? "");
  if (!corectare || corectare.email !== locals.email) return eroare(404, "Corectarea nu există.");
  if (corectare.stare !== "in_curs") return eroare(409, "Corectarea s-a încheiat deja.");
  if (corectare.loturi >= LIMITA_LOTURI) return eroare(429, "Prea multe loturi pentru un singur document.");

  const c = await citesteJson<{ paragrafe?: unknown }>(request);
  if (!c.ok) return c.raspuns;
  const lot: ParagrafText[] = [];
  let caractere = 0;
  for (const p of (Array.isArray(c.date.paragrafe) ? c.date.paragrafe : []) as { i?: unknown; text?: unknown }[]) {
    const i = Number(p?.i);
    const text = typeof p?.text === "string" ? p.text : "";
    if (!Number.isInteger(i) || i < 0 || !text) return eroare(400, "Paragraf invalid în lot.");
    caractere += text.length;
    lot.push({ i, text });
  }
  if (!lot.length) return eroare(400, "Lotul e gol.");
  if (lot.length > 2000 || caractere > LIMITA_LOT_SERVER) return eroare(413, "Lotul e prea mare.");

  try {
    const r = await corecteazaLot(env, corectare.model, lot);
    await adaugaLaCorectare(env.DB, corectare.id, { ...r, reusit: true });
    return json({ corecturi: r.corecturi });
  } catch (e) {
    if (e instanceof EroareCorectare) await adaugaLaCorectare(env.DB, corectare.id, { ...e.consum, reusit: false });
    const status = (e instanceof EroareGemini || e instanceof EroareZai) && e.status === 503 ? 503 : 502;
    return eroare(status, `Modelul nu a putut corecta lotul: ${(e as Error).message}`);
  }
};
