// Consum si limite per utilizator: jurnalul intrebarilor, limita pe zi (implicita sau
// per persoana), blocare, ultima vizita, raportul pentru admin.

import { acum } from "./db";
import { ziMinus } from "./data";
import { LIMITA_BUGET_MAX, LIMITA_BUGET_MIN, esteModel } from "./validare";
import { MODEL_CORECTOR_IMPLICIT } from "./corector";

export interface Utilizator {
  email: string;
  limita_zi: number | null;
  blocat: number;
  nota: string | null;
  ultima_vizita: string | null;
  actualizat_la: string;
}

export interface Citare {
  sursa_id: string | null;
  titlu: string;
  pagina: number | null;
}

export interface Intrebare {
  id: string;
  email: string;
  catalog_id: string;
  zi: string;
  intrebare: string;
  raspuns: string;
  citari: string; // JSON
  model: string;
  tokens_intrare: number;
  tokens_iesire: number;
  cost_microdolari: number;
  credite: number;      // creditele planului Z.AI; 0 la Gemini
  stare: "ok" | "eroare" | "refuzat";
  durata_ms: number | null;
  creat_la: string;
}

export interface RandRaport {
  email: string;
  azi: number;
  zile7: number;
  zile30: number;
  total: number;
  tokens_intrare: number;
  tokens_iesire: number;
  cost_microdolari: number;
  cost_30_microdolari: number;
  credite_7: number;
  credite_30: number;
  documente_30: number;   // corectari reusite in 30 de zile
  limita_zi: number | null;
  blocat: number;
  nota: string | null;
  ultima_vizita: string | null;
}

export const SETARI_IMPLICITE: Record<string, string> = {
  limita_zi_implicita: "15",
  model: "gemini-3.5-flash-lite",
  buget_context: String(LIMITA_BUGET_MAX),
  model_corector: MODEL_CORECTOR_IMPLICIT,
};

// ---------------------------------------------------------------- setari

export async function citesteSetare(db: D1Database, cheie: string): Promise<string> {
  const r = await db.prepare("SELECT valoare FROM setari WHERE cheie = ?").bind(cheie).first<{ valoare: string }>();
  return r?.valoare ?? SETARI_IMPLICITE[cheie] ?? "";
}

export async function seteazaSetare(db: D1Database, cheie: string, valoare: string): Promise<void> {
  await db
    .prepare("INSERT INTO setari (cheie, valoare) VALUES (?, ?) ON CONFLICT(cheie) DO UPDATE SET valoare = excluded.valoare")
    .bind(cheie, valoare)
    .run();
}

export async function limitaImplicita(db: D1Database): Promise<number> {
  const n = Number(await citesteSetare(db, "limita_zi_implicita"));
  return Number.isInteger(n) && n >= 0 ? n : 15;
}

// Caracterele trimise modelului GLM la o intrebare; in afara limitelor se revine la implicit.
export async function citesteBuget(db: D1Database): Promise<number> {
  const n = Number(await citesteSetare(db, "buget_context"));
  return Number.isInteger(n) && n >= LIMITA_BUGET_MIN && n <= LIMITA_BUGET_MAX ? n : LIMITA_BUGET_MAX;
}

// Modelul corectorului de documente; un nume necunoscut revine la implicit.
export async function modelCorector(db: D1Database): Promise<string> {
  const m = await citesteSetare(db, "model_corector");
  return esteModel(m) ? m : MODEL_CORECTOR_IMPLICIT;
}

// ---------------------------------------------------------------- utilizatori

const COL_UTILIZATOR = "email, limita_zi, blocat, nota, ultima_vizita, actualizat_la";

export async function citesteUtilizator(db: D1Database, email: string): Promise<Utilizator | null> {
  return db.prepare(`SELECT ${COL_UTILIZATOR} FROM utilizatori WHERE email = ?`).bind(email).first<Utilizator>();
}

export async function limitaPentru(db: D1Database, email: string): Promise<number> {
  const u = await citesteUtilizator(db, email);
  if (u && u.limita_zi !== null) return u.limita_zi;
  return limitaImplicita(db);
}

export async function esteBlocat(db: D1Database, email: string): Promise<boolean> {
  const u = await citesteUtilizator(db, email);
  return !!u && u.blocat === 1;
}

// Ultima vizita, o data pe zi. Nu atinge limita/blocarea.
export async function atingeVizita(db: D1Database, email: string, zi: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO utilizatori (email, limita_zi, blocat, nota, ultima_vizita, actualizat_la)
       VALUES (?, NULL, 0, NULL, ?, ?)
       ON CONFLICT(email) DO UPDATE SET ultima_vizita = excluded.ultima_vizita
       WHERE ultima_vizita IS NULL OR ultima_vizita < excluded.ultima_vizita`
    )
    .bind(email, zi, acum())
    .run();
}

export async function seteazaUtilizator(
  db: D1Database, email: string, { limita_zi, blocat, nota }: { limita_zi: number | null; blocat: boolean; nota: string | null }
): Promise<Utilizator> {
  await db
    .prepare(
      `INSERT INTO utilizatori (email, limita_zi, blocat, nota, ultima_vizita, actualizat_la)
       VALUES (?, ?, ?, ?, NULL, ?)
       ON CONFLICT(email) DO UPDATE SET limita_zi = excluded.limita_zi, blocat = excluded.blocat,
         nota = excluded.nota, actualizat_la = excluded.actualizat_la`
    )
    .bind(email, limita_zi, blocat ? 1 : 0, nota, acum())
    .run();
  const u = await citesteUtilizator(db, email);
  if (!u) throw new Error("utilizatorul lipseste dupa scriere");
  return u;
}

// ---------------------------------------------------------------- intrebari

const COL_INTREBARE =
  "id, email, catalog_id, zi, intrebare, raspuns, citari, model, tokens_intrare, tokens_iesire, cost_microdolari, credite, stare, durata_ms, creat_la";

// Doar intrebarile reusite conteaza la limita; erorile noastre nu se pun in carca omului.
export async function intrebariAzi(db: D1Database, email: string, zi: string): Promise<number> {
  const r = await db
    .prepare("SELECT count(*) AS n FROM intrebari WHERE email = ? AND zi = ? AND stare = 'ok'")
    .bind(email, zi)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export interface IntrebareNoua {
  email: string;
  catalog_id: string;
  zi: string;
  intrebare: string;
  raspuns: string;
  citari: Citare[];
  model: string;
  tokens_intrare: number;
  tokens_iesire: number;
  cost_microdolari: number;
  credite: number;
  stare: "ok" | "eroare" | "refuzat";
  durata_ms: number | null;
}

export async function inregistreazaIntrebare(db: D1Database, i: IntrebareNoua): Promise<Intrebare> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO intrebari (${COL_INTREBARE}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, i.email, i.catalog_id, i.zi, i.intrebare, i.raspuns, JSON.stringify(i.citari), i.model,
      i.tokens_intrare, i.tokens_iesire, i.cost_microdolari, i.credite, i.stare, i.durata_ms, acum()
    )
    .run();
  const r = await db.prepare(`SELECT ${COL_INTREBARE} FROM intrebari WHERE id = ?`).bind(id).first<Intrebare>();
  if (!r) throw new Error("intrebarea lipseste dupa inserare");
  return r;
}

export async function istoricUtilizator(db: D1Database, email: string, n = 50): Promise<Intrebare[]> {
  const r = await db
    .prepare(`SELECT ${COL_INTREBARE} FROM intrebari WHERE email = ? ORDER BY creat_la DESC LIMIT ?`)
    .bind(email, n)
    .all<Intrebare>();
  return r.results;
}

// Intrebarile reusite ale unui utilizator intr-un catalog, cele mai noi `n`, in ordine cronologica.
// Cu `inainte` (un `creat_la`), doar cele strict mai vechi: pagina urmatoare pentru "arata mai multe".
export async function istoricCatalog(
  db: D1Database, email: string, catalogId: string, n = 30, inainte?: string
): Promise<Intrebare[]> {
  const r = await db
    .prepare(
      `SELECT ${COL_INTREBARE} FROM (
         SELECT ${COL_INTREBARE} FROM intrebari
         WHERE email = ?1 AND catalog_id = ?2 AND stare = 'ok' AND (?4 IS NULL OR creat_la < ?4)
         ORDER BY creat_la DESC LIMIT ?3
       ) ORDER BY creat_la ASC`
    )
    .bind(email, catalogId, n, inainte ?? null)
    .all<Intrebare>();
  return r.results;
}

// ---------------------------------------------------------------- corectari

// Jurnalul corectorului de documente: o linie pe document, fara textul lui. Nu conteaza la limita pe zi;
// costul intra in totaluri prin vederea `cheltuieli` (intrebari + corectari).
export type ModCorectare = "corectura" | "verificare";

export interface Corectare {
  id: string;
  email: string;
  zi: string;
  fisier: string;
  mod: ModCorectare;
  caractere: number;
  caractere_trimise: number; // adunate pe loturi, si la cele picate dupa ce modelul a raspuns
  loturi: number;
  corecturi: number;
  aplicate: number;
  observatii: number;
  model: string;
  tokens_intrare: number;
  tokens_iesire: number;
  cost_microdolari: number;
  credite: number;
  stare: "in_curs" | "ok" | "eroare";
  mesaj: string | null;
  durata_ms: number | null;
  creat_la: string;
  actualizat_la: string;
}

const COL_CORECTARE =
  "id, email, zi, fisier, mod, caractere, caractere_trimise, loturi, corecturi, aplicate, observatii, model, tokens_intrare, tokens_iesire, cost_microdolari, credite, stare, mesaj, durata_ms, creat_la, actualizat_la";

export async function creeazaCorectare(
  db: D1Database, c: { email: string; zi: string; fisier: string; mod: ModCorectare; caractere: number; model: string }
): Promise<Corectare> {
  const id = crypto.randomUUID();
  const moment = acum();
  await db
    .prepare("INSERT INTO corectari (id, email, zi, fisier, mod, caractere, model, stare, creat_la, actualizat_la) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_curs', ?, ?)")
    .bind(id, c.email, c.zi, c.fisier, c.mod, c.caractere, c.model, moment, moment)
    .run();
  const r = await citesteCorectare(db, id);
  if (!r) throw new Error("corectarea lipseste dupa inserare");
  return r;
}

export async function citesteCorectare(db: D1Database, id: string): Promise<Corectare | null> {
  return db.prepare(`SELECT ${COL_CORECTARE} FROM corectari WHERE id = ?`).bind(id).first<Corectare>();
}

// Consumul unui lot, adunat in aceeasi instructiune: loturile unei corectari merg in paralel.
// `reusit` = modelul a dat corecturi lizibile (altfel se adauga doar costul si caracterele).
export async function adaugaLaCorectare(
  db: D1Database, id: string,
  x: { caractere: number; tokens_intrare: number; tokens_iesire: number; cost_microdolari: number; credite: number; reusit: boolean }
): Promise<void> {
  await db
    .prepare(
      `UPDATE corectari SET loturi = loturi + ?, caractere_trimise = caractere_trimise + ?,
         tokens_intrare = tokens_intrare + ?, tokens_iesire = tokens_iesire + ?,
         cost_microdolari = cost_microdolari + ?, credite = credite + ?, actualizat_la = ?
       WHERE id = ?`
    )
    .bind(x.reusit ? 1 : 0, x.caractere, x.tokens_intrare, x.tokens_iesire, x.cost_microdolari, x.credite, acum(), id)
    .run();
}

// Starea finala, o singura data (doar din in_curs).
export async function incheieCorectare(
  db: D1Database, id: string,
  x: { corecturi: number; aplicate: number; observatii?: number; stare: "ok" | "eroare"; mesaj: string | null; durata_ms: number }
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE corectari SET corecturi = ?, aplicate = ?, observatii = ?, stare = ?, mesaj = ?, durata_ms = ?, actualizat_la = ?
       WHERE id = ? AND stare = 'in_curs'`
    )
    .bind(x.corecturi, x.aplicate, x.observatii ?? 0, x.stare, x.mesaj, x.durata_ms, acum(), id)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function corectariUtilizator(db: D1Database, email: string, n = 20): Promise<Corectare[]> {
  const r = await db
    .prepare(`SELECT ${COL_CORECTARE} FROM corectari WHERE email = ? ORDER BY creat_la DESC LIMIT ?`)
    .bind(email, n)
    .all<Corectare>();
  return r.results;
}

// ---------------------------------------------------------------- raport

// Toti cei care au pus intrebari sau au setari/vizite, cu totaluri pe azi / 7 zile / 30 zile / tot.
export async function raportUtilizatori(db: D1Database, azi: string): Promise<RandRaport[]> {
  const de7 = ziMinus(azi, 6);
  const de30 = ziMinus(azi, 29);
  const r = await db
    .prepare(
      `WITH emailuri AS (
         SELECT email FROM intrebari UNION SELECT email FROM utilizatori UNION SELECT email FROM corectari
       ),
       q AS (
         SELECT email,
                sum(CASE WHEN stare = 'ok' AND zi = ?1 THEN 1 ELSE 0 END) AS azi,
                sum(CASE WHEN stare = 'ok' AND zi >= ?2 THEN 1 ELSE 0 END) AS zile7,
                sum(CASE WHEN stare = 'ok' AND zi >= ?3 THEN 1 ELSE 0 END) AS zile30,
                sum(CASE WHEN stare = 'ok' THEN 1 ELSE 0 END) AS total
         FROM intrebari GROUP BY email
       ),
       c AS (
         SELECT email,
                sum(tokens_intrare) AS tokens_intrare, sum(tokens_iesire) AS tokens_iesire,
                sum(cost_microdolari) AS cost_microdolari,
                sum(CASE WHEN zi >= ?3 THEN cost_microdolari ELSE 0 END) AS cost_30_microdolari,
                sum(CASE WHEN zi >= ?2 THEN credite ELSE 0 END) AS credite_7,
                sum(CASE WHEN zi >= ?3 THEN credite ELSE 0 END) AS credite_30
         FROM cheltuieli GROUP BY email
       ),
       d AS (
         SELECT email, sum(CASE WHEN stare = 'ok' AND zi >= ?3 THEN 1 ELSE 0 END) AS documente_30
         FROM corectari GROUP BY email
       )
       SELECT e.email,
              coalesce(q.azi, 0) AS azi, coalesce(q.zile7, 0) AS zile7, coalesce(q.zile30, 0) AS zile30, coalesce(q.total, 0) AS total,
              coalesce(c.tokens_intrare, 0) AS tokens_intrare, coalesce(c.tokens_iesire, 0) AS tokens_iesire,
              coalesce(c.cost_microdolari, 0) AS cost_microdolari, coalesce(c.cost_30_microdolari, 0) AS cost_30_microdolari,
              coalesce(c.credite_7, 0) AS credite_7, coalesce(c.credite_30, 0) AS credite_30,
              coalesce(d.documente_30, 0) AS documente_30,
              u.limita_zi, coalesce(u.blocat, 0) AS blocat, u.nota, u.ultima_vizita
       FROM emailuri e
       LEFT JOIN q ON q.email = e.email
       LEFT JOIN c ON c.email = e.email
       LEFT JOIN d ON d.email = e.email
       LEFT JOIN utilizatori u ON u.email = e.email
       ORDER BY zile30 DESC, e.email`
    )
    .bind(azi, de7, de30)
    .all<RandRaport>();
  return r.results;
}

// Totalurile unui singur utilizator (pagina /consum): intrebari si cost pe azi / 30 zile / tot.
export interface ConsumPropriu {
  azi: number; zile30: number; total: number;
  cost_azi: number; cost_30: number; cost_total: number;
  tokens_total: number;
}

export async function consumUtilizator(db: D1Database, email: string, azi: string): Promise<ConsumPropriu> {
  const de30 = ziMinus(azi, 29);
  const r = await db
    .prepare(
      `WITH q AS (
         SELECT coalesce(sum(CASE WHEN stare = 'ok' AND zi = ?1 THEN 1 ELSE 0 END), 0) AS azi,
                coalesce(sum(CASE WHEN stare = 'ok' AND zi >= ?2 THEN 1 ELSE 0 END), 0) AS zile30,
                coalesce(sum(CASE WHEN stare = 'ok' THEN 1 ELSE 0 END), 0) AS total
         FROM intrebari WHERE email = ?3
       ),
       c AS (
         SELECT coalesce(sum(CASE WHEN zi = ?1 THEN cost_microdolari ELSE 0 END), 0) AS cost_azi,
                coalesce(sum(CASE WHEN zi >= ?2 THEN cost_microdolari ELSE 0 END), 0) AS cost_30,
                coalesce(sum(cost_microdolari), 0) AS cost_total,
                coalesce(sum(tokens_intrare + tokens_iesire), 0) AS tokens_total
         FROM cheltuieli WHERE email = ?3
       )
       SELECT q.azi, q.zile30, q.total, c.cost_azi, c.cost_30, c.cost_total, c.tokens_total FROM q, c`
    )
    .bind(azi, de30, email)
    .first<ConsumPropriu>();
  return r ?? { azi: 0, zile30: 0, total: 0, cost_azi: 0, cost_30: 0, cost_total: 0, tokens_total: 0 };
}

// Costul total al tuturor (de la inceput, intrebari si corectari), pentru bara de sus a adminului.
export async function costTotalToti(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT coalesce(sum(cost_microdolari), 0) AS c FROM cheltuieli").first<{ c: number }>();
  return r?.c ?? 0;
}

// Costul propriu de la inceput (intrebari si corectari), pentru bara de sus.
export async function costPropriu(db: D1Database, email: string): Promise<number> {
  const r = await db.prepare("SELECT coalesce(sum(cost_microdolari), 0) AS c FROM cheltuieli WHERE email = ?").bind(email).first<{ c: number }>();
  return r?.c ?? 0;
}

// Creditele Z.AI consumate de toti in ultimele 7 zile (planul are cota saptamanala), pentru antetul raportului.
export async function crediteUltimele7Zile(db: D1Database, azi: string): Promise<number> {
  const r = await db
    .prepare("SELECT coalesce(sum(credite), 0) AS c FROM cheltuieli WHERE zi >= ?")
    .bind(ziMinus(azi, 6))
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// Costul total (microdolari) al intrebarilor din ultimele 30 de zile, pentru antetul raportului.
export async function costUltimele30Zile(db: D1Database, azi: string): Promise<number> {
  const r = await db
    .prepare("SELECT coalesce(sum(cost_microdolari), 0) AS c FROM cheltuieli WHERE zi >= ?")
    .bind(ziMinus(azi, 29))
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// Mereu in dolari: sub un dolar cu patru zecimale (3600 -> "0,0036 $"), de la un dolar cu doua
// (1_250_000 -> "1,25 $"). Zero ramane "0 $".
export function fmtCost(microdolari: number): string {
  if (microdolari === 0) return "0 $";
  const d = microdolari / 1_000_000;
  return `${(d < 1 ? d.toFixed(4) : d.toFixed(2)).replace(".", ",")} $`;
}

// Creditele planului Z.AI: 33.5 -> "33,5"; 1234.56 -> "1.234,6"; intregii fara zecimale.
export function fmtCredite(credite: number): string {
  const rotunjit = Math.round(credite * 10) / 10;
  const [intreg, zecimal] = rotunjit.toFixed(1).split(".") as [string, string];
  const cuMii = intreg.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return zecimal === "0" ? cuMii : `${cuMii},${zecimal}`;
}
