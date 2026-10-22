// Upload de fisiere din pagina de admin. Corpul e fisierul brut (nu multipart), ca serverul
// sa il streameze in R2 fara sa il tina in memorie. XMLHttpRequest, nu fetch: doar el da
// progres la upload. La succes, pagina se reincarca (serverul e sursa adevarului).

import { compunePagina, type ElementPagina } from "../lib/pdf";
import * as pdfjs from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface Raspuns { status: number; corp: string }
interface Pagina { pagina: number; text: string }

// Textul PDF-ului, pagina cu pagina, pe care il citeste chatul (Claude, DeepSeek). Se face
// aici, in browser: fara limita de CPU si fara sa tinem PDF-ul in memoria Workerului. Paginile fara
// text (scanate) lipsesc din lista; lista goala = PDF fara strat de text. Compunerea paginii din
// elementele pdf.js (inclusiv exponentii: 217¹, b¹) e in `compunePagina`, ca sa fie testabila.
async function extrageText(fisier: Blob, progres: (t: string) => void): Promise<Pagina[]> {
  const sarcina = pdfjs.getDocument({ data: new Uint8Array(await fisier.arrayBuffer()) });
  const doc = await sarcina.promise;
  const pagini: Pagina[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      if (i % 20 === 0) progres(`se extrage textul… pagina ${i} din ${doc.numPages}`);
      const p = await doc.getPage(i);
      const c = await p.getTextContent();
      const elemente: ElementPagina[] = [];
      for (const item of c.items) {
        if (!("str" in item)) continue;
        elemente.push({ text: item.str, inaltime: item.height, y: item.transform[5] ?? 0, rand_nou: item.hasEOL });
      }
      const text = compunePagina(elemente);
      if (text) pagini.push({ pagina: i, text });
      p.cleanup();
    }
  } finally {
    await sarcina.destroy();
  }
  return pagini;
}

async function salveazaText(id: string, pagini: Pagina[]): Promise<{ pagini: number; caractere: number }> {
  const r = await fetch(`/api/admin/surse/${id}/text`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pagini }),
  });
  const d = (await r.json().catch(() => ({}))) as { pagini?: number; caractere?: number; eroare?: string };
  if (!r.ok) throw new Error(d.eroare ?? `Eroare ${r.status} la salvarea textului.`);
  return { pagini: d.pagini ?? 0, caractere: d.caractere ?? 0 };
}

// Extrage si salveaza textul; intoarce mesajul de stare. Nu arunca: textul e o pregatire, nu upload-ul.
async function pregatesteText(id: string, fisier: Blob, iesire: HTMLElement | null): Promise<string> {
  try {
    const pagini = await extrageText(fisier, (t) => stare(iesire, t));
    const r = await salveazaText(id, pagini);
    return r.pagini ? `text: ${r.pagini} pag.` : "fără text (PDF scanat?)";
  } catch (e) {
    return `textul nu s-a putut extrage (${(e as Error).message})`;
  }
}

async function pdfDeLaServer(id: string): Promise<Blob> {
  const r = await fetch(`/f/pdf/${id}`);
  if (!r.ok) throw new Error(`Nu pot lua PDF-ul de pe server (${r.status}).`);
  return r.blob();
}

function trimite(url: string, fisier: File, antete: Record<string, string>, progres: (p: number) => void): Promise<Raspuns> {
  return new Promise((rezolva, respinge) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    for (const [k, v] of Object.entries(antete)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => { if (e.lengthComputable) progres(e.loaded / e.total); };
    x.onload = () => rezolva({ status: x.status, corp: x.responseText });
    x.onerror = () => respinge(new Error("Conexiunea a picat."));
    x.send(fisier);
  });
}

function mesajEroare(r: Raspuns): string {
  try { return (JSON.parse(r.corp) as { eroare?: string }).eroare ?? `Eroare ${r.status}.`; }
  catch { return `Eroare ${r.status}.`; }
}

// Durata unui fisier audio, citita de browser din antetul fisierului. "" daca nu se poate.
function durataAudio(fisier: File): Promise<string> {
  return new Promise((rezolva) => {
    const url = URL.createObjectURL(fisier);
    const a = new Audio();
    const gata = (v: string) => { URL.revokeObjectURL(url); rezolva(v); };
    a.onloadedmetadata = () => gata(Number.isFinite(a.duration) ? String(Math.round(a.duration)) : "");
    a.onerror = () => gata("");
    a.preload = "metadata";
    a.src = url;
  });
}

function stare(el: HTMLElement | null, text: string, fel: "" | "ok" | "eroare" = "") {
  if (!el) return;
  el.textContent = text;
  el.className = `stare-incarcare ${fel}`.trim();
}

const antet = (v: string) => encodeURIComponent(v);

// --- PDF pe o sursa: <input type=file data-pdf-sursa="ID"> + <output data-stare>
for (const input of document.querySelectorAll<HTMLInputElement>("input[data-pdf-sursa]")) {
  input.addEventListener("change", async () => {
    const fisier = input.files?.[0];
    const id = input.dataset.pdfSursa ?? "";
    const iesire = input.closest("form")?.querySelector<HTMLElement>("[data-stare]") ?? null;
    if (!fisier) return;
    input.disabled = true;
    stare(iesire, "se încarcă… 0%");
    try {
      const r = await trimite(`/api/admin/surse/${id}/fisier`, fisier, {
        "content-type": "application/pdf",
        "x-nume-fisier": antet(fisier.name),
      }, (p) => stare(iesire, `se încarcă… ${Math.round(p * 100)}%`));
      if (r.status === 200) {
        stare(iesire, "încărcat; se extrage textul…", "ok");
        stare(iesire, await pregatesteText(id, fisier, iesire), "ok");
        location.reload();
        return;
      }
      stare(iesire, mesajEroare(r), "eroare");
    } catch (e) {
      stare(iesire, (e as Error).message, "eroare");
    }
    input.disabled = false;
    input.value = "";
  });
}

// "Extrage din nou textul" pe o sursa: ia PDF-ul de pe server si reface textul.
for (const b of document.querySelectorAll<HTMLButtonElement>("button[data-extrage]")) {
  b.addEventListener("click", async () => {
    const id = b.dataset.extrage ?? "";
    const iesire = b.closest("form")?.querySelector<HTMLElement>("[data-stare]") ?? null;
    b.disabled = true;
    try {
      stare(iesire, "se ia PDF-ul de pe server…");
      stare(iesire, await pregatesteText(id, await pdfDeLaServer(id), iesire), "ok");
    } catch (e) {
      stare(iesire, (e as Error).message, "eroare");
    }
    location.reload();
  });
}

// "Extrage textul" pentru toate sursele cu PDF (cele fara text sau ca sa refaca textul existent).
for (const b of document.querySelectorAll<HTMLButtonElement>("button[data-extrage-toate]")) {
  b.addEventListener("click", async () => {
    const ids = (b.dataset.extrageToate ?? "").split(",").filter(Boolean);
    const iesire = b.parentElement?.querySelector<HTMLElement>("[data-stare]") ?? null;
    b.disabled = true;
    let gata = 0;
    for (const id of ids) {
      stare(iesire, `sursa ${gata + 1} din ${ids.length}: se ia PDF-ul…`);
      try {
        const rezultat = await pregatesteText(id, await pdfDeLaServer(id), iesire);
        stare(iesire, `sursa ${gata + 1} din ${ids.length}: ${rezultat}`);
      } catch (e) {
        stare(iesire, `sursa ${gata + 1} din ${ids.length}: ${(e as Error).message}`, "eroare");
      }
      gata++;
    }
    stare(iesire, `gata: ${gata} surse`, "ok");
    location.reload();
  });
}

// --- Audio nou: <form data-audio-nou="CATALOG_ID"> cu fisier, titlu, descriere, data
for (const form of document.querySelectorAll<HTMLFormElement>("form[data-audio-nou]")) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const catalog = form.dataset.audioNou ?? "";
    const fisier = form.querySelector<HTMLInputElement>("input[type=file]")?.files?.[0];
    const iesire = form.querySelector<HTMLElement>("[data-stare]");
    const buton = form.querySelector<HTMLButtonElement>("button[type=submit]");
    const val = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
    if (!fisier) { stare(iesire, "Alege un fișier audio.", "eroare"); return; }
    if (buton) buton.disabled = true;
    stare(iesire, "se citește durata…");
    try {
      const durata = await durataAudio(fisier);
      const r = await trimite(`/api/admin/audio?catalog=${encodeURIComponent(catalog)}`, fisier, {
        "content-type": fisier.type || "audio/mpeg",
        "x-nume-fisier": antet(fisier.name),
        "x-titlu": antet(val("titlu")),
        "x-descriere": antet(val("descriere")),
        "x-data": antet(val("data")),
        "x-durata": antet(durata),
      }, (p) => stare(iesire, `se încarcă… ${Math.round(p * 100)}%`));
      if (r.status === 201) { stare(iesire, "încărcat", "ok"); location.reload(); return; }
      stare(iesire, mesajEroare(r), "eroare");
    } catch (e) {
      stare(iesire, (e as Error).message, "eroare");
    }
    if (buton) buton.disabled = false;
  });
}

// Butoanele periculoase cer confirmare.
for (const b of document.querySelectorAll<HTMLButtonElement>("button[data-confirma]")) {
  b.addEventListener("click", (e) => { if (!confirm(b.dataset.confirma ?? "")) e.preventDefault(); });
}

// Sectiunile care cer JavaScript devin vizibile abia acum.
for (const el of document.querySelectorAll<HTMLElement>("[data-cere-js]")) el.hidden = false;
for (const el of document.querySelectorAll<HTMLElement>("[data-fara-js]")) el.hidden = true;
