// Textul extras din PDF-ul unei surse, pentru motorul Z.AI (GLM), care nu are File Search.
// Se extrage in browser (pdf.js, la upload sau la "extrage textul") si sta in R2 sub text/{sursa.id}
// ca JSON [{pagina, text}]; D1 tine doar contoarele (surse.text_pagini, text_caractere).
// Regula R2 -> D1 ramane: obiectul se scrie inaintea contoarelor si se sterge inaintea lor.

export interface Pagina {
  pagina: number;   // numarul paginii din PDF, de la 1; deschide /f/pdf/{id}#page=N
  text: string;
}

export const LIMITA_PAGINI = 5_000;
export const LIMITA_TEXT = 10_000_000;   // caractere, pe o sursa

export function cheieText(id: string): string {
  return `text/${id}`;
}

export type PaginiValidate =
  | { ok: true; pagini: Pagina[]; caractere: number }
  | { ok: false; eroare: string };

// JSON-ul trimis de browser: { pagini: [{pagina, text}] }, pagini strict crescatoare de la 1.
// Paginile fara text (scanate) se sar; lista goala e valida si inseamna "PDF fara strat de text".
export function valideazaPagini(json: unknown): PaginiValidate {
  const brut = (json as { pagini?: unknown } | null)?.pagini;
  if (!json || typeof json !== "object" || !Array.isArray(brut)) return { ok: false, eroare: "Lipsește lista de pagini." };
  if (brut.length > LIMITA_PAGINI) return { ok: false, eroare: `Peste ${LIMITA_PAGINI} de pagini.` };
  const pagini: Pagina[] = [];
  let caractere = 0;
  let ultima = 0;
  for (const p of brut as { pagina?: unknown; text?: unknown }[]) {
    const nr = p?.pagina;
    if (!Number.isInteger(nr) || (nr as number) < 1) return { ok: false, eroare: "Număr de pagină invalid." };
    if ((nr as number) <= ultima) return { ok: false, eroare: "Paginile trebuie să fie în ordine crescătoare, fără repetări." };
    ultima = nr as number;
    if (typeof p.text !== "string") return { ok: false, eroare: "Textul paginii lipsește." };
    const text = p.text.trim();
    if (!text) continue;
    caractere += text.length;
    if (caractere > LIMITA_TEXT) return { ok: false, eroare: "Textul depășește limita pe sursă." };
    pagini.push({ pagina: ultima, text });
  }
  return { ok: true, pagini, caractere };
}

export async function scrieText(bucket: R2Bucket, id: string, pagini: Pagina[]): Promise<void> {
  await bucket.put(cheieText(id), JSON.stringify(pagini), { httpMetadata: { contentType: "application/json; charset=utf-8" } });
}

// null = sursa nu are text extras (sau obiectul lipseste).
export async function citesteText(bucket: R2Bucket, id: string): Promise<Pagina[] | null> {
  const obj = await bucket.get(cheieText(id));
  if (!obj) return null;
  return (await obj.json()) as Pagina[];
}

export async function stergeText(bucket: R2Bucket, id: string): Promise<void> {
  await bucket.delete(cheieText(id));
}
