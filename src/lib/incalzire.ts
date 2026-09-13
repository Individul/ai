// Incalzirea cache-ului DeepSeek: dimineata, inaintea orelor de varf, o cerere minima cu tot
// contextul culegerii, ca prima intrebare a colegilor sa gaseasca documentele in cache (intrarea
// la 0,003 $ per M in loc de 0,15 $, si fara dublarea de la orele de varf pe partea de documente).
//
// Are sens doar cand motorul activ e DeepSeek (cache pe prefix) si cand culegerea incape integral
// in buget (in modul "filtrat" prefixul depinde de intrebare, deci cache-ul nu ajuta). Cererea se
// scrie in jurnal pe emailul EMAIL_SISTEM, ca sa apara la cost in Admin, dar nu conteaza la nicio
// limita. Culegerile de incalzit stau in setari.incalzire, id-uri separate prin virgula.

import { citesteCatalog } from "./db";
import { citesteBuget, citesteSetare, inregistreazaIntrebare } from "./consum";
import { raspunde, type ApelZai, type Mediu } from "./motor";
import { intreabaZai } from "./zai";
import { aziChisinau } from "./data";
import { esteModel, motorModel } from "./validare";

export const EMAIL_SISTEM = "sistem@incalzire";
export const INTREBARE_INCALZIRE = "Confirmă într-un singur cuvânt că ai primit documentele.";

export function listaIncalzire(valoare: string): string[] {
  return valoare.split(",").map((s) => s.trim()).filter(Boolean);
}

export type RezultatIncalzire =
  | { catalog: string; stare: "sarit"; motiv: string }
  | { catalog: string; stare: "ok"; mod: string; tokens_intrare: number; tokens_cache: number; cost_microdolari: number; durata_ms: number }
  | { catalog: string; stare: "eroare"; mesaj: string };

// Incalzeste o culegere. `apel` se poate inlocui in teste.
export async function incalzeste(env: Mediu, catalogId: string, apel: ApelZai = intreabaZai): Promise<RezultatIncalzire> {
  const catalog = await citesteCatalog(env.DB, catalogId);
  if (!catalog || catalog.stare === "arhivat") return { catalog: catalogId, stare: "sarit", motiv: "culegerea nu există sau e arhivată" };
  let model = await citesteSetare(env.DB, "model");
  if (!esteModel(model)) model = "gemini-3.5-flash-lite";
  if (motorModel(model) !== "deepseek") return { catalog: catalogId, stare: "sarit", motiv: `motorul activ (${model}) nu are cache pe prefix` };
  if (!env.DEEPSEEK_API_KEY) return { catalog: catalogId, stare: "sarit", motiv: "cheia DeepSeek lipsește" };

  const buget = await citesteBuget(env.DB);
  const zi = aziChisinau();
  const start = Date.now();
  try {
    const r = await raspunde(env, { model, catalog, istoric: [], intrebare: INTREBARE_INCALZIRE, buget }, apel);
    const durata_ms = Date.now() - start;
    await inregistreazaIntrebare(env.DB, {
      email: EMAIL_SISTEM, catalog_id: catalog.id, zi, intrebare: `[încălzire] ${INTREBARE_INCALZIRE}`, raspuns: r.text, citari: [],
      model, tokens_intrare: r.tokens_intrare, tokens_iesire: r.tokens_iesire, cost_microdolari: r.cost_microdolari, credite: r.credite,
      stare: "ok", durata_ms,
    });
    return { catalog: catalogId, stare: "ok", mod: r.mod, tokens_intrare: r.tokens_intrare, tokens_cache: r.tokens_cache, cost_microdolari: r.cost_microdolari, durata_ms };
  } catch (e) {
    const mesaj = (e as Error).message;
    await inregistreazaIntrebare(env.DB, {
      email: EMAIL_SISTEM, catalog_id: catalog.id, zi, intrebare: `[încălzire] ${INTREBARE_INCALZIRE}`, raspuns: `[eroare] ${mesaj}`, citari: [],
      model, tokens_intrare: 0, tokens_iesire: 0, cost_microdolari: 0, credite: 0, stare: "eroare", durata_ms: Date.now() - start,
    });
    return { catalog: catalogId, stare: "eroare", mesaj };
  }
}

// Toate culegerile din setari.incalzire, pe rand (cererile sunt mari; nu le trimitem deodata).
export async function incalzesteToate(env: Mediu, apel: ApelZai = intreabaZai): Promise<RezultatIncalzire[]> {
  const ids = listaIncalzire(await citesteSetare(env.DB, "incalzire"));
  const rezultate: RezultatIncalzire[] = [];
  for (const id of ids) rezultate.push(await incalzeste(env, id, apel));
  return rezultate;
}
