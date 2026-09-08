// POST /api/admin/surse/:id/indexeaza — trimite PDF-ul sursei la Gemini File Search.
// GET  /api/admin/surse/:id/indexeaza — starea indexarii (interogheaza operatia cand e in curs).
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { citesteSursa } from "../../../../../lib/db";
import { pornesteIndexarea, verificaIndexarea } from "../../../../../lib/indexare";
import { EroareGemini } from "../../../../../lib/gemini";
import { eroare, json } from "../../../../../lib/api";

const origineStraina = (request: Request) => {
  const s = request.headers.get("sec-fetch-site");
  return s !== null && s !== "same-origin" && s !== "none";
};

export const POST: APIRoute = async ({ params, request }) => {
  if (origineStraina(request)) return eroare(403, "Acces interzis.");
  const sursa = await citesteSursa(env.DB, params.id ?? "");
  if (!sursa) return eroare(404, "Sursa nu există.");
  if (!sursa.fisier_nume) return eroare(400, "Sursa nu are PDF de indexat.");
  try {
    await pornesteIndexarea(env, sursa);
  } catch (e) {
    const status = e instanceof EroareGemini ? e.status : 502;
    return eroare(status >= 400 && status < 600 ? status : 502, `Indexarea nu a pornit: ${(e as Error).message}`);
  }
  return json({ indexare: "in_curs" }, 202);
};

export const GET: APIRoute = async ({ params }) => {
  const sursa = await citesteSursa(env.DB, params.id ?? "");
  if (!sursa) return eroare(404, "Sursa nu există.");
  try {
    const s = await verificaIndexarea(env, sursa);
    return json({ indexare: s.indexare, mesaj: s.mesaj });
  } catch (e) {
    return eroare(502, `Nu pot verifica indexarea: ${(e as Error).message}`);
  }
};
