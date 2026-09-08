import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { creeazaCatalog } from "./db";
import {
  atingeVizita, citesteUtilizator, consumUtilizator, costUltimele30Zile, esteBlocat, fmtCost, inregistreazaIntrebare, intrebariAzi,
  istoricUtilizator, limitaPentru, raportUtilizatori, seteazaSetare, seteazaUtilizator,
} from "./consum";

const A = "a@exemplu.md";
const B = "b@exemplu.md";

async function catalog() {
  return creeazaCatalog(env.DB, "c", { titlu: "C" });
}

function intrebare(email: string, catalogId: string, zi: string, stare: "ok" | "eroare" | "refuzat" = "ok") {
  return inregistreazaIntrebare(env.DB, {
    email, catalog_id: catalogId, zi, intrebare: "Ce spune art. 5?", raspuns: "Vizite de 2 ori pe luna.",
    citari: [{ sursa_id: "s1", titlu: "Ordinul 123", pagina: 1 }], model: "gemini-3.5-flash-lite",
    tokens_intrare: 7000, tokens_iesire: 600, cost_microdolari: 3600, stare, durata_ms: 1200,
  });
}

describe("limite", () => {
  it("foloseste limita implicita din setari, apoi pe cea per utilizator", async () => {
    expect(await limitaPentru(env.DB, A)).toBe(15);
    await seteazaSetare(env.DB, "limita_zi_implicita", "3");
    expect(await limitaPentru(env.DB, A)).toBe(3);
    await seteazaUtilizator(env.DB, A, { limita_zi: 40, blocat: false, nota: null });
    expect(await limitaPentru(env.DB, A)).toBe(40);
    expect(await limitaPentru(env.DB, B)).toBe(3);
  });

  it("numara doar intrebarile reusite ale zilei si emailului dat", async () => {
    const c = await catalog();
    await intrebare(A, c.id, "2026-09-08");
    await intrebare(A, c.id, "2026-09-08", "eroare");
    await intrebare(A, c.id, "2026-09-08", "refuzat");
    await intrebare(A, c.id, "2026-09-07");
    await intrebare(B, c.id, "2026-09-08");
    expect(await intrebariAzi(env.DB, A, "2026-09-08")).toBe(1);
    expect(await intrebariAzi(env.DB, B, "2026-09-08")).toBe(1);
    expect(await intrebariAzi(env.DB, A, "2026-09-09")).toBe(0);
  });

  it("blocheaza si deblocheaza", async () => {
    expect(await esteBlocat(env.DB, A)).toBe(false);
    await seteazaUtilizator(env.DB, A, { limita_zi: null, blocat: true, nota: "abuz" });
    expect(await esteBlocat(env.DB, A)).toBe(true);
    expect(await citesteUtilizator(env.DB, A)).toMatchObject({ nota: "abuz", limita_zi: null });
    await seteazaUtilizator(env.DB, A, { limita_zi: null, blocat: false, nota: null });
    expect(await esteBlocat(env.DB, A)).toBe(false);
  });
});

describe("vizite", () => {
  it("retine ultima zi de vizita fara sa atinga setarile", async () => {
    await seteazaUtilizator(env.DB, A, { limita_zi: 5, blocat: false, nota: "x" });
    await atingeVizita(env.DB, A, "2026-09-08");
    await atingeVizita(env.DB, A, "2026-09-07"); // mai veche: nu da inapoi
    expect(await citesteUtilizator(env.DB, A)).toMatchObject({ ultima_vizita: "2026-09-08", limita_zi: 5, nota: "x" });
    await atingeVizita(env.DB, B, "2026-09-08");
    expect(await citesteUtilizator(env.DB, B)).toMatchObject({ ultima_vizita: "2026-09-08", limita_zi: null, blocat: 0 });
  });
});

describe("jurnal si raport", () => {
  it("pastreaza citarile ca JSON si intoarce istoricul in ordine inversa", async () => {
    const c = await catalog();
    await intrebare(A, c.id, "2026-09-07");
    const ultima = await intrebare(A, c.id, "2026-09-08");
    const istoric = await istoricUtilizator(env.DB, A);
    expect(istoric.map((i) => i.id)[0]).toBe(ultima.id);
    expect(JSON.parse(istoric[0]!.citari)).toEqual([{ sursa_id: "s1", titlu: "Ordinul 123", pagina: 1 }]);
    expect(await istoricUtilizator(env.DB, B)).toEqual([]);
  });

  it("agrega pe azi / 7 zile / 30 zile / total, include utilizatorii fara intrebari si costul", async () => {
    const c = await catalog();
    await intrebare(A, c.id, "2026-09-08");
    await intrebare(A, c.id, "2026-09-03");   // in 7 zile
    await intrebare(A, c.id, "2026-08-20");   // in 30 zile
    await intrebare(A, c.id, "2026-07-01");   // doar total
    await intrebare(A, c.id, "2026-09-08", "eroare"); // nu se numara, dar costul se aduna
    await seteazaUtilizator(env.DB, B, { limita_zi: 2, blocat: true, nota: null });
    const raport = await raportUtilizatori(env.DB, "2026-09-08");
    expect(raport.map((r) => r.email)).toEqual([A, B]);
    expect(raport[0]).toMatchObject({
      azi: 1, zile7: 2, zile30: 3, total: 4, tokens_intrare: 35000, tokens_iesire: 3000,
      cost_microdolari: 18000, cost_30_microdolari: 14400, blocat: 0, limita_zi: null,
    });
    expect(raport[1]).toMatchObject({ azi: 0, total: 0, limita_zi: 2, blocat: 1 });
    expect(await costUltimele30Zile(env.DB, "2026-09-08")).toBe(14400);
  });

  it("formateaza costul", () => {
    expect(fmtCost(3600)).toBe("0,36 ¢");
    expect(fmtCost(1_250_000)).toBe("1,25 $");
  });
});

describe("consumUtilizator", () => {
  it("aduna intrebarile si costul propriu pe azi / 30 zile / tot", async () => {
    const c = await creeazaCatalog(env.DB, "c2", { titlu: "C2" });
    await intrebare(A, c.id, "2026-09-08");
    await intrebare(A, c.id, "2026-08-20");
    await intrebare(A, c.id, "2026-07-01");
    await intrebare(A, c.id, "2026-09-08", "eroare");
    await intrebare(B, c.id, "2026-09-08");
    const r = await consumUtilizator(env.DB, A, "2026-09-08");
    expect(r).toEqual({ azi: 1, zile30: 2, total: 3, cost_azi: 7200, cost_30: 10800, cost_total: 14400, tokens_total: 30400 });
    expect(await consumUtilizator(env.DB, "nimeni@x.md", "2026-09-08")).toMatchObject({ total: 0, cost_total: 0 });
  });
});
