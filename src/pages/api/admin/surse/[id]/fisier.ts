// PUT    /api/admin/surse/:id/fisier — PDF-ul sursei, corp brut, streamat in R2.
// DELETE /api/admin/surse/:id/fisier — scoate PDF-ul.
//
// Antete la PUT: content-type: application/pdf, content-length, x-nume-fisier (URL-encoded).
// CSRF: application/pdf nu e tip "simplu" pentru CORS, deci un site strain nu poate trimite
// cererea fara preflight (pe care nu il acceptam); in plus verificam Sec-Fetch-Site.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { citesteSursa, seteazaFisierSursa } from "../../../../../lib/db";
import { cheieR2, curataPdf, numeFisierCurat, verificaUpload } from "../../../../../lib/fisiere";
import { scoateDinIndex } from "../../../../../lib/indexare";
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
  // PDF nou = document nou la Google; cel vechi (daca era) se scoate, iar clientul porneste indexarea.
  if (sursa.doc_google || sursa.indexare !== "neindexat") await scoateDinIndex(env, sursa);
  // Antetul %PDF trebuie sa fie primul octet; altfel Google nu poate indexa fisierul.
  const curat = await curataPdf(request.body, v.marime);
  await env.FISIERE.put(cheieR2("pdf", id), curat.corp, { httpMetadata: { contentType: v.tip } });
  const actualizata = await seteazaFisierSursa(env.DB, id, nume, curat.marime);
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
  await scoateDinIndex(env, sursa);
  await env.FISIERE.delete(cheieR2("pdf", id));
  await seteazaFisierSursa(env.DB, id, null, null);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
};
