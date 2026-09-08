// Gemini File Search prin REST (fara SDK). Singurul fisier care vorbeste cu Google.
//
// Model: fiecare catalog are un "magazin" (fileSearchStore); fiecare sursa cu PDF e un document
// in el, cu customMetadata { sursa: <id>, titlu }. Intrebarile merg la generateContent cu unealta
// file_search; citarile vin din groundingMetadata (retrievedContext.customMetadata + pageNumber).
//
// Incarcarea: Files API (upload resumable in doi pasi) + importFile in magazin. Upload-ul direct
// in magazin (uploadToFileSearchStore) raspunde 404 la data scrierii, deci nu il folosim.
//
// Verificat pe viu la 8 sept. 2026; formele JSON de mai jos sunt cele reale.

import { TARIFE } from "./validare";
import type { Citare } from "./consum";

const BAZA = "https://generativelanguage.googleapis.com";

export const PROMPT_SISTEM = `Ești asistentul unui catalog de acte normative din sistemul penitenciar al Republicii Moldova.
Răspunzi în limba română, doar pe baza fragmentelor de documente primite prin căutare.
Citează de fiecare dată articolul, punctul sau alineatul și denumirea actului din care ai luat informația.
Dacă informația nu se găsește în documente, spune clar „Nu am găsit această informație în documentele catalogului” și nu inventa.
Fii concis și precis; nu da interpretări juridice proprii și nu speculezi dincolo de text.`;

export interface Schimb {
  intrebare: string;
  raspuns: string;
}

export interface Raspuns {
  text: string;
  citari: Citare[];
  tokens_intrare: number;
  tokens_iesire: number;
}

export class EroareGemini extends Error {
  status: number;
  constructor(status: number, mesaj: string) {
    super(mesaj);
    this.status = status;
  }
}

async function apel(cheie: string, cale: string, init: RequestInit & { json?: unknown } = {}): Promise<any> {
  const { json, ...rest } = init;
  const antete = new Headers(rest.headers);
  antete.set("x-goog-api-key", cheie);
  if (json !== undefined) antete.set("content-type", "application/json");
  const r = await fetch(`${BAZA}${cale}`, { ...rest, headers: antete, body: json !== undefined ? JSON.stringify(json) : rest.body });
  const text = await r.text();
  let date: any = null;
  try { date = text ? JSON.parse(text) : null; } catch { date = null; }
  if (!r.ok) throw new EroareGemini(r.status, date?.error?.message ?? `Google a răspuns ${r.status}.`);
  return date;
}

// ---------------------------------------------------------------- magazine si documente

export async function creeazaMagazin(cheie: string, nume: string): Promise<string> {
  const d = await apel(cheie, "/v1beta/fileSearchStores", {
    method: "POST",
    json: { displayName: nume, embeddingModel: "models/gemini-embedding-2" },
  });
  return String(d.name);
}

export async function stergeMagazin(cheie: string, magazin: string): Promise<void> {
  await apel(cheie, `/v1beta/${magazin}?force=true`, { method: "DELETE" });
}

export interface MetaDocument {
  sursaId: string;
  titlu: string;
}

// Urca fisierul in Files API (stream, cu lungime cunoscuta) si il importa in magazin.
// Intoarce numele operatiei de indexare (se urmareste cu stareOperatie).
export async function incarcaDocument(
  cheie: string, magazin: string, corp: ReadableStream, marime: number, tip: string, meta: MetaDocument
): Promise<string> {
  // 1. start: primim URL-ul de upload
  const start = await fetch(`${BAZA}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": cheie,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(marime),
      "X-Goog-Upload-Header-Content-Type": tip,
      "content-type": "application/json",
    },
    body: JSON.stringify({ file: { displayName: meta.sursaId } }),
  });
  const url = start.headers.get("x-goog-upload-url");
  if (!start.ok || !url) throw new EroareGemini(start.status, `Google nu a acceptat începerea încărcării (${start.status}).`);

  // 2. octetii, streamati; lungimea e cunoscuta, deci fara chunked.
  const fin = await fetch(url, {
    method: "POST",
    headers: {
      "content-length": String(marime),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: corp,
    // @ts-expect-error: cerut de unele runtime-uri pentru corp stream; workerd il ignora
    duplex: "half",
  });
  const finText = await fin.text();
  if (!fin.ok) throw new EroareGemini(fin.status, `Încărcarea fișierului a eșuat (${fin.status}).`);
  const fisier = JSON.parse(finText)?.file?.name as string | undefined;
  if (!fisier) throw new EroareGemini(502, "Google nu a întors numele fișierului încărcat.");

  // 3. import in magazin, cu metadatele noastre
  const op = await apel(cheie, `/v1beta/${magazin}:importFile`, {
    method: "POST",
    json: {
      fileName: fisier,
      customMetadata: [
        { key: "sursa", stringValue: meta.sursaId },
        { key: "titlu", stringValue: meta.titlu.slice(0, 200) },
      ],
    },
  });
  return String(op.name);
}

export type StareOperatie =
  | { done: false }
  | { done: true; document: string }
  | { done: true; eroare: string };

// Operatia de import: la final, `response.documentName` e doar id-ul documentului.
export async function stareOperatie(cheie: string, magazin: string, operatie: string): Promise<StareOperatie> {
  const d = await apel(cheie, `/v1beta/${operatie}`);
  return interpreteazaOperatie(d, magazin);
}

export function interpreteazaOperatie(d: any, magazin: string): StareOperatie {
  if (!d?.done) return { done: false };
  if (d.error) return { done: true, eroare: String(d.error.message ?? "eroare necunoscută") };
  const id = d.response?.documentName;
  if (!id) return { done: true, eroare: "operația s-a terminat fără document" };
  return { done: true, document: String(id).includes("/") ? String(id) : `${magazin}/documents/${id}` };
}

// STATE_ACTIVE -> "activ", STATE_FAILED -> "esuat", altfel (PENDING sau inca inexistent) -> "in_curs".
export async function stareDocument(cheie: string, document: string): Promise<"activ" | "esuat" | "in_curs"> {
  try {
    const d = await apel(cheie, `/v1beta/${document}`);
    const stare = String(d?.state ?? "");
    if (stare === "STATE_ACTIVE") return "activ";
    if (stare === "STATE_FAILED") return "esuat";
    return "in_curs";
  } catch (e) {
    if (e instanceof EroareGemini && e.status === 404) return "in_curs";
    throw e;
  }
}

export async function stergeDocument(cheie: string, document: string): Promise<void> {
  try {
    await apel(cheie, `/v1beta/${document}?force=true`, { method: "DELETE" });
  } catch (e) {
    if (e instanceof EroareGemini && e.status === 404) return; // deja sters
    throw e;
  }
}

export async function listeazaDocumente(cheie: string, magazin: string): Promise<{ name: string; state: string }[]> {
  const d = await apel(cheie, `/v1beta/${magazin}/documents?pageSize=100`);
  return (d?.documents ?? []).map((x: any) => ({ name: String(x.name), state: String(x.state ?? "") }));
}

// ---------------------------------------------------------------- intrebari

export interface CerereIntrebare {
  model: string;
  magazin: string;
  istoric: Schimb[];
  intrebare: string;
}

// Corpul cererii generateContent. Istoricul: ultimele 8 schimburi, ca sa nu creasca costul.
export function construiesteCerere(c: CerereIntrebare): Record<string, unknown> {
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const s of c.istoric.slice(-8)) {
    if (!s.intrebare || !s.raspuns) continue;
    contents.push({ role: "user", parts: [{ text: s.intrebare.slice(0, 2000) }] });
    contents.push({ role: "model", parts: [{ text: s.raspuns.slice(0, 4000) }] });
  }
  contents.push({ role: "user", parts: [{ text: c.intrebare }] });
  return {
    system_instruction: { parts: [{ text: PROMPT_SISTEM }] },
    contents,
    tools: [{ file_search: { file_search_store_names: [c.magazin] } }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
  };
}

// Raspunsul generateContent -> text, citari unice (sursa + pagina), tokeni.
export function extrageRaspuns(d: any): Raspuns {
  const cand = d?.candidates?.[0];
  const parts: any[] = cand?.content?.parts ?? [];
  const text = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("").trim();

  const gm = cand?.groundingMetadata ?? {};
  const chunks: any[] = gm.groundingChunks ?? [];
  const folosite = new Set<number>();
  for (const s of gm.groundingSupports ?? []) for (const i of s.groundingChunkIndices ?? []) folosite.add(Number(i));
  const indici = folosite.size ? [...folosite].sort((a, b) => a - b) : chunks.map((_, i) => i);

  const citari: Citare[] = [];
  const vazute = new Set<string>();
  for (const i of indici) {
    const rc = chunks[i]?.retrievedContext;
    if (!rc) continue;
    const meta: Record<string, string> = {};
    for (const m of rc.customMetadata ?? []) if (m.key && m.stringValue !== undefined) meta[m.key] = String(m.stringValue);
    const sursa_id = meta.sursa ?? null;
    const titlu = meta.titlu ?? String(rc.title ?? "Document");
    const pagina = typeof rc.pageNumber === "number" ? rc.pageNumber : null;
    const cheie = `${sursa_id}|${pagina}`;
    if (vazute.has(cheie)) continue;
    vazute.add(cheie);
    citari.push({ sursa_id, titlu, pagina });
  }

  const u = d?.usageMetadata ?? {};
  const tokens_intrare = Number(u.promptTokenCount ?? 0) + Number(u.toolUsePromptTokenCount ?? 0) + Number(u.cachedContentTokenCount ?? 0);
  const tokens_iesire = Number(u.candidatesTokenCount ?? 0) + Number(u.thoughtsTokenCount ?? 0);
  return { text, citari, tokens_intrare, tokens_iesire };
}

export async function intreaba(cheie: string, c: CerereIntrebare): Promise<Raspuns> {
  const d = await apel(cheie, `/v1beta/models/${encodeURIComponent(c.model)}:generateContent`, {
    method: "POST",
    json: construiesteCerere(c),
  });
  const r = extrageRaspuns(d);
  if (!r.text) {
    const motiv = d?.candidates?.[0]?.finishReason ?? d?.promptFeedback?.blockReason ?? "fără text";
    throw new EroareGemini(502, `Modelul nu a dat un răspuns (${motiv}).`);
  }
  return r;
}

// Tokenii costa $/milion; 1 $/milion = 1 microdolar per token, deci inmultirea e directa.
export function costMicrodolari(model: string, tokensIntrare: number, tokensIesire: number): number {
  const t = TARIFE[model];
  if (!t) return 0;
  return Math.round(tokensIntrare * t.intrare + tokensIesire * t.iesire);
}
