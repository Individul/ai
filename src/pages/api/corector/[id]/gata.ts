// POST /api/corector/{id}/gata { stare: "ok" | "eroare", corecturi, aplicate, observatii?, mesaj? }
// Incheie corectarea in jurnal, o singura data: cate corecturi a propus modelul, cate au intrat in
// document si, daca e cazul, ce n-a mers (loturi picate, document care nu s-a putut construi).
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { citesteCorectare, incheieCorectare } from "../../../../lib/consum";
import { citesteJson, eroare, json } from "../../../../lib/api";

interface Corp {
  stare?: string;
  corecturi?: number;
  aplicate?: number;
  observatii?: number;
  mesaj?: string;
}

const numar = (x: unknown) => {
  const n = Number(x);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, 1_000_000) : 0;
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  const corectare = await citesteCorectare(env.DB, params.id ?? "");
  if (!corectare || corectare.email !== locals.email) return eroare(404, "Corectarea nu există.");
  const c = await citesteJson<Corp>(request);
  if (!c.ok) return c.raspuns;
  const mesaj = typeof c.date.mesaj === "string" && c.date.mesaj.trim() ? c.date.mesaj.trim().slice(0, 500) : null;
  const incheiata = await incheieCorectare(env.DB, corectare.id, {
    stare: c.date.stare === "eroare" ? "eroare" : "ok",
    corecturi: numar(c.date.corecturi),
    aplicate: numar(c.date.aplicate),
    observatii: numar(c.date.observatii),
    mesaj,
    durata_ms: Math.max(0, Date.now() - Date.parse(corectare.creat_la)),
  });
  if (!incheiata) return eroare(409, "Corectarea s-a încheiat deja.");
  return json({ ok: true });
};
