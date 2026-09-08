// Fisierele din R2: chei, tipuri permise, raspunsuri cu Range (Safari cere 206 pentru <audio>).
// Regula: nimic nu trece prin arrayBuffer(); corpul se streameaza in ambele directii.

import { LIMITA_AUDIO, LIMITA_PDF } from "./validare";

export type FelFisier = "pdf" | "audio";

export function cheieR2(fel: FelFisier, id: string): string {
  return `${fel}/${id}`;
}

export const TIPURI_PDF = ["application/pdf"];
export const TIPURI_AUDIO = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/wave", "audio/x-wav"];

// Tipul din Content-Type, fara parametri (", codecs=..."), in minuscule.
export function tipMime(contentType: string | null): string {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase();
}

export function tipMimePermis(fel: FelFisier, contentType: string | null): boolean {
  return (fel === "pdf" ? TIPURI_PDF : TIPURI_AUDIO).includes(tipMime(contentType));
}

export function limita(fel: FelFisier): number {
  return fel === "pdf" ? LIMITA_PDF : LIMITA_AUDIO;
}

// Numele de fisier trimis de client (URL-encoded in antetul x-nume-fisier), curatat:
// fara separatoare de cale, fara caractere de control, maxim 200 de caractere.
export function numeFisierCurat(brut: string | null, implicit: string): string {
  let nume: string;
  try { nume = decodeURIComponent(brut ?? ""); } catch { nume = ""; }
  nume = nume.replace(/[\\/]/g, "").replace(/\p{Cc}/gu, "").trim().slice(0, 200);
  return nume || implicit;
}

// Verifica cererea de upload inainte de a atinge R2. Intoarce eroarea HTTP sau datele fisierului.
export type VerificareUpload =
  | { ok: true; tip: string; marime: number }
  | { ok: false; status: 411 | 413 | 415; mesaj: string };

export function verificaUpload(fel: FelFisier, cerere: Request): VerificareUpload {
  const tip = tipMime(cerere.headers.get("content-type"));
  if (!tipMimePermis(fel, tip)) {
    return { ok: false, status: 415, mesaj: fel === "pdf" ? "Doar fișiere PDF." : "Doar fișiere audio (MP3, M4A, WAV)." };
  }
  const lungime = Number(cerere.headers.get("content-length"));
  if (!Number.isInteger(lungime) || lungime <= 0) return { ok: false, status: 411, mesaj: "Lipsește Content-Length." };
  if (lungime > limita(fel)) {
    return { ok: false, status: 413, mesaj: `Fișierul depășește ${Math.round(limita(fel) / 1024 / 1024)} MB.` };
  }
  return { ok: true, tip, marime: lungime };
}

// Unele PDF-uri (ex. cele generate de legis.md cu mPDF) au cativa octeti de gunoi inaintea
// antetului "%PDF". Cititoarele ii tolereaza, dar indexarea Google esueaza. Cautam antetul in
// primii 4 KB si sarim peste ce e inainte; lungimea noua = marime - offset.
export const CAUTARE_ANTET = 4096;

export async function curataPdf(corp: ReadableStream<Uint8Array>, marime: number): Promise<{ corp: ReadableStream<Uint8Array>; marime: number; taiat: number }> {
  const reader = corp.getReader();
  const bucati: Uint8Array[] = [];
  let citit = 0;
  while (citit < CAUTARE_ANTET) {
    const { value, done } = await reader.read();
    if (done) break;
    bucati.push(value);
    citit += value.length;
  }
  const inceput = concat(bucati);
  const offset = gasesteAntet(inceput);
  const taiat = offset > 0 ? offset : 0;
  const rest = inceput.subarray(taiat);
  const corpNou = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (rest.length && !(this as any).dat) { (this as any).dat = true; controller.enqueue(rest); return; }
      const { value, done } = await reader.read();
      if (done) { controller.close(); return; }
      controller.enqueue(value);
    },
    cancel() { return reader.cancel(); },
  });
  return { corp: corpNou, marime: marime - taiat, taiat };
}

function concat(bucati: Uint8Array[]): Uint8Array {
  const total = bucati.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const b of bucati) { out.set(b, i); i += b.length; }
  return out;
}

// Offsetul lui "%PDF" in primii octeti; 0 daca e la inceput; -1 daca nu se gaseste (lasam neatins).
export function gasesteAntet(octeti: Uint8Array): number {
  const s = [0x25, 0x50, 0x44, 0x46]; // %PDF
  for (let i = 0; i + 4 <= Math.min(octeti.length, CAUTARE_ANTET); i++) {
    if (octeti[i] === s[0] && octeti[i + 1] === s[1] && octeti[i + 2] === s[2] && octeti[i + 3] === s[3]) return i;
  }
  return -1;
}

// Raspuns HTTP pentru un obiect citit din R2. Cu `partial` (clientul a trimis Range si R2 l-a
// aplicat) iese 206 cu Content-Range; altfel 200 cu tot corpul. `obj.range` singur nu ajunge:
// R2 local il pune si cand nu s-a cerut nimic.
export function raspunsFisier(
  obj: R2ObjectBody, nume: string, dispozitie: "inline" | "attachment", partial = false
): Response {
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("etag", obj.httpEtag);
  h.set("accept-ranges", "bytes");
  h.set("content-disposition", `${dispozitie}; filename*=UTF-8''${encodeURIComponent(nume)}`);
  h.set("cache-control", "no-store");

  const r = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (!partial || !r) {
    h.set("content-length", String(obj.size));
    return new Response(obj.body, { status: 200, headers: h });
  }
  let start: number, end: number;
  if (r.suffix !== undefined) {
    start = Math.max(0, obj.size - r.suffix);
    end = obj.size - 1;
  } else {
    start = r.offset ?? 0;
    end = r.length !== undefined ? start + r.length - 1 : obj.size - 1;
  }
  h.set("content-range", `bytes ${start}-${end}/${obj.size}`);
  h.set("content-length", String(end - start + 1));
  return new Response(obj.body, { status: 206, headers: h });
}

// Citeste obiectul si construieste raspunsul, onorand Range si conditionalele din cerere.
// null = obiectul nu exista.
export async function serveste(
  bucket: R2Bucket, cheie: string, cerere: Request, nume: string, dispozitie: "inline" | "attachment"
): Promise<Response | null> {
  let obj: R2Object | R2ObjectBody | null;
  try {
    // `range` doar cand clientul l-a cerut: altfel R2 poate raporta un interval "intreg" si am da 206.
    const optiuni: R2GetOptions = { onlyIf: cerere.headers };
    if (cerere.headers.has("range")) optiuni.range = cerere.headers;
    obj = await bucket.get(cheie, optiuni);
  } catch {
    // Interval nesatisfiabil (ex. bytes=999999-).
    return new Response(null, { status: 416, headers: { "content-range": "bytes */0" } });
  }
  if (!obj) return null;
  if (!("body" in obj) || !obj.body) {
    // Conditionalele (If-None-Match etc.) au decis ca nu e nevoie de corp.
    return new Response(null, { status: 304, headers: { etag: obj.httpEtag } });
  }
  return raspunsFisier(obj, nume, dispozitie, cerere.headers.has("range"));
}
