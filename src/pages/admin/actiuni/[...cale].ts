// POST /admin/actiuni/* — toate actiunile din formularele de admin. Fara JavaScript:
// formular clasic, validare, apoi 303 inapoi la pagina de editare cu ?ok=1 sau ?eroare=...
//
// Poarta de admin e in middleware (403 pentru non-admin). Sec-Fetch-Site protejeaza de
// formulare de pe alte site-uri (pe langa verificarea de Origin a lui Astro).
//
//   catalog                    creeaza
//   catalog/:id                actualizeaza (CAS pe `baza`)
//   catalog/:id/stare          seteaza stare (arhiveaza / dezarhiveaza)
//   catalog/:id/muta?dir=sus|jos
//   sursa                      adauga (catalog_id in formular)
//   sursa/:id                  actualizeaza
//   sursa/:id/sterge           sterge (intai obiectul R2, apoi randul)
//   sursa/:id/muta?dir=sus|jos
//   audio/:id                  actualizeaza metadatele
//   audio/:id/sterge
//   audio/:id/muta?dir=sus|jos
//   utilizator/:email          limita_zi, blocat, nota (pagina /admin/consum)
//   setari                     limita_zi_implicita, model, buget_context
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  actualizeazaAudio, actualizeazaCatalog, actualizeazaSursa, adaugaSursa, citesteAudio, citesteCatalog, citesteSursa,
  creeazaCatalog, mutaAudio, mutaCatalog, mutaSursa, seteazaStareCatalog, stergeAudio, stergeSursa,
} from "../../../lib/db";
import { cheieR2 } from "../../../lib/fisiere";
import { scoateDinIndex } from "../../../lib/indexare";
import { stergeText } from "../../../lib/text";
import {
  LIMITA_BUGET_MAX, LIMITA_BUGET_MIN, esteModel, esteStare, slug, valideazaAudio, valideazaCatalog, valideazaSursa,
} from "../../../lib/validare";
import { seteazaSetare, seteazaUtilizator } from "../../../lib/consum";

const text = (s: string, status: number, extra: Record<string, string> = {}) =>
  new Response(`${s}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8", ...extra } });

type Campuri = Record<string, string | undefined>;

async function campuri(request: Request): Promise<Campuri> {
  const f: Campuri = {};
  for (const [k, v] of await request.formData()) if (typeof v === "string") f[k] = v;
  return f;
}

const laCatalog = (id: string, rezultat: { ok: true } | { eroare: string }) =>
  `/admin/cataloage/${id}?` + ("eroare" in rezultat ? `eroare=${encodeURIComponent(rezultat.eroare)}` : "ok=1");

const directie = (url: URL): -1 | 1 | null => {
  const d = url.searchParams.get("dir");
  return d === "sus" ? -1 : d === "jos" ? 1 : null;
};

export const POST: APIRoute = async ({ params, request, url, redirect }) => {
  const origine = request.headers.get("sec-fetch-site");
  if (origine !== "same-origin" && origine !== "none") return text("Acces interzis.", 403);

  const [fel = "", id = "", actiune = ""] = (params.cale ?? "").split("/");
  const f = await campuri(request);

  // ---------------------------------------------------------------- catalog
  if (fel === "catalog") {
    if (!id) {
      const v = valideazaCatalog(f);
      if (!v.ok) return redirect(`/admin/cataloage/nou?eroare=${encodeURIComponent(v.eroare)}`, 303);
      const c = await creeazaCatalog(env.DB, slug(v.date.titlu), v.date);
      return redirect(laCatalog(c.id, { ok: true }), 303);
    }
    const catalog = await citesteCatalog(env.DB, id);
    if (!catalog) return text("Catalogul nu există.", 404);

    if (actiune === "") {
      const v = valideazaCatalog(f);
      if (!v.ok) return redirect(laCatalog(id, { eroare: v.eroare }), 303);
      const r = await actualizeazaCatalog(env.DB, id, v.date, f.baza ?? "");
      if (!r.ok && r.motiv === "conflict") {
        return redirect(laCatalog(id, { eroare: "Catalogul a fost modificat între timp în altă parte. Reîncarcă pagina și reia modificările." }), 303);
      }
      if (!r.ok) return text("Catalogul nu există.", 404);
      return redirect(laCatalog(id, { ok: true }), 303);
    }
    if (actiune === "stare") {
      const stare = f.stare ?? "";
      if (!esteStare(stare)) return redirect(laCatalog(id, { eroare: "Stare necunoscută." }), 303);
      await seteazaStareCatalog(env.DB, id, stare);
      return redirect(laCatalog(id, { ok: true }), 303);
    }
    if (actiune === "muta") {
      const dir = directie(url);
      if (dir) await mutaCatalog(env.DB, id, dir);
      return redirect("/admin", 303);
    }
    return text("Acțiune necunoscută.", 404);
  }

  // ---------------------------------------------------------------- sursa
  if (fel === "sursa") {
    if (!id) {
      const catalogId = f.catalog_id ?? "";
      const catalog = await citesteCatalog(env.DB, catalogId);
      if (!catalog) return text("Catalogul nu există.", 404);
      const v = valideazaSursa(f);
      if (!v.ok) return redirect(laCatalog(catalogId, { eroare: v.eroare }), 303);
      await adaugaSursa(env.DB, catalogId, v.date);
      return redirect(laCatalog(catalogId, { ok: true }) + "#surse", 303);
    }
    const sursa = await citesteSursa(env.DB, id);
    if (!sursa) return text("Sursa nu există.", 404);
    const inapoi = (r: { ok: true } | { eroare: string }) => redirect(laCatalog(sursa.catalog_id, r) + "#surse", 303);

    if (actiune === "") {
      const v = valideazaSursa(f);
      if (!v.ok) return inapoi({ eroare: v.eroare });
      await actualizeazaSursa(env.DB, id, v.date);
      return inapoi({ ok: true });
    }
    if (actiune === "sterge") {
      if (sursa.doc_google) await scoateDinIndex(env, sursa);
      if (sursa.text_caractere !== null) await stergeText(env.FISIERE, id);
      if (sursa.fisier_nume) await env.FISIERE.delete(cheieR2("pdf", id));
      await stergeSursa(env.DB, id);
      return inapoi({ ok: true });
    }
    if (actiune === "muta") {
      const dir = directie(url);
      if (dir) await mutaSursa(env.DB, id, dir);
      return inapoi({ ok: true });
    }
    return text("Acțiune necunoscută.", 404);
  }

  // ---------------------------------------------------------------- audio
  if (fel === "audio" && id) {
    const audio = await citesteAudio(env.DB, id);
    if (!audio) return text("Audio-ul nu există.", 404);
    const inapoi = (r: { ok: true } | { eroare: string }) => redirect(laCatalog(audio.catalog_id, r) + "#audio", 303);

    if (actiune === "") {
      const v = valideazaAudio(f);
      if (!v.ok) return inapoi({ eroare: v.eroare });
      await actualizeazaAudio(env.DB, id, v.date);
      return inapoi({ ok: true });
    }
    if (actiune === "sterge") {
      await env.FISIERE.delete(cheieR2("audio", id));
      await stergeAudio(env.DB, id);
      return inapoi({ ok: true });
    }
    if (actiune === "muta") {
      const dir = directie(url);
      if (dir) await mutaAudio(env.DB, id, dir);
      return inapoi({ ok: true });
    }
    return text("Acțiune necunoscută.", 404);
  }

  // ---------------------------------------------------------------- consum
  if (fel === "utilizator" && id) {
    const email = decodeURIComponent(id).trim().toLowerCase();
    const laConsum = (r: { ok: true } | { eroare: string }) =>
      redirect("/admin/consum?" + ("eroare" in r ? `eroare=${encodeURIComponent(r.eroare)}` : "ok=1"), 303);
    if (!email.includes("@")) return laConsum({ eroare: "Adresă de e-mail invalidă." });
    const brut = (f.limita_zi ?? "").trim();
    const limita_zi = brut === "" ? null : Number(brut);
    if (limita_zi !== null && (!Number.isInteger(limita_zi) || limita_zi < 0 || limita_zi > 10_000)) {
      return laConsum({ eroare: "Limita trebuie să fie un număr întreg (sau gol = implicit)." });
    }
    await seteazaUtilizator(env.DB, email, { limita_zi, blocat: f.blocat === "1", nota: (f.nota ?? "").trim() || null });
    return laConsum({ ok: true });
  }

  if (fel === "setari") {
    const laConsum = (r: { ok: true } | { eroare: string }) =>
      redirect("/admin/consum?" + ("eroare" in r ? `eroare=${encodeURIComponent(r.eroare)}` : "ok=1"), 303);
    const limita = Number((f.limita_zi_implicita ?? "").trim());
    if (!Number.isInteger(limita) || limita < 0 || limita > 10_000) return laConsum({ eroare: "Limita implicită trebuie să fie un număr întreg." });
    const model = (f.model ?? "").trim();
    if (!esteModel(model)) return laConsum({ eroare: "Model necunoscut." });
    const buget = Number((f.buget_context ?? "").replace(/[.\s]/g, ""));
    if (!Number.isInteger(buget) || buget < LIMITA_BUGET_MIN || buget > LIMITA_BUGET_MAX) {
      return laConsum({ eroare: `Bugetul de context trebuie să fie între ${LIMITA_BUGET_MIN} și ${LIMITA_BUGET_MAX} de caractere.` });
    }
    await seteazaSetare(env.DB, "limita_zi_implicita", String(limita));
    await seteazaSetare(env.DB, "model", model);
    await seteazaSetare(env.DB, "buget_context", String(buget));
    return laConsum({ ok: true });
  }

  return text("Acțiune necunoscută.", 404);
};

export const ALL: APIRoute = () => text("Doar POST.", 405, { allow: "POST" });
