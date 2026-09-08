// Chatul de pe pagina catalogului. Istoricul (ultimele schimburi) sta in sessionStorage per
// catalog si se trimite la server cu fiecare intrebare (serverul e stateless). Randarea
// escapeaza tot; raspunsul e text simplu cu **bold** si liste, randat minimal si sigur.

import { randeazaMarkdown } from "../lib/markdown";

interface Citare { sursa_id: string | null; titlu: string; pagina: number | null }
interface Schimb { intrebare: string; raspuns: string; citari: Citare[] }

const sectiune = document.querySelector<HTMLElement>("[data-chat]");
if (sectiune) pornesteChat(sectiune);

function pornesteChat(el: HTMLElement) {
  const catalog = el.dataset.chat ?? "";
  const form = el.querySelector<HTMLFormElement>("form")!;
  const camp = form.querySelector<HTMLTextAreaElement>("textarea")!;
  const buton = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const lista = el.querySelector<HTMLElement>("[data-schimburi]")!;
  const contor = el.querySelector<HTMLElement>("[data-ramase]")!;
  const sterge = el.querySelector<HTMLButtonElement>("[data-sterge]");
  const cheie = `chat:${catalog}`;

  let istoric: Schimb[] = [];
  try { istoric = JSON.parse(sessionStorage.getItem(cheie) ?? "[]"); } catch { istoric = []; }
  const salveaza = () => { try { sessionStorage.setItem(cheie, JSON.stringify(istoric.slice(-8))); } catch { /* fara stocare */ } };

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

  // Sub caseta: ultimul schimb desfasurat; cele anterioare doar ca intrebari (linkuri),
  // fiecare se deschide la clic. Caseta ramane mereu in acelasi loc.
  function randeaza(nou = false) {
    const [ultimul, ...vechi] = [...istoric].reverse();
    if (!ultimul) { lista.innerHTML = ""; if (sterge) sterge.hidden = true; return; }
    let html =
      `<article class="schimb${nou ? " nou" : ""}"><p class="intrebare">${esc(ultimul.intrebare)}</p>${corp(ultimul)}</article>`;
    if (vechi.length) {
      html +=
        `<section class="anterioare"><h3>Întrebări anterioare</h3>` +
        vechi.map((s) => `<details class="vechi"><summary>${esc(s.intrebare)}</summary>${corp(s)}</details>`).join("") +
        `</section>`;
    }
    lista.innerHTML = html;
    if (sterge) sterge.hidden = false;
  }

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
    stare("se caută în documente…");
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ catalog, intrebare, istoric: istoric.slice(-8).map((s) => ({ intrebare: s.intrebare, raspuns: s.raspuns })) }),
      });
      const d = (await r.json()) as { raspuns?: string; citari?: Citare[]; ramase?: number; limita?: number; eroare?: string };
      if (!r.ok || !d.raspuns) {
        stare(d.eroare ?? `Eroare ${r.status}.`, "eroare");
        if (r.status !== 429) { camp.disabled = false; buton.disabled = false; }
        else camp.disabled = false;
        return;
      }
      istoric.push({ intrebare, raspuns: d.raspuns, citari: d.citari ?? [] });
      salveaza();
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

  sterge?.addEventListener("click", () => { istoric = []; salveaza(); randeaza(); });

  randeaza();
  void actualizeazaRamase();
}
