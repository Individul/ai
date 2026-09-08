// Motorul chatului: modelul ales in Admin decide daca intrebarea merge la Gemini File Search
// sau la Z.AI (GLM) cu textul extras din R2. Rutele si paginile vorbesc doar cu acest modul;
// clientii (gemini.ts, zai.ts) nu se apeleaza direct.

import { listeazaSurse, type Catalog, type Sursa } from "./db";
import type { Citare } from "./consum";
import { costMicrodolari, intreaba, EroareGemini, type Schimb } from "./gemini";
import { BAZA_ZAI, crediteZai, EroareZai, intreabaZai } from "./zai";
import { construiesteContext, extrageCitariText, type SursaText } from "./context";
import { citesteText } from "./text";
import { motorModel, type Motor } from "./validare";

export interface Mediu {
  DB: D1Database;
  FISIERE: R2Bucket;
  GEMINI_API_KEY?: string;
  ZAI_API_KEY?: string;
  ZAI_API_BASE?: string;
}

export interface Intrebare {
  model: string;
  catalog: Catalog;
  istoric: Schimb[];
  intrebare: string;
  buget: number;        // caractere de context pentru Z.AI; Gemini il ignora
}

export interface Rezultat {
  text: string;
  citari: Citare[];
  tokens_intrare: number;   // total, include tokens_cache
  tokens_cache: number;
  tokens_iesire: number;
  cost_microdolari: number; // la tariful public al modelului (orientativ pe planul de coding)
  credite: number;          // creditele planului Z.AI; 0 la Gemini
  mod: "gemini" | "integral" | "filtrat";
}

export type ApelZai = typeof intreabaZai;

// Cate surse poate citi motorul dat: Gemini cere document indexat (si magazin pe catalog),
// Z.AI cere text extras nevid (PDF-urile scanate au 0 caractere).
export function disponibilePentruChat(
  motor: Motor, magazin: string | null, surse: Pick<Sursa, "indexare" | "text_caractere">[]
): number {
  if (motor === "zai") return surse.filter((s) => (s.text_caractere ?? 0) > 0).length;
  if (!magazin) return 0;
  return surse.filter((s) => s.indexare === "gata").length;
}

// `apelZai` se injecteaza doar in teste (fara retea).
export async function raspunde(env: Mediu, i: Intrebare, apelZai: ApelZai = intreabaZai): Promise<Rezultat> {
  if (motorModel(i.model) === "zai") return raspundeZai(env, i, apelZai);
  if (!env.GEMINI_API_KEY) throw new EroareGemini(503, "Cheia Gemini nu este configurată pe server.");
  if (!i.catalog.magazin) throw new EroareGemini(409, "Culegerea nu are încă documente indexate.");
  const r = await intreaba(env.GEMINI_API_KEY, { model: i.model, magazin: i.catalog.magazin, istoric: i.istoric, intrebare: i.intrebare });
  return {
    text: r.text, citari: r.citari, tokens_intrare: r.tokens_intrare, tokens_cache: 0, tokens_iesire: r.tokens_iesire,
    cost_microdolari: costMicrodolari(i.model, r.tokens_intrare, r.tokens_iesire), credite: 0, mod: "gemini",
  };
}

// Textele surselor din R2 -> context (integral sau filtrat) -> GLM. La "Prompt exceeds max length"
// (3 M caractere pot depasi 1 M tokeni) reincearca o singura data cu bugetul injumatatit.
async function raspundeZai(env: Mediu, i: Intrebare, apel: ApelZai): Promise<Rezultat> {
  if (!env.ZAI_API_KEY) throw new EroareZai(503, "Cheia Z.AI nu este configurată pe server.");
  const surse = (await listeazaSurse(env.DB, i.catalog.id)).filter((s) => (s.text_caractere ?? 0) > 0);
  const texte: SursaText[] = await Promise.all(
    surse.map(async (s) => ({ id: s.id, titlu: s.titlu, pagini: (await citesteText(env.FISIERE, s.id)) ?? [] }))
  );
  const baza = env.ZAI_API_BASE || BAZA_ZAI;
  let buget = i.buget;
  for (let incercare = 0; ; incercare++) {
    const ctx = construiesteContext(texte, i.intrebare, buget);
    try {
      const r = await apel(env.ZAI_API_KEY, baza, { model: i.model, context: ctx.text, istoric: i.istoric, intrebare: i.intrebare });
      return {
        text: r.text, citari: extrageCitariText(r.text, surse),
        tokens_intrare: r.tokens_intrare, tokens_cache: r.tokens_cache, tokens_iesire: r.tokens_iesire,
        cost_microdolari: costMicrodolari(i.model, r.tokens_intrare, r.tokens_iesire),
        credite: crediteZai(i.model, r.tokens_intrare, r.tokens_cache, r.tokens_iesire),
        mod: ctx.mod,
      };
    } catch (e) {
      if (incercare === 0 && e instanceof EroareZai && e.contextPreaLung) { buget = Math.floor(buget / 2); continue; }
      throw e;
    }
  }
}
