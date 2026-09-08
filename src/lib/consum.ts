// Consum si limite per utilizator: jurnalul intrebarilor, limita pe zi (implicita sau
// per persoana), blocare, ultima vizita, raportul pentru admin.

import { acum } from "./db";
import { ziMinus } from "./data";
import { LIMITA_BUGET_MAX, LIMITA_BUGET_MIN } from "./validare";

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
  limita_zi: number | null;
  blocat: number;
  nota: string | null;
  ultima_vizita: string | null;
}

export const SETARI_IMPLICITE: Record<string, string> = {
  limita_zi_implicita: "15",
  model: "gemini-3.5-flash-lite",
  buget_context: String(LIMITA_BUGET_MAX),
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
export async function istoricCatalog(db: D1Database, email: string, catalogId: string, n = 30): Promise<Intrebare[]> {
  const r = await db
    .prepare(
      `SELECT ${COL_INTREBARE} FROM (
         SELECT ${COL_INTREBARE} FROM intrebari WHERE email = ? AND catalog_id = ? AND stare = 'ok'
         ORDER BY creat_la DESC LIMIT ?
       ) ORDER BY creat_la ASC`
    )
    .bind(email, catalogId, n)
    .all<Intrebare>();
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
         SELECT email FROM intrebari UNION SELECT email FROM utilizatori
       )
       SELECT e.email,
              coalesce(sum(CASE WHEN i.stare = 'ok' AND i.zi = ?1 THEN 1 ELSE 0 END), 0) AS azi,
              coalesce(sum(CASE WHEN i.stare = 'ok' AND i.zi >= ?2 THEN 1 ELSE 0 END), 0) AS zile7,
              coalesce(sum(CASE WHEN i.stare = 'ok' AND i.zi >= ?3 THEN 1 ELSE 0 END), 0) AS zile30,
              coalesce(sum(CASE WHEN i.stare = 'ok' THEN 1 ELSE 0 END), 0) AS total,
              coalesce(sum(i.tokens_intrare), 0) AS tokens_intrare,
              coalesce(sum(i.tokens_iesire), 0) AS tokens_iesire,
              coalesce(sum(i.cost_microdolari), 0) AS cost_microdolari,
              coalesce(sum(CASE WHEN i.zi >= ?3 THEN i.cost_microdolari ELSE 0 END), 0) AS cost_30_microdolari,
              coalesce(sum(CASE WHEN i.zi >= ?2 THEN i.credite ELSE 0 END), 0) AS credite_7,
              coalesce(sum(CASE WHEN i.zi >= ?3 THEN i.credite ELSE 0 END), 0) AS credite_30,
              u.limita_zi, coalesce(u.blocat, 0) AS blocat, u.nota, u.ultima_vizita
       FROM emailuri e
       LEFT JOIN intrebari i ON i.email = e.email
       LEFT JOIN utilizatori u ON u.email = e.email
       GROUP BY e.email
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
      `SELECT coalesce(sum(CASE WHEN stare = 'ok' AND zi = ?1 THEN 1 ELSE 0 END), 0) AS azi,
              coalesce(sum(CASE WHEN stare = 'ok' AND zi >= ?2 THEN 1 ELSE 0 END), 0) AS zile30,
              coalesce(sum(CASE WHEN stare = 'ok' THEN 1 ELSE 0 END), 0) AS total,
              coalesce(sum(CASE WHEN zi = ?1 THEN cost_microdolari ELSE 0 END), 0) AS cost_azi,
              coalesce(sum(CASE WHEN zi >= ?2 THEN cost_microdolari ELSE 0 END), 0) AS cost_30,
              coalesce(sum(cost_microdolari), 0) AS cost_total,
              coalesce(sum(tokens_intrare + tokens_iesire), 0) AS tokens_total
       FROM intrebari WHERE email = ?3`
    )
    .bind(azi, de30, email)
    .first<ConsumPropriu>();
  return r ?? { azi: 0, zile30: 0, total: 0, cost_azi: 0, cost_30: 0, cost_total: 0, tokens_total: 0 };
}

// Costul total al tuturor (de la inceput), pentru bara de sus a adminului.
export async function costTotalToti(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT coalesce(sum(cost_microdolari), 0) AS c FROM intrebari").first<{ c: number }>();
  return r?.c ?? 0;
}

// Costul propriu de la inceput, pentru bara de sus.
export async function costPropriu(db: D1Database, email: string): Promise<number> {
  const r = await db.prepare("SELECT coalesce(sum(cost_microdolari), 0) AS c FROM intrebari WHERE email = ?").bind(email).first<{ c: number }>();
  return r?.c ?? 0;
}

// Creditele Z.AI consumate de toti in ultimele 7 zile (planul are cota saptamanala), pentru antetul raportului.
export async function crediteUltimele7Zile(db: D1Database, azi: string): Promise<number> {
  const r = await db
    .prepare("SELECT coalesce(sum(credite), 0) AS c FROM intrebari WHERE zi >= ?")
    .bind(ziMinus(azi, 6))
    .first<{ c: number }>();
  return r?.c ?? 0;
}

// Costul total (microdolari) al intrebarilor din ultimele 30 de zile, pentru antetul raportului.
export async function costUltimele30Zile(db: D1Database, azi: string): Promise<number> {
  const r = await db
    .prepare("SELECT coalesce(sum(cost_microdolari), 0) AS c FROM intrebari WHERE zi >= ?")
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
