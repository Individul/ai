// POST /api/corector/{id}/verificare { paragrafe: [{i, text, fel}] }
// Tot documentul intr-o singura cerere (corp, antete, subsoluri, note): intoarce corecturile si
// observatiile care cer om. Ca si la lot, consumul se adauga la linia din jurnal chiar daca raspunsul
// nu se poate citi, fiindca s-a platit. O singura cerere pe corectare: de aceea `loturi` trebuie sa fie 0.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { adaugaLaCorectare, citesteCorectare } from "../../../../lib/consum";
import { EroareCorectare, verificaDocument } from "../../../../lib/motor";
import { citesteJson, eroare, json } from "../../../../lib/api";
import { EroareGemini } from "../../../../lib/gemini";
import { EroareZai } from "../../../../lib/zai";
import { EroareClaude } from "../../../../lib/claude";
import { bugetCaractere, LIMITA_VERIFICARE } from "../../../../lib/corector";
import { FELURI_PARTE, type FelParte, type ParagrafIntreg } from "../../../../lib/docx";

export const POST: APIRoute = async ({ params, request, locals }) => {
  const corectare = await citesteCorectare(env.DB, params.id ?? "");
  if (!corectare || corectare.email !== locals.email) return eroare(404, "Corectarea nu există.");
  if (corectare.stare !== "in_curs") return eroare(409, "Corectarea s-a încheiat deja.");
  if (corectare.mod !== "verificare") return eroare(409, "Corectarea asta e pe loturi, nu pe tot documentul.");
  if (corectare.loturi > 0) return eroare(429, "Verificarea s-a făcut deja pentru documentul ăsta.");

  const c = await citesteJson<{ paragrafe?: unknown }>(request);
  if (!c.ok) return c.raspuns;
  const paragrafe: ParagrafIntreg[] = [];
  let caractere = 0;
  for (const p of (Array.isArray(c.date.paragrafe) ? c.date.paragrafe : []) as { i?: unknown; text?: unknown; fel?: unknown }[]) {
    const i = Number(p?.i);
    const text = typeof p?.text === "string" ? p.text : "";
    const fel = FELURI_PARTE.find((f) => f === p?.fel);
    if (!Number.isInteger(i) || i < 0 || !text || !fel) return eroare(400, "Paragraf invalid în document.");
    caractere += text.length;
    paragrafe.push({ i, text, fel: fel as FelParte });
  }
  if (!paragrafe.length) return eroare(400, "Documentul e gol.");
  // 12.000 de paragrafe: un act de 100.000 de caractere plin de tabele are randuri scurte si multe.
  if (paragrafe.length > 12_000 || caractere > LIMITA_VERIFICARE) return eroare(413, "Documentul e prea mare pentru verificare.");
  if (corectare.caractere_trimise + caractere > bugetCaractere(corectare.caractere)) {
    return eroare(413, "Documentul a depășit textul declarat la pornire. Încarcă-l din nou.");
  }

  try {
    const r = await verificaDocument(env, corectare.model, paragrafe);
    await adaugaLaCorectare(env.DB, corectare.id, { ...r, caractere, reusit: true });
    return json({ corecturi: r.corecturi, observatii: r.observatii });
  } catch (e) {
    if (e instanceof EroareCorectare) await adaugaLaCorectare(env.DB, corectare.id, { ...e.consum, caractere, reusit: false });
    const status = (e instanceof EroareGemini || e instanceof EroareZai || e instanceof EroareClaude) && e.status === 503 ? 503 : 502;
    return eroare(status, `Modelul nu a putut verifica documentul: ${(e as Error).message}`);
  }
};
