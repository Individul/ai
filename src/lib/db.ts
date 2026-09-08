// Acces la date. Fara owner: cataloagele sunt comune tuturor celor din Access; doar
// adminul scrie (middleware). Fisierele sunt in R2, aici doar metadatele lor.

import type { Culoare, Pictograma, Stare, TipSursa } from "./validare";

export interface Catalog {
  id: string;
  slug: string;
  titlu: string;
  descriere: string;
  pictograma: Pictograma;
  culoare: Culoare;
  stare: Stare;
  url_notebook: string;
  note_utilizare: string;
  ordine: number;
  magazin: string | null;          // fileSearchStores/... la Google; NULL = inca fara
  creat_la: string;
  actualizat_la: string;
}

export interface CatalogRezumat extends Catalog {
  nr_surse: number;
  nr_audio: number;
}

export interface Sursa {
  id: string;
  catalog_id: string;
  titlu: string;
  tip: TipSursa;
  numar: string | null;
  data_emiterii: string | null;
  url: string | null;
  fisier_nume: string | null;
  fisier_marime: number | null;
  doc_google: string | null;       // fileSearchStores/x/documents/y
  indexare: StareIndexare;
  indexare_mesaj: string | null;
  operatie_google: string | null;  // operations/... cat timp e in_curs
  ordine: number;
  creat_la: string;
  actualizat_la: string;
}

export type StareIndexare = "neindexat" | "in_curs" | "gata" | "eroare";

export interface Audio {
  id: string;
  catalog_id: string;
  titlu: string;
  descriere: string;
  durata_s: number | null;
  data: string;
  tip_mime: string;
  fisier_nume: string;
  marime: number;
  ordine: number;
  creat_la: string;
}

export type RezultatActualizare<T> =
  | { ok: true; rand: T }
  | { ok: false; motiv: "lipsa" }
  | { ok: false; motiv: "conflict"; rand: T };

const COL_CATALOG = "id, slug, titlu, descriere, pictograma, culoare, stare, url_notebook, note_utilizare, ordine, magazin, creat_la, actualizat_la";
const COL_SURSA = "id, catalog_id, titlu, tip, numar, data_emiterii, url, fisier_nume, fisier_marime, doc_google, indexare, indexare_mesaj, operatie_google, ordine, creat_la, actualizat_la";
const COL_AUDIO = "id, catalog_id, titlu, descriere, durata_s, data, tip_mime, fisier_nume, marime, ordine, creat_la";

// Timp strict crescator: in Workers `Date.now()` poate sta pe loc intr-o cerere, iar
// concurenta optimista compara `actualizat_la`, deci doua scrieri nu pot primi aceeasi valoare.
let ultimMs = 0;
export function acum(): string {
  let ms = Date.now();
  if (ms <= ultimMs) ms = ultimMs + 1;
  ultimMs = ms;
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------- cataloage

export interface CampuriCatalog {
  titlu: string;
  descriere?: string;
  pictograma?: Pictograma;
  culoare?: Culoare;
  stare?: Stare;
  url_notebook?: string;
  note_utilizare?: string;
}

export async function listeazaCataloage(db: D1Database, { cuArhivate = false } = {}): Promise<CatalogRezumat[]> {
  const r = await db
    .prepare(
      `SELECT ${COL_CATALOG},
              (SELECT count(*) FROM surse s WHERE s.catalog_id = cataloage.id) AS nr_surse,
              (SELECT count(*) FROM audio a WHERE a.catalog_id = cataloage.id) AS nr_audio
       FROM cataloage
       WHERE ? OR stare <> 'arhivat'
       ORDER BY ordine, creat_la`
    )
    .bind(cuArhivate ? 1 : 0)
    .all<CatalogRezumat>();
  return r.results;
}

export async function citesteCatalog(db: D1Database, id: string): Promise<Catalog | null> {
  return db.prepare(`SELECT ${COL_CATALOG} FROM cataloage WHERE id = ?`).bind(id).first<Catalog>();
}

export async function citesteCatalogDupaSlug(db: D1Database, slug: string): Promise<Catalog | null> {
  return db.prepare(`SELECT ${COL_CATALOG} FROM cataloage WHERE slug = ?`).bind(slug).first<Catalog>();
}

// Slugul se calculeaza din titlu la creare si ramane stabil (e in URL). La coliziune: -2, -3...
async function slugLiber(db: D1Database, baza: string): Promise<string> {
  const r = await db
    .prepare("SELECT slug FROM cataloage WHERE slug = ? OR slug GLOB ?")
    .bind(baza, `${baza}-[0-9]*`)
    .all<{ slug: string }>();
  const ocupate = new Set(r.results.map((x) => x.slug));
  if (!ocupate.has(baza)) return baza;
  for (let n = 2; ; n++) if (!ocupate.has(`${baza}-${n}`)) return `${baza}-${n}`;
}

async function urmatoareaOrdine(db: D1Database, tabel: "cataloage" | "surse" | "audio", catalogId?: string): Promise<number> {
  const q = catalogId
    ? db.prepare(`SELECT coalesce(max(ordine), -1) + 1 AS n FROM ${tabel} WHERE catalog_id = ?`).bind(catalogId)
    : db.prepare(`SELECT coalesce(max(ordine), -1) + 1 AS n FROM ${tabel}`);
  const r = await q.first<{ n: number }>();
  return r?.n ?? 0;
}

export async function creeazaCatalog(db: D1Database, slugDorit: string, c: CampuriCatalog): Promise<Catalog> {
  const t = acum();
  const id = crypto.randomUUID();
  const slug = await slugLiber(db, slugDorit);
  const ordine = await urmatoareaOrdine(db, "cataloage");
  await db
    .prepare(
      `INSERT INTO cataloage (id, slug, titlu, descriere, pictograma, culoare, stare, url_notebook, note_utilizare, ordine, creat_la, actualizat_la)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, slug, c.titlu, c.descriere ?? "", c.pictograma ?? "carte", c.culoare ?? "violet", c.stare ?? "in_lucru",
      c.url_notebook ?? "", c.note_utilizare ?? "", ordine, t, t
    )
    .run();
  const catalog = await citesteCatalog(db, id);
  if (!catalog) throw new Error("catalogul lipseste dupa inserare");
  return catalog;
}

// Compare-and-set pe `actualizat_la`: scrie doar daca randul nu s-a schimbat de la `baza`
// (doua taburi de admin deschise pe acelasi catalog).
export async function actualizeazaCatalog(
  db: D1Database, id: string, c: Required<CampuriCatalog>, baza: string
): Promise<RezultatActualizare<Catalog>> {
  const t = acum();
  const r = await db
    .prepare(
      `UPDATE cataloage SET titlu = ?, descriere = ?, pictograma = ?, culoare = ?, stare = ?, url_notebook = ?, note_utilizare = ?, actualizat_la = ?
       WHERE id = ? AND actualizat_la = ?`
    )
    .bind(c.titlu, c.descriere, c.pictograma, c.culoare, c.stare, c.url_notebook, c.note_utilizare, t, id, baza)
    .run();
  const curent = await citesteCatalog(db, id);
  if (!curent) return { ok: false, motiv: "lipsa" };
  if (r.meta.changes > 0) return { ok: true, rand: curent };
  return { ok: false, motiv: "conflict", rand: curent };
}

export async function seteazaMagazin(db: D1Database, id: string, magazin: string): Promise<void> {
  await db.prepare("UPDATE cataloage SET magazin = ? WHERE id = ?").bind(magazin, id).run();
}

// Numarul de surse indexate (cu document la Google), pentru a sti daca chatul are ce cauta.
export async function surseIndexate(db: D1Database, catalogId: string): Promise<number> {
  const r = await db
    .prepare("SELECT count(*) AS n FROM surse WHERE catalog_id = ? AND indexare = 'gata'")
    .bind(catalogId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function seteazaStareCatalog(db: D1Database, id: string, stare: Stare): Promise<boolean> {
  const r = await db.prepare("UPDATE cataloage SET stare = ?, actualizat_la = ? WHERE id = ?").bind(stare, acum(), id).run();
  return r.meta.changes > 0;
}

export async function arhiveazaCatalog(db: D1Database, id: string): Promise<boolean> {
  return seteazaStareCatalog(db, id, "arhivat");
}

// "Ultima actualizare" a catalogului se misca la orice schimbare in surse sau audio.
async function atingeCatalog(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE cataloage SET actualizat_la = ? WHERE id = ?").bind(acum(), id).run();
}

// Mutare cu un pas in sus (-1) sau in jos (+1) intr-o lista ordonata. Renumeroteaza lista
// (0..n-1) ca ordinea sa fie mereu fara goluri si fara egalitati, apoi schimba vecinii.
// Intoarce false cand randul lipseste sau e deja la capat.
async function muta(
  db: D1Database, tabel: "cataloage" | "surse" | "audio", id: string, dir: -1 | 1, catalogId?: string
): Promise<boolean> {
  const q = catalogId
    ? db.prepare(`SELECT id FROM ${tabel} WHERE catalog_id = ? ORDER BY ordine, creat_la`).bind(catalogId)
    : db.prepare(`SELECT id FROM ${tabel} ORDER BY ordine, creat_la`);
  const ids = (await q.all<{ id: string }>()).results.map((x) => x.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return false;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  await db.batch(ids.map((x, n) => db.prepare(`UPDATE ${tabel} SET ordine = ? WHERE id = ?`).bind(n, x)));
  if (catalogId) await atingeCatalog(db, catalogId);
  return true;
}

export async function mutaCatalog(db: D1Database, id: string, dir: -1 | 1): Promise<boolean> {
  return muta(db, "cataloage", id, dir);
}

// ---------------------------------------------------------------- surse

export interface CampuriSursa {
  titlu: string;
  tip: TipSursa;
  numar: string | null;
  data_emiterii: string | null;
  url: string | null;
}

export async function listeazaSurse(db: D1Database, catalogId: string): Promise<Sursa[]> {
  const r = await db
    .prepare(`SELECT ${COL_SURSA} FROM surse WHERE catalog_id = ? ORDER BY ordine, creat_la`)
    .bind(catalogId)
    .all<Sursa>();
  return r.results;
}

export async function citesteSursa(db: D1Database, id: string): Promise<Sursa | null> {
  return db.prepare(`SELECT ${COL_SURSA} FROM surse WHERE id = ?`).bind(id).first<Sursa>();
}

export async function adaugaSursa(db: D1Database, catalogId: string, s: CampuriSursa): Promise<Sursa> {
  const t = acum();
  const id = crypto.randomUUID();
  const ordine = await urmatoareaOrdine(db, "surse", catalogId);
  await db
    .prepare(
      `INSERT INTO surse (id, catalog_id, titlu, tip, numar, data_emiterii, url, fisier_nume, fisier_marime, ordine, creat_la, actualizat_la)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
    )
    .bind(id, catalogId, s.titlu, s.tip, s.numar, s.data_emiterii, s.url, ordine, t, t)
    .run();
  await atingeCatalog(db, catalogId);
  const sursa = await citesteSursa(db, id);
  if (!sursa) throw new Error("sursa lipseste dupa inserare");
  return sursa;
}

export async function actualizeazaSursa(db: D1Database, id: string, s: CampuriSursa): Promise<Sursa | null> {
  const r = await db
    .prepare("UPDATE surse SET titlu = ?, tip = ?, numar = ?, data_emiterii = ?, url = ?, actualizat_la = ? WHERE id = ?")
    .bind(s.titlu, s.tip, s.numar, s.data_emiterii, s.url, acum(), id)
    .run();
  if (r.meta.changes === 0) return null;
  const sursa = await citesteSursa(db, id);
  if (sursa) await atingeCatalog(db, sursa.catalog_id);
  return sursa;
}

// Dupa ce fisierul a ajuns (sau a fost sters) in R2. `nume` null = fara fisier.
export async function seteazaFisierSursa(
  db: D1Database, id: string, nume: string | null, marime: number | null
): Promise<Sursa | null> {
  const r = await db
    .prepare("UPDATE surse SET fisier_nume = ?, fisier_marime = ?, actualizat_la = ? WHERE id = ?")
    .bind(nume, marime, acum(), id)
    .run();
  if (r.meta.changes === 0) return null;
  const sursa = await citesteSursa(db, id);
  if (sursa) await atingeCatalog(db, sursa.catalog_id);
  return sursa;
}

export async function seteazaIndexare(
  db: D1Database, id: string,
  i: { indexare: StareIndexare; doc_google?: string | null; operatie_google?: string | null; indexare_mesaj?: string | null }
): Promise<void> {
  await db
    .prepare("UPDATE surse SET indexare = ?, doc_google = ?, operatie_google = ?, indexare_mesaj = ? WHERE id = ?")
    .bind(i.indexare, i.doc_google ?? null, i.operatie_google ?? null, i.indexare_mesaj ?? null, id)
    .run();
}

// Doar randul; obiectul din R2 se sterge inainte, de cine apeleaza.
export async function stergeSursa(db: D1Database, id: string): Promise<boolean> {
  const sursa = await citesteSursa(db, id);
  if (!sursa) return false;
  await db.prepare("DELETE FROM surse WHERE id = ?").bind(id).run();
  await atingeCatalog(db, sursa.catalog_id);
  return true;
}

export async function mutaSursa(db: D1Database, id: string, dir: -1 | 1): Promise<boolean> {
  const sursa = await citesteSursa(db, id);
  if (!sursa) return false;
  return muta(db, "surse", id, dir, sursa.catalog_id);
}

// ---------------------------------------------------------------- audio

export interface CampuriAudio {
  titlu: string;
  descriere: string;
  data: string;
  durata_s: number | null;
}

export interface FisierAudio {
  tip_mime: string;
  fisier_nume: string;
  marime: number;
}

export async function listeazaAudio(db: D1Database, catalogId: string): Promise<Audio[]> {
  const r = await db
    .prepare(`SELECT ${COL_AUDIO} FROM audio WHERE catalog_id = ? ORDER BY ordine, creat_la`)
    .bind(catalogId)
    .all<Audio>();
  return r.results;
}

export async function citesteAudio(db: D1Database, id: string): Promise<Audio | null> {
  return db.prepare(`SELECT ${COL_AUDIO} FROM audio WHERE id = ?`).bind(id).first<Audio>();
}

// `id` vine de la apelant: obiectul R2 se pune sub audio/{id} INAINTE de rand, ca sa nu
// existe rand fara fisier.
export async function adaugaAudio(
  db: D1Database, id: string, catalogId: string, a: CampuriAudio, f: FisierAudio
): Promise<Audio> {
  const t = acum();
  const ordine = await urmatoareaOrdine(db, "audio", catalogId);
  await db
    .prepare(
      `INSERT INTO audio (id, catalog_id, titlu, descriere, durata_s, data, tip_mime, fisier_nume, marime, ordine, creat_la)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, catalogId, a.titlu, a.descriere, a.durata_s, a.data, f.tip_mime, f.fisier_nume, f.marime, ordine, t)
    .run();
  await atingeCatalog(db, catalogId);
  const audio = await citesteAudio(db, id);
  if (!audio) throw new Error("audio lipseste dupa inserare");
  return audio;
}

export async function actualizeazaAudio(db: D1Database, id: string, a: CampuriAudio): Promise<Audio | null> {
  const r = await db
    .prepare("UPDATE audio SET titlu = ?, descriere = ?, data = ?, durata_s = ? WHERE id = ?")
    .bind(a.titlu, a.descriere, a.data, a.durata_s, id)
    .run();
  if (r.meta.changes === 0) return null;
  const audio = await citesteAudio(db, id);
  if (audio) await atingeCatalog(db, audio.catalog_id);
  return audio;
}

export async function stergeAudio(db: D1Database, id: string): Promise<boolean> {
  const audio = await citesteAudio(db, id);
  if (!audio) return false;
  await db.prepare("DELETE FROM audio WHERE id = ?").bind(id).run();
  await atingeCatalog(db, audio.catalog_id);
  return true;
}

export async function mutaAudio(db: D1Database, id: string, dir: -1 | 1): Promise<boolean> {
  const audio = await citesteAudio(db, id);
  if (!audio) return false;
  return muta(db, "audio", id, dir, audio.catalog_id);
}
