// Corectorul de documente in browser: desface .docx-ul, trimite textul la /api/corector, pune
// corecturile inapoi ca revizii Word (docx.ts) si ofera documentul spre descarcare. Fisierul nu pleaca
// din browser; serverul primeste doar textul paragrafelor.
//
// Doua moduri, ca in aplicatia de Mac:
//   - corectura: doar corpul, pe loturi, in paralel;
//   - verificare: tot documentul (corp, antete, subsoluri, note) intr-o singura cerere, cu observatii
//     pe deasupra (date care se contrazic, rubrici goale, formatare rupta, indoieli juridice).
//
// In ambele moduri se verifica si mentiunea obligatorie despre datele cu caracter personal (src/lib/mentiune.ts,
// acelasi cod ca in aplicatia de Mac): lipsa se adauga, cea in alta forma se aduce la forma aprobata, ca revizii.

import {
  analizeazaIntreg, deschideDocx, EroareDocx, paragrafeDeCorectat, paragrafeIntreg, salveazaDocxParti,
  type Aplicare, type Corectura, type ParagrafText, type StareAplicare,
} from "../lib/docx";
import {
  AUTOR_REVIZII, ETICHETA_OBSERVATIE, impartePeLoturi, LIMITA_DOCUMENT, LIMITA_PARAGRAF, LIMITA_VERIFICARE,
  LOTURI_PARALELE, numara, type Observatie,
} from "../lib/corector";
import { aplicaCuMentiune, type RezultatMentiune } from "../lib/mentiune";

const TIP_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_OCTETI = 30 * 1024 * 1024;

const NEAPLICATE: Partial<Record<StareAplicare, string>> = {
  negasita: "de verificat: fragmentul nu a fost găsit exact în document",
  suprapusa: "de verificat: se suprapune cu altă corectură",
  blocata: "de verificat: textul e într-un câmp, într-o revizie existentă sau trece peste un tab",
};

// Ce se spune despre mentiunea obligatorie; una deja in regula nu se mai pomeneste.
const FRAZA_MENTIUNE: Record<RezultatMentiune, string> = {
  prezenta: "",
  corectata: " Mențiunea despre datele cu caracter personal a fost adusă la forma aprobată.",
  adaugata: " Mențiunea despre datele cu caracter personal lipsea și a fost adăugată la sfârșitul documentului.",
  de_verificat: " Mențiunea despre datele cu caracter personal e în altă formă și nu s-a putut înlocui automat: verific-o.",
};

class EroareCerere extends Error {
  status: number; // 0 = reteaua, nu serverul
  constructor(status: number, mesaj: string) {
    super(mesaj);
    this.status = status;
  }
}

async function post<T>(url: string, corp: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corp) });
  } catch {
    throw new EroareCerere(0, "Nu am putut ajunge la server.");
  }
  const d = (await r.json().catch(() => ({}))) as T & { eroare?: string };
  if (!r.ok) throw new EroareCerere(r.status, d.eroare ?? `Eroare ${r.status}.`);
  return d;
}

// Un lot, cu o singura reincercare cand a picat modelul sau reteaua (5xx sau fara raspuns); un refuz
// al serverului (4xx: lot prea mare, corectare incheiata) nu se reincearca.
async function corecteazaLot(id: string, paragrafe: ParagrafText[]): Promise<Corectura[]> {
  const trimite = async () => (await post<{ corecturi: Corectura[] }>(`/api/corector/${id}/lot`, { paragrafe })).corecturi;
  try {
    return await trimite();
  } catch (e) {
    if (e instanceof EroareCerere && e.status >= 400 && e.status < 500) throw e;
    return trimite();
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, clasa?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (clasa) el.className = clasa;
  if (text !== undefined) el.textContent = text;
  return el;
}

// Contextul scurtat la cuvinte intregi, cu "…" unde a fost taiat.
const inceput = (s: string) => (s.length >= 40 ? `…${s.replace(/^\S*\s/, "")}` : s);
const sfarsit = (s: string) => (s.length >= 40 ? `${s.replace(/\s\S*$/, "")}…` : s);

// Corectura propusa de model pentru o observatie, ca sa poata intra in document cand o accepti.
const corecturaDinSolutie = (o: Observatie): Corectura => ({ ...o.corectura!, tip: "formulare", motiv: o.solutie });

// Cand solutia acceptata n-a putut fi pusa (fragment negasit, text blocat), spunem de ce.
function nuSAPutut(aplicari: Aplicare[], o: Observatie): string | null {
  if (!o.corectura) return null;
  const a = aplicari.find((x) => x.i === o.corectura!.i && x.nou === o.corectura!.nou);
  return a && a.stare !== "aplicata" ? NEAPLICATE[a.stare] ?? "nu s-a putut pune în document" : null;
}

// Fiecare observatie are o alegere: cele cu solutie aplicabila intra in document cand le accepti, iar
// celelalte se bifeaza dupa ce le rezolvi de mana (bifa e doar pentru tine, documentul nu se schimba).
function randObservatie(o: Observatie, aleasa: boolean, problema: string | null, comuta: () => void): HTMLLIElement {
  const li = element("li", aleasa && !o.corectura ? "bifata" : undefined);
  li.appendChild(element("div", "tip", ETICHETA_OBSERVATIE[o.tip] ?? ETICHETA_OBSERVATIE.altele));
  li.appendChild(element("p", "text", o.text));
  if (o.solutie) {
    const solutie = element("p", "solutie");
    solutie.appendChild(element("b", undefined, "Soluție: "));
    solutie.appendChild(document.createTextNode(o.solutie));
    li.appendChild(solutie);
  }
  if (!o.corectura) li.appendChild(element("p", "manual", "Nu se poate pune automat: completează tu în document, apoi bifează."));
  const alegere = element("div", "alegere");
  // Butonul „ales” arată starea de acum; celălalt o schimbă.
  const titluri = o.corectura ? ["Acceptă soluția", "Lasă cum e"] : ["Am rezolvat", "Încă nu"];
  for (const [titlu, vrea] of [[titluri[0]!, true], [titluri[1]!, false]] as const) {
    const buton = element("button", vrea === aleasa ? "ales" : undefined, titlu);
    buton.type = "button";
    buton.addEventListener("click", () => { if (vrea !== aleasa) comuta(); });
    alegere.appendChild(buton);
  }
  li.appendChild(alegere);
  if (problema) li.appendChild(element("p", "problema", `Soluția acceptată ${problema.replace(/^de verificat: /, "")}.`));
  return li;
}

function randCorectura(a: Aplicare): HTMLLIElement {
  const li = element("li", a.stare);
  const tip = element("div", "tip", a.tip);
  const motivNeaplicata = NEAPLICATE[a.stare];
  if (motivNeaplicata) tip.appendChild(element("span", "neaplicata", motivNeaplicata));
  const fragment = element("p", "fragment");
  fragment.appendChild(document.createTextNode(inceput(a.inainte)));
  fragment.appendChild(element("del", undefined, a.vechi));
  fragment.appendChild(element("ins", undefined, a.nou));
  fragment.appendChild(document.createTextNode(sfarsit(a.dupa)));
  li.appendChild(tip);
  li.appendChild(fragment);
  if (a.motiv) li.appendChild(element("p", "motiv", a.motiv));
  return li;
}

function porneste(radacina: HTMLElement) {
  const intrare = radacina.querySelector<HTMLInputElement>("[data-fisier]")!;
  const zona = radacina.querySelector<HTMLElement>("[data-zona]")!;
  const stare = radacina.querySelector<HTMLElement>("[data-stare]")!;
  const progres = radacina.querySelector<HTMLElement>("[data-progres]")!;
  const rezultat = radacina.querySelector<HTMLElement>("[data-rezultat]")!;
  const rezumat = radacina.querySelector<HTMLElement>("[data-rezumat]")!;
  const descarca = radacina.querySelector<HTMLAnchorElement>("[data-descarca]")!;
  const lista = radacina.querySelector<HTMLOListElement>("[data-lista]")!;
  const listaObservatii = radacina.querySelector<HTMLUListElement>("[data-observatii]")!;
  let ocupat = false;
  let urlDocument: string | null = null;

  const scrie = (text: string, eroare = false) => {
    stare.textContent = text;
    stare.classList.toggle("eroare", eroare);
  };
  const avans = (fractie: number | null) => {
    progres.hidden = fractie === null;
    progres.querySelector("span")!.style.width = `${Math.round((fractie ?? 0) * 100)}%`;
  };
  const modAles = () => (radacina.querySelector<HTMLInputElement>("[data-mod]:checked")?.value === "verificare" ? "verificare" : "corectura");

  // O singura cerere lunga, fara progres pe parti: aratam secundele, ca sa se vada ca merge.
  const cronometru = (text: string) => {
    const t0 = Date.now();
    const arata = () => scrie(`${text}… ${Math.round((Date.now() - t0) / 1000)} s`);
    arata();
    const ceas = setInterval(arata, 1000);
    return () => clearInterval(ceas);
  };

  const xmlStricat = (xml: string) => new DOMParser().parseFromString(xml, "application/xml").getElementsByTagName("parsererror").length > 0;

  async function corecteaza(fisier: File) {
    if (ocupat) return;
    ocupat = true;
    zona.classList.add("ocupat");
    rezultat.hidden = true;
    let id: string | null = null;
    try {
      if (/\.doc$/i.test(fisier.name)) throw new EroareDocx("Documentele .doc vechi nu se pot citi. Deschide-l în Word și salvează-l ca .docx.");
      if (!/\.docx$/i.test(fisier.name)) throw new EroareDocx("Alege un document Word .docx.");
      if (fisier.size > MAX_OCTETI) throw new EroareDocx("Documentul are peste 30 MB.");
      const mod = modAles();
      scrie(`Se citește ${fisier.name}…`);
      const docx = deschideDocx(new Uint8Array(await fisier.arrayBuffer()));
      const rev = { autor: AUTOR_REVIZII, data: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
      // Tot documentul, in ambele moduri: mentiunea obligatorie poate sta si in subsol. Corpul e prima parte,
      // deci numerele paragrafelor din modul corectura raman valabile.
      const doc = analizeazaIntreg(docx);
      let corecturiModel: Corectura[];
      let observatii: Observatie[] = [];
      let partiale: string | null = null;

      if (mod === "verificare") {
        const paragrafe = paragrafeIntreg(doc).filter((p) => p.text.length <= LIMITA_PARAGRAF);
        const caractere = paragrafe.reduce((s, p) => s + p.text.length, 0);
        if (!paragrafe.length) throw new EroareDocx("Documentul nu are text de verificat.");
        if (caractere > LIMITA_VERIFICARE) {
          throw new EroareDocx(
            `Documentul are ${caractere.toLocaleString("ro-RO")} de caractere de text, peste plafonul de ${LIMITA_VERIFICARE.toLocaleString("ro-RO")} al verificării. ` +
            "Alege „corectură”: merge și pe documente mari, dar doar pe corp."
          );
        }
        id = (await post<{ id: string }>("/api/corector", { fisier: fisier.name, caractere, mod })).id;
        // O singura cerere, deci nu se reincearca: ar fi inca un document intreg platit.
        const opreste = cronometru("Se verifică tot documentul: corp, antet, subsol");
        let r: { corecturi: Corectura[]; observatii: Observatie[] };
        try {
          r = await post(`/api/corector/${id}/verificare`, { paragrafe });
        } finally {
          opreste();
        }
        corecturiModel = r.corecturi;
        observatii = r.observatii;
      } else {
        const paragrafe = paragrafeDeCorectat(doc.parti[0]!.analiza).filter((p) => p.text.length <= LIMITA_PARAGRAF);
        const caractere = paragrafe.reduce((s, p) => s + p.text.length, 0);
        if (!paragrafe.length) throw new EroareDocx("Documentul nu are text de corectat.");
        if (caractere > LIMITA_DOCUMENT) {
          throw new EroareDocx(`Documentul are ${caractere.toLocaleString("ro-RO")} de caractere de text, peste plafonul de 400.000. Împarte-l în părți mai mici.`);
        }

        id = (await post<{ id: string }>("/api/corector", { fisier: fisier.name, caractere, mod })).id;
        const loturi = impartePeLoturi(paragrafe);
        const corecturi: Corectura[][] = loturi.map(() => []);
        let picate = 0;
        let ultimaEroare = "";
        let terminate = 0;
        const durata = loturi.length > LOTURI_PARALELE ? " Poate dura câteva minute." : "";
        const anunta = () => scrie(`Se corectează: ${terminate} din ${numara(loturi.length, "parte", "părți")}…${durata}`);
        anunta();
        avans(0);
        let urmatorul = 0;
        const lucrator = async () => {
          while (urmatorul < loturi.length) {
            const k = urmatorul++;
            try {
              corecturi[k] = await corecteazaLot(id!, loturi[k]!);
            } catch (e) {
              picate++;
              ultimaEroare = (e as Error).message;
            }
            terminate++;
            avans(terminate / loturi.length);
            anunta();
          }
        };
        await Promise.all(Array.from({ length: Math.min(LOTURI_PARALELE, loturi.length) }, lucrator));
        if (picate === loturi.length) throw new Error(ultimaEroare || "Modelul nu a răspuns.");

        corecturiModel = corecturi.flat();
        partiale = picate ? `${numara(picate, "parte", "părți")} din ${loturi.length} nu s-au putut corecta (${ultimaEroare})` : null;
      }

      scrie("Se pun corecturile în document…");
      const numeIesire = `${fisier.name.replace(/\.docx$/i, "")} (corectat).docx`;
      // Soluțiile observațiilor intră în document doar dacă le accepți; documentul se reface la fiecare alegere.
      // „alese” ține și soluțiile acceptate (intră în document), și observațiile bifate ca rezolvate de mână.
      const alese = new Set<number>();
      const arata = () => {
        const solutii = observatii.flatMap((o, k) => (alese.has(k) && o.corectura ? [corecturaDinSolutie(o)] : []));
        const pus = aplicaCuMentiune(docx, doc, [...corecturiModel, ...solutii], rev);
        if (Object.values(pus.xml).some(xmlStricat)) {
          throw new Error("Documentul corectat nu a ieșit valid, așa că nu l-am pus la descărcare.");
        }
        const aplicate = pus.aplicari.filter((a) => a.stare === "aplicata");
        const deVerificat = pus.aplicari.filter((a) => NEAPLICATE[a.stare]);
        if (urlDocument) URL.revokeObjectURL(urlDocument);
        const schimbat = aplicate.length > 0 || pus.mentiune === "adaugata";
        urlDocument = schimbat ? URL.createObjectURL(new Blob([salveazaDocxParti(docx, pus.xml) as Uint8Array<ArrayBuffer>], { type: TIP_DOCX })) : null;
        descarca.hidden = !urlDocument;
        if (urlDocument) {
          descarca.href = urlDocument;
          descarca.download = numeIesire;
        }
        const frazaAplicate = aplicate.length
          ? `${numara(aplicate.length, "corectură", "corecturi")} ${aplicate.length === 1 ? "pusă" : "puse"} în document ca modificări urmărite.`
          : deVerificat.length ? "Nicio corectură nu a putut fi pusă automat în document." : "Nu am găsit greșeli în document.";
        const frazaVerificat = deVerificat.length ? ` ${numara(deVerificat.length, "propunere", "propuneri")} de verificat manual, mai jos.` : "";
        const frazaObservatii = observatii.length ? ` ${numara(observatii.length, "observație", "observații")} pentru tine, mai jos.` : "";
        const solutiiPuse = observatii.filter((o, k) => alese.has(k) && o.corectura).length;
        const bifate = alese.size - solutiiPuse;
        const frazaSolutii = solutiiPuse ? ` ${numara(solutiiPuse, "soluție acceptată", "soluții acceptate")} din observații.` : "";
        const frazaBifate = bifate ? ` ${numara(bifate, "observație bifată", "observații bifate")} de tine.` : "";
        rezumat.textContent = `${frazaAplicate}${frazaVerificat}${FRAZA_MENTIUNE[pus.mentiune]}${frazaObservatii}${frazaSolutii}${frazaBifate}${partiale ? ` Atenție: ${partiale}.` : ""}`;
        listaObservatii.replaceChildren(...observatii.map((o, k) => randObservatie(o, alese.has(k), nuSAPutut(pus.aplicari, o), () => {
          if (alese.has(k)) alese.delete(k); else alese.add(k);
          try {
            arata();
          } catch (e) {
            alese.delete(k);
            scrie((e as Error).message, true);
          }
        })));
        listaObservatii.hidden = !observatii.length;
        lista.replaceChildren(...[...aplicate, ...deVerificat].sort((x, y) => x.i - y.i).map(randCorectura));
        return aplicate.length;
      };
      const aplicate = arata();
      await post(`/api/corector/${id}/gata`, {
        stare: "ok", corecturi: corecturiModel.length, aplicate, observatii: observatii.length, mesaj: partiale,
      }).catch(() => undefined);
      rezultat.hidden = false;
      scrie("");
    } catch (e) {
      const mesaj = (e as Error).message;
      scrie(mesaj, true);
      if (id) await post(`/api/corector/${id}/gata`, { stare: "eroare", mesaj }).catch(() => undefined);
    } finally {
      ocupat = false;
      zona.classList.remove("ocupat");
      avans(null);
    }
  }

  intrare.addEventListener("change", () => {
    const f = intrare.files?.[0];
    intrare.value = "";
    if (f) void corecteaza(f);
  });
  zona.addEventListener("dragover", (e) => { e.preventDefault(); zona.classList.add("peste"); });
  zona.addEventListener("dragleave", () => zona.classList.remove("peste"));
  zona.addEventListener("drop", (e) => {
    e.preventDefault();
    zona.classList.remove("peste");
    const f = e.dataTransfer?.files?.[0];
    if (f) void corecteaza(f);
  });
}

const radacina = document.querySelector<HTMLElement>("[data-corector]");
if (radacina) porneste(radacina);
