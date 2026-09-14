// POST /api/corector { fisier, caractere }
// Porneste corectarea unui document Word: verifica modelul corectorului si cheia lui, scrie linia din
// jurnal (stare in_curs) si intoarce id-ul. Documentul nu vine aici: browserul il desface, trimite
// textul pe loturi la /api/corector/{id}/lot si incheie cu /api/corector/{id}/gata.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { creeazaCorectare, modelCorector } from "../../../lib/consum";
import { cheieMotor } from "../../../lib/motor";
import { citesteJson, eroare, json } from "../../../lib/api";
import { aziChisinau } from "../../../lib/data";
import { LIMITA_DOCUMENT } from "../../../lib/corector";
import { motorModel } from "../../../lib/validare";

interface Corp {
  fisier?: string;
  caractere?: number;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const c = await citesteJson<Corp>(request);
  if (!c.ok) return c.raspuns;
  const fisier = String(c.date.fisier ?? "").trim().slice(0, 200);
  const caractere = Number(c.date.caractere);
  if (!fisier) return eroare(400, "Lipsește numele documentului.");
  if (!Number.isInteger(caractere) || caractere <= 0) return eroare(400, "Documentul nu are text de corectat.");
  if (caractere > LIMITA_DOCUMENT) return eroare(413, "Documentul are peste 400.000 de caractere. Împarte-l în părți mai mici.");
  const model = await modelCorector(env.DB);
  if (!cheieMotor(env, motorModel(model) ?? "gemini")) return eroare(503, "Corectorul nu este configurat încă pe server.");
  const r = await creeazaCorectare(env.DB, { email: locals.email, zi: aziChisinau(), fisier, caractere, model });
  return json({ id: r.id, model });
};
