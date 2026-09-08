// GET /f/audio/:id — un Audio Overview, din R2, cu Range (206) pentru <audio>.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { citesteAudio, citesteCatalog } from "../../../lib/db";
import { cheieR2, serveste } from "../../../lib/fisiere";

export const GET: APIRoute = async ({ params, request, url, locals }) => {
  const id = params.id ?? "";
  const audio = await citesteAudio(env.DB, id);
  if (!audio) return new Response(null, { status: 404 });
  const catalog = await citesteCatalog(env.DB, audio.catalog_id);
  if (!catalog || (catalog.stare === "arhivat" && !locals.admin)) return new Response(null, { status: 404 });
  const dispozitie = url.searchParams.get("descarca") ? "attachment" : "inline";
  const r = await serveste(env.FISIERE, cheieR2("audio", id), request, audio.fisier_nume, dispozitie);
  return r ?? new Response(null, { status: 404 });
};
