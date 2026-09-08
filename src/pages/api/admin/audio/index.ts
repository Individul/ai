// PUT /api/admin/audio?catalog=<id> — un Audio Overview nou: corpul brut merge in R2 sub
// audio/{id}, apoi se scrie randul. Daca randul nu se poate scrie, obiectul se sterge.
//
// Antete: content-type: audio/*, content-length, x-nume-fisier, x-titlu, x-descriere, x-data,
// x-durata (toate URL-encoded, ca sa treaca diacriticele prin antete).
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { adaugaAudio, citesteCatalog } from "../../../../lib/db";
import { cheieR2, numeFisierCurat, verificaUpload } from "../../../../lib/fisiere";
import { valideazaAudio } from "../../../../lib/validare";
import { eroare, json } from "../../../../lib/api";

const decod = (s: string | null) => {
  try { return decodeURIComponent(s ?? ""); } catch { return ""; }
};

export const PUT: APIRoute = async ({ request, url }) => {
  const origine = request.headers.get("sec-fetch-site");
  if (origine !== null && origine !== "same-origin" && origine !== "none") return eroare(403, "Acces interzis.");

  const catalogId = url.searchParams.get("catalog") ?? "";
  const catalog = await citesteCatalog(env.DB, catalogId);
  if (!catalog) return eroare(404, "Catalogul nu există.");

  const v = verificaUpload("audio", request);
  if (!v.ok) return eroare(v.status, v.mesaj);
  if (!request.body) return eroare(400, "Cererea nu are corp.");

  const meta = valideazaAudio({
    titlu: decod(request.headers.get("x-titlu")),
    descriere: decod(request.headers.get("x-descriere")),
    data: decod(request.headers.get("x-data")),
    durata_s: decod(request.headers.get("x-durata")),
  });
  if (!meta.ok) return eroare(400, meta.eroare);

  const id = crypto.randomUUID();
  const cheie = cheieR2("audio", id);
  const nume = numeFisierCurat(request.headers.get("x-nume-fisier"), `${meta.date.titlu}.mp3`);
  await env.FISIERE.put(cheie, request.body, { httpMetadata: { contentType: v.tip } });
  try {
    const audio = await adaugaAudio(env.DB, id, catalogId, meta.date, { tip_mime: v.tip, fisier_nume: nume, marime: v.marime });
    return json({ audio }, 201);
  } catch (e) {
    await env.FISIERE.delete(cheie);
    return eroare(500, `Nu am putut salva înregistrarea: ${(e as Error).message}`);
  }
};
