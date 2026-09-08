// Orchestrarea indexarii: leaga R2 + D1 de Gemini. Rutele admin si upload-ul apeleaza doar
// de aici, ca regulile (magazin per catalog, stari, curatare) sa fie intr-un singur loc.

import { citesteCatalog, seteazaIndexare, seteazaMagazin, type Sursa } from "./db";
import { cheieR2 } from "./fisiere";
import { creeazaMagazin, incarcaDocument, stareOperatie, stergeDocument, EroareGemini } from "./gemini";
import { slug } from "./validare";

export interface Mediu {
  DB: D1Database;
  FISIERE: R2Bucket;
  GEMINI_API_KEY?: string;
}

export function cheieGemini(env: Mediu): string {
  if (!env.GEMINI_API_KEY) throw new EroareGemini(503, "Cheia Gemini nu este configurată pe server.");
  return env.GEMINI_API_KEY;
}

// Magazinul catalogului, creat la prima nevoie.
export async function magazinPentru(env: Mediu, catalogId: string): Promise<string> {
  const catalog = await citesteCatalog(env.DB, catalogId);
  if (!catalog) throw new Error("catalogul nu există");
  if (catalog.magazin) return catalog.magazin;
  const magazin = await creeazaMagazin(cheieGemini(env), `cataloage-${slug(catalog.titlu)}`.slice(0, 100));
  await seteazaMagazin(env.DB, catalogId, magazin);
  return magazin;
}

// Trimite PDF-ul sursei la Google. Sursa trece in `in_curs`; se termina cu verificaIndexarea.
export async function pornesteIndexarea(env: Mediu, sursa: Sursa): Promise<void> {
  if (!sursa.fisier_nume) throw new Error("sursa nu are PDF");
  const cheie = cheieGemini(env);
  if (sursa.doc_google) await stergeDocument(cheie, sursa.doc_google);
  const magazin = await magazinPentru(env, sursa.catalog_id);
  const obj = await env.FISIERE.get(cheieR2("pdf", sursa.id));
  if (!obj) throw new Error("PDF-ul lipsește din stocare");
  try {
    const operatie = await incarcaDocument(cheie, magazin, obj.body, obj.size, obj.httpMetadata?.contentType ?? "application/pdf", {
      sursaId: sursa.id,
      titlu: sursa.titlu,
    });
    await seteazaIndexare(env.DB, sursa.id, { indexare: "in_curs", operatie_google: operatie });
  } catch (e) {
    await seteazaIndexare(env.DB, sursa.id, { indexare: "eroare", indexare_mesaj: (e as Error).message });
    throw e;
  }
}

// Interogheaza operatia; la final scrie starea. Intoarce starea curenta a sursei.
export async function verificaIndexarea(env: Mediu, sursa: Sursa): Promise<{ indexare: Sursa["indexare"]; mesaj: string | null }> {
  if (sursa.indexare !== "in_curs" || !sursa.operatie_google) return { indexare: sursa.indexare, mesaj: sursa.indexare_mesaj };
  const catalog = await citesteCatalog(env.DB, sursa.catalog_id);
  const magazin = catalog?.magazin ?? "";
  const s = await stareOperatie(cheieGemini(env), magazin, sursa.operatie_google);
  if (!s.done) return { indexare: "in_curs", mesaj: null };
  if ("eroare" in s) {
    await seteazaIndexare(env.DB, sursa.id, { indexare: "eroare", indexare_mesaj: s.eroare });
    return { indexare: "eroare", mesaj: s.eroare };
  }
  await seteazaIndexare(env.DB, sursa.id, { indexare: "gata", doc_google: s.document });
  return { indexare: "gata", mesaj: null };
}

// Scoate documentul de la Google (PDF sters sau inlocuit). Nu arunca daca nu exista cheie:
// R2 si D1 raman sursa adevarului, iar documentul orfan se poate curata mai tarziu.
export async function scoateDinIndex(env: Mediu, sursa: Sursa): Promise<void> {
  if (sursa.doc_google && env.GEMINI_API_KEY) {
    try { await stergeDocument(env.GEMINI_API_KEY, sursa.doc_google); } catch { /* se reincearca la reindexare */ }
  }
  await seteazaIndexare(env.DB, sursa.id, { indexare: "neindexat" });
}
