// Orchestrarea indexarii: leaga R2 + D1 de Gemini. Rutele admin si upload-ul apeleaza doar
// de aici, ca regulile (magazin per catalog, stari, curatare) sa fie intr-un singur loc.

import { citesteCatalog, seteazaIndexare, seteazaMagazin, type Sursa } from "./db";
import { cheieR2, curataPdf } from "./fisiere";
import { creeazaMagazin, incarcaDocument, stareDocument, stergeDocument, EroareGemini } from "./gemini";
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
    // Fisierele incarcate inainte de curatare pot avea gunoi inaintea antetului %PDF.
    const curat = await curataPdf(obj.body, obj.size);
    const operatie = await incarcaDocument(cheie, magazin, curat.corp, curat.marime, obj.httpMetadata?.contentType ?? "application/pdf", {
      sursaId: sursa.id,
      titlu: sursa.titlu,
    });
    await seteazaIndexare(env.DB, sursa.id, { indexare: "in_curs", operatie_google: operatie });
  } catch (e) {
    await seteazaIndexare(env.DB, sursa.id, { indexare: "eroare", indexare_mesaj: (e as Error).message });
    throw e;
  }
}

// Citeste starea documentului la Google (operatia nu raporteaza esecul). Documentul are
// acelasi id ca operatia de import. La final scrie starea; la esec sterge documentul stricat.
export async function verificaIndexarea(env: Mediu, sursa: Sursa): Promise<{ indexare: Sursa["indexare"]; mesaj: string | null }> {
  if (sursa.indexare !== "in_curs" || !sursa.operatie_google) return { indexare: sursa.indexare, mesaj: sursa.indexare_mesaj };
  const catalog = await citesteCatalog(env.DB, sursa.catalog_id);
  const magazin = catalog?.magazin ?? "";
  const document = `${magazin}/documents/${sursa.operatie_google.split("/").pop()}`;
  const cheie = cheieGemini(env);
  const s = await stareDocument(cheie, document);
  if (s === "activ") {
    await seteazaIndexare(env.DB, sursa.id, { indexare: "gata", doc_google: document });
    return { indexare: "gata", mesaj: null };
  }
  if (s === "esuat") {
    const mesaj = "Google nu a putut procesa PDF-ul (fișier stricat sau scanat fără text). Încearcă „Reindexează” sau alt PDF.";
    try { await stergeDocument(cheie, document); } catch { /* ramane orfan, il vom curata la reindexare */ }
    await seteazaIndexare(env.DB, sursa.id, { indexare: "eroare", indexare_mesaj: mesaj });
    return { indexare: "eroare", mesaj };
  }
  return { indexare: "in_curs", mesaj: null };
}

// Scoate documentul de la Google (PDF sters sau inlocuit). Nu arunca daca nu exista cheie:
// R2 si D1 raman sursa adevarului, iar documentul orfan se poate curata mai tarziu.
export async function scoateDinIndex(env: Mediu, sursa: Sursa): Promise<void> {
  if (sursa.doc_google && env.GEMINI_API_KEY) {
    try { await stergeDocument(env.GEMINI_API_KEY, sursa.doc_google); } catch { /* se reincearca la reindexare */ }
  }
  await seteazaIndexare(env.DB, sursa.id, { indexare: "neindexat" });
}
