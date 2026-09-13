import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { adaugaSursa, creeazaCatalog, seteazaText } from "./db";
import { scrieText } from "./text";
import { seteazaSetare } from "./consum";
import { EMAIL_SISTEM, incalzeste, incalzesteToate, listaIncalzire } from "./incalzire";
import type { CerereZai, RaspunsZai } from "./zai";

async function culegere() {
  const catalog = await creeazaCatalog(env.DB, "penala", { titlu: "Legislația penală", stare: "activ" });
  const s = await adaugaSursa(env.DB, catalog.id, { titlu: "Codul penal", tip: "cod", numar: null, data_emiterii: null, url: null });
  await scrieText(env.FISIERE, s.id, [{ pagina: 1, text: "Articolul 91. Liberarea condiționată. ".repeat(6) }]);
  await seteazaText(env.DB, s.id, { pagini: 1, caractere: 240 });
  return catalog;
}

const apelOk = async (_c: string, _b: string, c: CerereZai): Promise<RaspunsZai> => ({
  text: "Gata.", tokens_intrare: c.context.length / 4, tokens_cache: 0, tokens_iesire: 2,
});

describe("incalzire", () => {
  it("sare cand motorul activ nu e DeepSeek sau lipseste cheia", async () => {
    const c = await culegere();
    expect(await incalzeste({ DB: env.DB, FISIERE: env.FISIERE, DEEPSEEK_API_KEY: "x" }, c.id, apelOk)).toMatchObject({ stare: "sarit" });
    await seteazaSetare(env.DB, "model", "deepseek-flash");
    expect(await incalzeste({ DB: env.DB, FISIERE: env.FISIERE }, c.id, apelOk)).toMatchObject({ stare: "sarit", motiv: /cheia/ });
    expect(await incalzeste({ DB: env.DB, FISIERE: env.FISIERE, DEEPSEEK_API_KEY: "x" }, "nu-exista", apelOk)).toMatchObject({ stare: "sarit" });
  });

  it("trimite contextul integral si scrie in jurnal pe emailul de sistem", async () => {
    const c = await culegere();
    await seteazaSetare(env.DB, "model", "deepseek-flash");
    const cereri: CerereZai[] = [];
    const apel = async (k: string, b: string, q: CerereZai) => { cereri.push(q); return apelOk(k, b, q); };
    const r = await incalzeste({ DB: env.DB, FISIERE: env.FISIERE, DEEPSEEK_API_KEY: "x" }, c.id, apel);
    expect(r).toMatchObject({ stare: "ok", mod: "integral" });
    expect(cereri[0]!.context).toContain("=== Codul penal | pag. 1 ===");
    const rand = await env.DB.prepare("SELECT email, stare, model, catalog_id FROM intrebari").first<{ email: string; stare: string; model: string; catalog_id: string }>();
    expect(rand).toEqual({ email: EMAIL_SISTEM, stare: "ok", model: "deepseek-flash", catalog_id: c.id });
  });

  it("incalzesteToate ia lista din setari si inregistreaza erorile", async () => {
    const c = await culegere();
    await seteazaSetare(env.DB, "model", "deepseek-flash");
    await seteazaSetare(env.DB, "incalzire", ` ${c.id} , lipsa `);
    expect(listaIncalzire(" a, b ,,")).toEqual(["a", "b"]);
    const cade = async (): Promise<RaspunsZai> => { throw new Error("pică"); };
    const r = await incalzesteToate({ DB: env.DB, FISIERE: env.FISIERE, DEEPSEEK_API_KEY: "x" }, cade);
    expect(r).toEqual([{ catalog: c.id, stare: "eroare", mesaj: "pică" }, { catalog: "lipsa", stare: "sarit", motiv: expect.any(String) }]);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM intrebari WHERE stare = 'eroare'").first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});
