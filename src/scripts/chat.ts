// Chatul de pe pagina catalogului. Istoricul vine de pe server (jurnalul propriu al catalogului),
// deci ramane pe orice tab si dupa reincarcare: intai ultimele 5 intrebari, apoi cate 10 mai vechi
// la "arata intrebari mai vechi", grupate pe zile. "Sterge conversatia" doar il ascunde din pagina:
// se retine local momentul stergerii, iar tot ce e mai vechi nu se mai arata si nu mai intra in
// contextul trimis modelului. Randarea escapeaza tot; raspunsul e Markdown minimal, randat sigur.

import { randeazaMarkdown } from "../lib/markdown";

interface Citare { sursa_id: string | null; titlu: string; pagina: number | null }
interface Schimb { intrebare: string; raspuns: string; citari: Citare[]; creat_la: string }

const sectiune = document.querySelector<HTMLElement>("[data-chat]");
if (sectiune) pornesteChat(sectiune);

function pornesteChat(el: HTMLElement) {
  const catalog = el.dataset.chat ?? "";
  // Z.AI primeste textul catalogului intreg: raspunsul poate dura minute, iar omul trebuie sa stie.
  const asteptare = el.dataset.motor === "zai" ? "se citește catalogul… poate dura 1–3 minute" : "se caută în documente…";
  const form = el.querySelector<HTMLFormElement>("form")!;
  const camp = form.querySelector<HTMLTextAreaElement>("textarea")!;
  const buton = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const lista = el.querySelector<HTMLElement>("[data-schimburi]")!;
  const contor = el.querySelector<HTMLElement>("[data-ramase]")!;
  const sterge = el.querySelector<HTMLButtonElement>("[data-sterge]");
  const maiMulte = el.querySelector<HTMLButtonElement>("[data-mai-multe]");
  const cheieSters = `chat:${catalog}:sters`;

  let istoric: Schimb[] = [];
  let maiVechiPeServer = false;
  const stersPanaLa = (): string => { try { return localStorage.getItem(cheieSters) ?? ""; } catch { return ""; } };
  const vizibile = () => istoric.filter((s) => s.creat_la > stersPanaLa());

  // "Azi", "Ieri" sau data, in fusul browserului (colegii sunt in acelasi fus).
  function ziua(iso: string): string {
    const d = new Date(iso);
    const azi = new Date();
    const ieri = new Date(azi);
    ieri.setDate(azi.getDate() - 1);
    const aceeasi = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (aceeasi(d, azi)) return "Azi";
    if (aceeasi(d, ieri)) return "Ieri";
    return d.toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: d.getFullYear() === azi.getFullYear() ? undefined : "numeric" });
  }

  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

  function htmlCitari(citari: Citare[]): string {
    if (!citari.length) return "";
    const etichete = citari.map((c) => {
      const text = esc(c.titlu) + (c.pagina ? ` · p. ${c.pagina}` : "");
      if (!c.sursa_id) return `<span class="citare">${text}</span>`;
      const href = `/f/pdf/${encodeURIComponent(c.sursa_id)}${c.pagina ? `#page=${c.pagina}` : ""}`;
      return `<a class="citare" href="${href}" target="_blank" rel="noopener">${text}</a>`;
    });
    return `<div class="citari">${etichete.join("")}</div>`;
  }

  const corp = (s: Schimb) => `<div class="raspuns proza">${randeazaMarkdown(s.raspuns)}</div>${htmlCitari(s.citari)}`;

  // Sub caseta: intrebarile ca linkuri, cea mai noua prima, grupate pe zile; raspunsul se deschide
  // la clic. Raspunsul abia primit e deschis automat. Caseta ramane mereu in acelasi loc.
  function randeaza(nou = false) {
    const de = vizibile();
    if (!de.length) { lista.innerHTML = ""; if (sterge) sterge.hidden = true; if (maiMulte) maiMulte.hidden = true; return; }
    const grupuri: { zi: string; schimburi: Schimb[] }[] = [];
    for (const s of [...de].reverse()) {
      const zi = ziua(s.creat_la);
      const ultim = grupuri[grupuri.length - 1];
      if (ultim && ultim.zi === zi) ultim.schimburi.push(s);
      else grupuri.push({ zi, schimburi: [s] });
    }
    lista.innerHTML = grupuri
      .map((g, gi) =>
        `<section class="anterioare"><h3>${esc(g.zi)}</h3>` +
        g.schimburi
          .map((s, i) => {
            const primul = nou && gi === 0 && i === 0;
            return `<details class="vechi${primul ? " nou" : ""}"${primul ? " open" : ""}><summary>${esc(s.intrebare)}</summary>${corp(s)}</details>`;
          })
          .join("") +
        `</section>`)
      .join("");
    if (sterge) sterge.hidden = false;
    // Mai vechi decat momentul stergerii nu are rost sa aducem: oricum nu s-ar arata.
    if (maiMulte) maiMulte.hidden = !maiVechiPeServer || (istoric[0]?.creat_la ?? "") <= stersPanaLa();
  }

  // Aduce `n` intrebari de pe server, mai vechi decat cea mai veche pe care o avem.
  async function incarcaIstoric(n: number): Promise<void> {
    const inainte = istoric[0]?.creat_la;
    const r = await fetch(`/api/chat/istoric?catalog=${encodeURIComponent(catalog)}&n=${n}${inainte ? `&inainte=${encodeURIComponent(inainte)}` : ""}`);
    if (!r.ok) return;
    const d = (await r.json()) as { istoric: Schimb[]; mai_vechi: boolean };
    istoric = [...d.istoric, ...istoric];
    maiVechiPeServer = d.mai_vechi;
  }

  maiMulte?.addEventListener("click", async () => {
    maiMulte.disabled = true;
    try { await incarcaIstoric(10); } catch { /* ramane cum e */ }
    maiMulte.disabled = false;
    randeaza();
  });

  function stare(text: string, fel: "" | "eroare" = "") {
    contor.textContent = text;
    contor.className = `ramase ${fel}`.trim();
  }

  async function actualizeazaRamase() {
    try {
      const r = await fetch("/api/chat/ramase");
      if (!r.ok) return;
      const d = (await r.json()) as { ramase: number; limita: number };
      stare(`${d.ramase} din ${d.limita} întrebări rămase azi`);
      buton.disabled = d.ramase === 0;
    } catch { /* ramane textul de pe server */ }
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const intrebare = camp.value.trim();
    if (!intrebare) return;
    buton.disabled = true;
    camp.disabled = true;
    stare(asteptare);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catalog, intrebare, istoric: vizibile().slice(-8).map((s) => ({ intrebare: s.intrebare, raspuns: s.raspuns })) }),
      });
      const d = (await r.json()) as { raspuns?: string; citari?: Citare[]; ramase?: number; limita?: number; eroare?: string };
      if (!r.ok || !d.raspuns) {
        stare(d.eroare ?? `Eroare ${r.status}.`, "eroare");
        if (r.status !== 429) { camp.disabled = false; buton.disabled = false; }
        else camp.disabled = false;
        return;
      }
      istoric.push({ intrebare, raspuns: d.raspuns, citari: d.citari ?? [], creat_la: new Date().toISOString() });
      randeaza(true);
      camp.value = "";
      lista.firstElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      stare(`${d.ramase ?? "?"} din ${d.limita ?? "?"} întrebări rămase azi`);
      buton.disabled = d.ramase === 0;
    } catch (e) {
      stare((e as Error).message || "Conexiunea a picat.", "eroare");
      buton.disabled = false;
    } finally {
      camp.disabled = false;
      if (!buton.disabled) camp.focus();
    }
  });

  // Enter trimite, Shift+Enter face rand nou.
  camp.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });

  sterge?.addEventListener("click", () => {
    try { localStorage.setItem(cheieSters, new Date().toISOString()); } catch { /* fara stocare */ }
    randeaza();
  });

  // Ultimele 5 intrebari de pe server, apoi contorul.
  (async () => {
    try { await incarcaIstoric(5); } catch { /* ramane gol */ }
    randeaza();
  })();
  void actualizeazaRamase();
}
