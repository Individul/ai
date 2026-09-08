// Upload de fisiere din pagina de admin. Corpul e fisierul brut (nu multipart), ca serverul
// sa il streameze in R2 fara sa il tina in memorie. XMLHttpRequest, nu fetch: doar el da
// progres la upload. La succes, pagina se reincarca (serverul e sursa adevarului).

interface Raspuns { status: number; corp: string }

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
      if (r.status === 200) { stare(iesire, "încărcat", "ok"); location.reload(); return; }
      stare(iesire, mesajEroare(r), "eroare");
    } catch (e) {
      stare(iesire, (e as Error).message, "eroare");
    }
    input.disabled = false;
    input.value = "";
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
