// GET /f/pdf/:id — PDF-ul unei surse, din R2. ?descarca=1 -> attachment.
// Identitatea e verificata in middleware; aici doar existenta si arhivarea.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { citesteCatalog, citesteSursa } from "../../../lib/db";
import { cheieR2, serveste } from "../../../lib/fisiere";

export const GET: APIRoute = async ({ params, request, url, locals }) => {
  const id = params.id ?? "";
  const sursa = await citesteSursa(env.DB, id);
  if (!sursa || !sursa.fisier_nume) return new Response(null, { status: 404 });
  const catalog = await citesteCatalog(env.DB, sursa.catalog_id);
  if (!catalog || (catalog.stare === "arhivat" && !locals.admin)) return new Response(null, { status: 404 });
  const dispozitie = url.searchParams.get("descarca") ? "attachment" : "inline";
  const r = await serveste(env.FISIERE, cheieR2("pdf", id), request, sursa.fisier_nume, dispozitie);
  return r ?? new Response(null, { status: 404 });
};
