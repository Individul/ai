// Vizorul de PDF din pagina: un panou lateral care arata pagina citata, randata cu pdf.js, si
// evidentiaza articolul / punctul / alineatul mentionat inaintea trimiterii. Se deschide de pe
// linkurile cu data-vizor (trimiterile din raspuns si lista "Surse"); fara JavaScript, linkurile
// deschid PDF-ul in tab nou. pdf.js se incarca abia la prima deschidere.

type Pdfjs = typeof import("pdfjs-dist");
type Document = import("pdfjs-dist").PDFDocumentProxy;
type Sarcina = import("pdfjs-dist").PDFDocumentLoadingTask;

interface Deschidere { sursa: string; pagina: number; titlu: string; cauta: string | null }

let pdfjs: Pdfjs | null = null;
let panou: HTMLElement | null = null;
let document_: Document | null = null;
let sarcina: Sarcina | null = null; // ca sa inchidem documentul vechi cand se schimba sursa
let sursaCurenta = "";
let curent: Deschidere | null = null;
let randare = 0; // contor: o randare mai noua o anuleaza pe cea veche

async function incarcaPdfjs(): Promise<Pdfjs> {
  if (pdfjs) return pdfjs;
  const [lib, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  pdfjs = lib;
  return lib;
}

function construieste(): HTMLElement {
  if (panou) return panou;
  const el = document.createElement("div");
  el.className = "vizor";
  el.hidden = true;
  el.innerHTML = `
    <div class="vizor-fundal" data-inchide></div>
    <aside class="vizor-panou" role="dialog" aria-modal="true" aria-label="Sursa citată">
      <header class="vizor-cap">
        <div class="vizor-titlu"><strong data-titlu></strong><span data-unde></span></div>
        <nav class="vizor-nav">
          <button type="button" class="text" data-inapoi title="Pagina anterioară" aria-label="Pagina anterioară">‹</button>
          <span data-pagina></span>
          <button type="button" class="text" data-inainte title="Pagina următoare" aria-label="Pagina următoare">›</button>
          <a class="text" data-complet target="_blank" rel="noopener">deschide PDF-ul ↗</a>
          <button type="button" class="text" data-inchide title="Închide (Esc)" aria-label="Închide">✕</button>
        </nav>
      </header>
      <div class="vizor-corp" data-corp>
        <div class="vizor-pagina" data-foaie><canvas></canvas><div class="vizor-marcaje" data-marcaje></div></div>
        <p class="vizor-stare" data-stare></p>
      </div>
    </aside>`;
  document.body.appendChild(el);
  el.querySelectorAll<HTMLElement>("[data-inchide]").forEach((b) => b.addEventListener("click", inchide));
  el.querySelector<HTMLButtonElement>("[data-inapoi]")!.addEventListener("click", () => curent && arata({ ...curent, pagina: curent.pagina - 1, cauta: null }));
  el.querySelector<HTMLButtonElement>("[data-inainte]")!.addEventListener("click", () => curent && arata({ ...curent, pagina: curent.pagina + 1, cauta: null }));
  document.addEventListener("keydown", (e) => {
    if (el.hidden) return;
    if (e.key === "Escape") inchide();
    if (e.key === "ArrowLeft") el.querySelector<HTMLButtonElement>("[data-inapoi]")!.click();
    if (e.key === "ArrowRight") el.querySelector<HTMLButtonElement>("[data-inainte]")!.click();
  });
  let latime = 0;
  window.addEventListener("resize", () => {
    const l = el.querySelector<HTMLElement>("[data-corp]")!.clientWidth;
    if (!el.hidden && curent && l !== latime) { latime = l; void arata(curent); }
  });
  panou = el;
  return el;
}

function inchide() {
  if (!panou) return;
  panou.hidden = true;
  document.body.style.overflow = "";
}

function stare(text: string) {
  panou?.querySelector<HTMLElement>("[data-stare]")!.replaceChildren(text);
}

// Regexul dupa care se cauta in textul paginii, din "art:13" / "pct:218" / "alin:2".
function regexCautare(cauta: string | null): RegExp | null {
  if (!cauta) return null;
  const [tip, brut] = cauta.split(":");
  const n = (brut ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!n) return null;
  if (tip === "art") return new RegExp(`(^|[^\\d])(art(?:icolul|\\.)?\\s*${n})(?![\\d\\u00b9\\u00b2\\u00b3\\u2070-\\u2079])`, "i");
  if (tip === "pct") return new RegExp(`(^|[^\\d])(${n}\\.)(?!\\d)`);
  if (tip === "alin") return new RegExp(`\\(${n}\\)`);
  return null;
}

export async function arata(d: Deschidere): Promise<void> {
  const el = construieste();
  el.hidden = false;
  document.body.style.overflow = "hidden";
  curent = d;
  const id = ++randare;
  el.querySelector<HTMLElement>("[data-titlu]")!.textContent = d.titlu;
  el.querySelector<HTMLAnchorElement>("[data-complet]")!.href = `/f/pdf/${d.sursa}#page=${d.pagina}`;
  el.querySelector<HTMLElement>("[data-pagina]")!.textContent = `p. ${d.pagina}`;
  el.querySelector<HTMLElement>("[data-unde]")!.textContent = "";
  const marcaje = el.querySelector<HTMLElement>("[data-marcaje]")!;
  marcaje.replaceChildren();
  stare("se încarcă…");
  try {
    const lib = await incarcaPdfjs();
    let doc = document_;
    if (sursaCurenta !== d.sursa || !doc) {
      void sarcina?.destroy();
      sarcina = lib.getDocument({ url: `/f/pdf/${d.sursa}`, rangeChunkSize: 262144 });
      doc = await sarcina.promise;
      document_ = doc;
      sursaCurenta = d.sursa;
    }
    if (id !== randare) return;
    const total = doc.numPages;
    const nr = Math.min(Math.max(1, d.pagina), total);
    curent = { ...d, pagina: nr };
    el.querySelector<HTMLElement>("[data-pagina]")!.textContent = `p. ${nr} din ${total}`;
    el.querySelector<HTMLButtonElement>("[data-inapoi]")!.disabled = nr <= 1;
    el.querySelector<HTMLButtonElement>("[data-inainte]")!.disabled = nr >= total;

    const page = await doc.getPage(nr);
    if (id !== randare) return;
    const corp = el.querySelector<HTMLElement>("[data-corp]")!;
    const latime = Math.max(320, corp.clientWidth - 32);
    const baza = page.getViewport({ scale: 1 });
    const scale = latime / baza.width;
    const viewport = page.getViewport({ scale });
    const canvas = el.querySelector<HTMLCanvasElement>("canvas")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const foaie = el.querySelector<HTMLElement>("[data-foaie]")!;
    foaie.style.width = `${viewport.width}px`;
    foaie.style.height = `${viewport.height}px`;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvas, canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;
    if (id !== randare) return;
    stare("");

    // Evidentierea: pdf.js sparge randurile in bucati ("Articolul", "13."), deci cautam in textul
    // intreg al paginii si marcam bucatile care acopera potrivirea.
    const re = regexCautare(d.cauta);
    if (!re) return;
    const continut = await page.getTextContent();
    if (id !== randare) return;
    type Bucata = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };
    const bucati = (continut.items as Bucata[]).filter((b) => typeof b.str === "string");
    let text = "";
    const pozitii: { de: number; pana: number; b: Bucata }[] = [];
    for (const b of bucati) {
      const de = text.length;
      text += b.str;
      pozitii.push({ de, pana: text.length, b });
      text += b.hasEOL ? "\n" : " ";
    }
    let primul: HTMLElement | null = null;
    let gasite = 0;
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(global)) {
      const start = m.index! + (m[1]?.length ?? 0);
      const sfarsit = m.index! + m[0].length;
      for (const p of pozitii) {
        if (p.pana <= start || p.de >= sfarsit || !p.b.str.trim()) continue;
        const [x, y] = viewport.convertToViewportPoint(p.b.transform[4]!, p.b.transform[5]!);
        const h = (p.b.height || 10) * scale;
        const el2 = document.createElement("span");
        el2.className = "vizor-marcaj";
        el2.style.left = `${x - 3}px`;
        el2.style.top = `${y - h - 2}px`;
        el2.style.width = `${p.b.width * scale + 6}px`;
        el2.style.height = `${h + 4}px`;
        marcaje.appendChild(el2);
        primul ??= el2;
      }
      gasite++;
      if (gasite >= 3) break;
    }
    if (primul) {
      corp.scrollTo({ top: Math.max(0, primul.offsetTop - 120), behavior: "smooth" });
      el.querySelector<HTMLElement>("[data-unde]")!.textContent = ` · ${d.cauta!.replace("art:", "art. ").replace("pct:", "pct. ").replace("alin:", "alin. (")}${d.cauta!.startsWith("alin") ? ")" : ""}`;
    } else if (gasite === 0) {
      el.querySelector<HTMLElement>("[data-unde]")!.textContent = " · textul citat nu a fost găsit pe pagină";
    }
  } catch (e) {
    if (id === randare) stare(`Nu am putut deschide PDF-ul: ${(e as Error).message}`);
  }
}

// Orice link cu data-vizor deschide vizorul; fara JavaScript ramane linkul obisnuit.
document.addEventListener("click", (ev) => {
  const a = (ev.target as HTMLElement).closest<HTMLAnchorElement>("a[data-vizor]");
  if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
  ev.preventDefault();
  void arata({
    sursa: a.dataset.vizor ?? "",
    pagina: Number(a.dataset.pagina) || 1,
    titlu: a.dataset.titlu ?? a.textContent?.trim() ?? "Sursa",
    cauta: a.dataset.cauta ?? null,
  });
});
