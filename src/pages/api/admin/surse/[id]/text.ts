// PUT /api/admin/surse/:id/text — textul extras in browser din PDF-ul sursei, JSON { pagini: [{pagina, text}] }.
// Obiectul text/{id} se scrie in R2 inaintea contoarelor din D1. Nu exista DELETE: textul pleaca odata cu PDF-ul.
//
// JSON-ul trece prin request.json(): sunt cativa MB de text, nu un fisier binar (regula "fara arrayBuffer"
// e pentru PDF si audio). CSRF: application/json cere preflight, iar Sec-Fetch-Site e verificat.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { citesteSursa, seteazaText } from "../../../../../lib/db";
import { scrieText, valideazaPagini } from "../../../../../lib/text";
import { citesteJson, eroare, json } from "../../../../../lib/api";

const origineStraina = (request: Request) => {
  const s = request.headers.get("sec-fetch-site");
  return s !== null && s !== "same-origin" && s !== "none";
};

export const PUT: APIRoute = async ({ params, request }) => {
  if (origineStraina(request)) return eroare(403, "Acces interzis.");
  const id = params.id ?? "";
  const sursa = await citesteSursa(env.DB, id);
  if (!sursa) return eroare(404, "Sursa nu există.");
  if (!sursa.fisier_nume) return eroare(400, "Sursa nu are PDF; textul nu are de unde veni.");
  const c = await citesteJson<unknown>(request);
  if (!c.ok) return c.raspuns;
  const v = valideazaPagini(c.date);
  if (!v.ok) return eroare(400, v.eroare);
  await scrieText(env.FISIERE, id, v.pagini);
  await seteazaText(env.DB, id, { pagini: v.pagini.length, caractere: v.caractere });
  return json({ pagini: v.pagini.length, caractere: v.caractere });
};

export const ALL: APIRoute = () => eroare(405, "Doar PUT.");
