import { describe, expect, it } from "vitest";
import type { Sursa } from "./db";
import { disponibilePentruChat } from "./motor";

const s = (x: Partial<Sursa>): Sursa => ({ indexare: "neindexat", text_caractere: null, ...x }) as Sursa;
const SURSE = [
  s({ indexare: "gata" }),                            // doar Gemini
  s({ indexare: "gata", text_caractere: 10 }),        // ambele
  s({ indexare: "in_curs", text_caractere: 5 }),      // doar Z.AI
  s({ indexare: "eroare", text_caractere: 0 }),       // PDF scanat: niciunul
  s({ text_caractere: null }),                        // fara nimic
];

describe("disponibilePentruChat", () => {
  it("la Gemini numara sursele indexate, doar daca catalogul are magazin", () => {
    expect(disponibilePentruChat("gemini", "fileSearchStores/x", SURSE)).toBe(2);
    expect(disponibilePentruChat("gemini", null, SURSE)).toBe(0);
  });

  it("la Z.AI numara sursele cu text extras nevid, indiferent de magazin", () => {
    expect(disponibilePentruChat("zai", null, SURSE)).toBe(2);
    expect(disponibilePentruChat("zai", "fileSearchStores/x", [])).toBe(0);
  });
});

import { env } from "cloudflare:workers";
import { adaugaSursa, creeazaCatalog, seteazaFisierSursa, seteazaText } from "./db";
import { scrieText } from "./text";
import { EroareZai, type CerereZai, type RaspunsZai } from "./zai";
import { raspunde } from "./motor";

const SURSA = { tip: "ordin" as const, numar: null, data_emiterii: null, url: null };

async function catalogCuText() {
  const catalog = await creeazaCatalog(env.DB, "c", { titlu: "C" });
  const cod = await adaugaSursa(env.DB, catalog.id, { ...SURSA, titlu: "Codul de executare" });
  const ord = await adaugaSursa(env.DB, catalog.id, { ...SURSA, titlu: "Ordinul nr. 777" });
  const gol = await adaugaSursa(env.DB, catalog.id, { ...SURSA, titlu: "Scanat" });
  for (const s of [cod, ord, gol]) await seteazaFisierSursa(env.DB, s.id, "x.pdf", 10);
  const p = (n: number, t: string) => ({ pagina: n, text: t.repeat(Math.ceil(200 / t.length)).slice(0, 200) });
  await scrieText(env.FISIERE, cod.id, [p(1, "Codul de executare. Dispoziții generale. "), p(2, "Articolul 91. Liberarea condiționată. ")]);
  await seteazaText(env.DB, cod.id, { pagini: 2, caractere: 400 });
  const q = (n: number, t: string) => ({ pagina: n, text: t.repeat(Math.ceil(150 / t.length)).slice(0, 150) });
  await scrieText(env.FISIERE, ord.id, [q(1, "Ordinul nr. 777 privind pachetele. "), q(2, "Pachetele se predau marți și joi. ")]);
  await seteazaText(env.DB, ord.id, { pagini: 2, caractere: 300 });
  await seteazaText(env.DB, gol.id, { pagini: 0, caractere: 0 });
  return { catalog, cod, ord };
}

describe("raspunde pe Z.AI", () => {
  const mediu = () => ({ DB: env.DB, FISIERE: env.FISIERE, ZAI_API_KEY: "test" });

  it("citeste textele din R2, trimite tot cand incape, leaga citarile de surse si socoteste creditele", async () => {
    const { catalog, ord } = await catalogCuText();
    const cereri: CerereZai[] = [];
    const apel = async (_cheie: string, _baza: string, c: CerereZai): Promise<RaspunsZai> => {
      cereri.push(c);
      return { text: "Marți și joi [Ordinul nr. 777, pag. 2].", tokens_intrare: 1000, tokens_cache: 0, tokens_iesire: 20 };
    };
    const r = await raspunde(mediu(), { model: "glm-5.3-flash", catalog, istoric: [], intrebare: "Când se predau pachetele?", buget: 1000 }, apel);
    expect(cereri).toHaveLength(1);
    expect(cereri[0]!.context).toContain("=== Codul de executare | pag. 1 ===");
    expect(cereri[0]!.context).toContain("=== Ordinul nr. 777 | pag. 2 ===");
    expect(cereri[0]!.context).not.toContain("Scanat");
    expect(r).toEqual({
      text: "Marți și joi [Ordinul nr. 777, pag. 2].",
      citari: [{ sursa_id: ord.id, titlu: "Ordinul nr. 777", pagina: 2 }],
      tokens_intrare: 1000, tokens_cache: 0, tokens_iesire: 20, cost_microdolari: 160, credite: 0.25, mod: "integral",
    });
  });

  it("la context prea lung reincearca o singura data, cu bugetul injumatatit", async () => {
    const { catalog } = await catalogCuText();
    const cereri: CerereZai[] = [];
    const apel = async (_c: string, _b: string, c: CerereZai): Promise<RaspunsZai> => {
      cereri.push(c);
      if (cereri.length === 1) throw new EroareZai(400, "Prompt exceeds max length", "1261");
      return { text: "ok", tokens_intrare: 10, tokens_cache: 0, tokens_iesire: 1 };
    };
    const r = await raspunde(mediu(), { model: "glm-5.3-flash", catalog, istoric: [], intrebare: "pachete", buget: 1000 }, apel);
    expect(cereri).toHaveLength(2);
    expect(cereri[1]!.context.length).toBeLessThan(cereri[0]!.context.length);
    expect(r.mod).toBe("filtrat");

    const mereu = async (): Promise<RaspunsZai> => { throw new EroareZai(400, "Prompt exceeds max length", "1261"); };
    await expect(raspunde(mediu(), { model: "glm-5.3-flash", catalog, istoric: [], intrebare: "x", buget: 1000 }, mereu)).rejects.toThrow(/exceeds/);
  });

  it("fara cheie Z.AI raspunde 503", async () => {
    const { catalog } = await catalogCuText();
    await expect(raspunde({ DB: env.DB, FISIERE: env.FISIERE }, { model: "glm-5.3-flash", catalog, istoric: [], intrebare: "x", buget: 1000 }))
      .rejects.toMatchObject({ status: 503 });
  });
});

describe("motorul deepseek", () => {
  it("numara sursele cu text, ca orice motor fara File Search", () => {
    expect(disponibilePentruChat("deepseek", null, SURSE)).toBe(2);
  });

  it("trimite cheia si baza DeepSeek, fara credite, cu costul socotit pe tokenii din cache", async () => {
    const { catalog, ord } = await catalogCuText();
    const apeluri: { cheie: string; baza: string }[] = [];
    const apel = async (cheie: string, baza: string, _c: CerereZai): Promise<RaspunsZai> => {
      apeluri.push({ cheie, baza });
      return { text: "Marți [Ordinul nr. 777, pag. 2].", tokens_intrare: 1000, tokens_cache: 900, tokens_iesire: 20 };
    };
    const r = await raspunde({ DB: env.DB, FISIERE: env.FISIERE, DEEPSEEK_API_KEY: "ds-test", ZAI_API_KEY: "zai-test" },
      { model: "deepseek-v4-flash", catalog, istoric: [], intrebare: "Când?", buget: 1000 }, apel);
    expect(apeluri).toEqual([{ cheie: "ds-test", baza: "https://api.deepseek.com" }]);
    expect(r).toMatchObject({ citari: [{ sursa_id: ord.id, titlu: "Ordinul nr. 777", pagina: 2 }], credite: 0, mod: "integral", tokens_cache: 900 });
    // 100 x 0,14 + 900 x 0,0028 + 20 x 0,28 = 14 + 2,52 + 5,6 = 22,12 -> 22 microdolari
    expect(r.cost_microdolari).toBe(22);
  });

  it("fara cheie DeepSeek raspunde 503, chiar daca exista cheia Z.AI", async () => {
    const { catalog } = await catalogCuText();
    await expect(raspunde({ DB: env.DB, FISIERE: env.FISIERE, ZAI_API_KEY: "zai-test" }, { model: "deepseek-v4-flash", catalog, istoric: [], intrebare: "x", buget: 1000 }))
      .rejects.toMatchObject({ status: 503 });
  });
});
