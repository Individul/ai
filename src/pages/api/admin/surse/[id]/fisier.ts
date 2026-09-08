// PUT    /api/admin/surse/:id/fisier — PDF-ul sursei, corp brut, streamat in R2.
// DELETE /api/admin/surse/:id/fisier — scoate PDF-ul.
//
// Antete la PUT: content-type: application/pdf, content-length, x-nume-fisier (URL-encoded).
// CSRF: application/pdf nu e tip "simplu" pentru CORS, deci un site strain nu poate trimite
// cererea fara preflight (pe care nu il acceptam); in plus verificam Sec-Fetch-Site.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { citesteSursa, seteazaFisierSursa } from "../../../../../lib/db";
import { cheieR2, numeFisierCurat, verificaUpload } from "../../../../../lib/fisiere";
import { eroare, json } from "../../../../../lib/api";

const origineStraina = (request: Request) => {
  const s = request.headers.get("sec-fetch-site");
  return s !== null && s !== "same-origin" && s !== "none";
};

export const PUT: APIRoute = async ({ params, request }) => {
  if (origineStraina(request)) return eroare(403, "Acces interzis.");
  const id = params.id ?? "";
  const sursa = await citesteSursa(env.DB, id);
  if (!sursa) return eroare(404, "Sursa nu există.");
  const v = verificaUpload("pdf", request);
  if (!v.ok) return eroare(v.status, v.mesaj);
  if (!request.body) return eroare(400, "Cererea nu are corp.");

  const nume = numeFisierCurat(request.headers.get("x-nume-fisier"), `${sursa.titlu}.pdf`);
  await env.FISIERE.put(cheieR2("pdf", id), request.body, { httpMetadata: { contentType: v.tip } });
  const actualizata = await seteazaFisierSursa(env.DB, id, nume, v.marime);
  if (!actualizata) {
    await env.FISIERE.delete(cheieR2("pdf", id));
    return eroare(404, "Sursa a dispărut între timp.");
  }
  return json({ sursa: actualizata });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  if (origineStraina(request)) return eroare(403, "Acces interzis.");
  const id = params.id ?? "";
  const sursa = await citesteSursa(env.DB, id);
  if (!sursa) return eroare(404, "Sursa nu există.");
  await env.FISIERE.delete(cheieR2("pdf", id));
  await seteazaFisierSursa(env.DB, id, null, null);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
};
