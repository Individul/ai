import { describe, expect, it } from "vitest";
import type { Sursa } from "./db";
import { disponibilePentruChat } from "./motor";

const s = (x: Partial<Sursa>): Sursa => ({ text_caractere: null, ...x }) as Sursa;

describe("disponibilePentruChat", () => {
  it("numara doar sursele cu text extras nevid (PDF-urile scanate au 0)", () => {
    expect(disponibilePentruChat([s({ text_caractere: 10 }), s({ text_caractere: 5 }), s({ text_caractere: 0 }), s({})])).toBe(2);
    expect(disponibilePentruChat([])).toBe(0);
  });
});

import { env } from "cloudflare:workers";
import { adaugaSursa, creeazaCatalog, seteazaFisierSursa, seteazaText } from "./db";
import { scrieText } from "./text";
import { EroareModel, type CerereChat, type RaspunsModel } from "./deepseek";
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

describe("raspunde pe DeepSeek", () => {
  const mediu = () => ({ DB: env.DB, FISIERE: env.FISIERE, DEEPSEEK_API_KEY: "ds-test" });

  it("citeste textele din R2, trimite tot cand incape, leaga citarile si socoteste costul pe tokenii din cache", async () => {
    const { catalog, ord } = await catalogCuText();
    const cereri: { cheie: string; baza: string; c: CerereChat }[] = [];
    const apel = async (cheie: string, baza: string, c: CerereChat): Promise<RaspunsModel> => {
      cereri.push({ cheie, baza, c });
      return { text: "Marți și joi [Ordinul nr. 777, pag. 2].", tokens_intrare: 1000, tokens_cache: 900, tokens_iesire: 20 };
    };
    const r = await raspunde(mediu(), { model: "deepseek-flash", catalog, istoric: [], intrebare: "Când se predau pachetele?", buget: 1000 }, apel);
    expect(cereri).toHaveLength(1);
    expect(cereri[0]!.cheie).toBe("ds-test");
    expect(cereri[0]!.baza).toBe("https://api.deepseek.com");
    expect(cereri[0]!.c.context).toContain("=== Codul de executare | pag. 1 ===");
    expect(cereri[0]!.c.context).toContain("=== Ordinul nr. 777 | pag. 2 ===");
    expect(cereri[0]!.c.context).not.toContain("Scanat");
    expect(r).toMatchObject({
      text: "Marți și joi [Ordinul nr. 777, pag. 2].",
      citari: [{ sursa_id: ord.id, titlu: "Ordinul nr. 777", pagina: 2 }],
      tokens_intrare: 1000, tokens_cache: 900, tokens_iesire: 20, mod: "integral",
    });
    // 100 x 0,15 + 900 x 0,003 + 20 x 0,60 = 29,7 -> 30 microdolari; dublu la orele de varf
    expect([30, 59]).toContain(r.cost_microdolari);
  });

  it("la context prea lung reincearca o singura data, cu bugetul injumatatit", async () => {
    const { catalog } = await catalogCuText();
    const cereri: CerereChat[] = [];
    const apel = async (_c: string, _b: string, c: CerereChat): Promise<RaspunsModel> => {
      cereri.push(c);
      if (cereri.length === 1) throw new EroareModel(400, "This model's maximum context length is 1048576 tokens");
      return { text: "ok", tokens_intrare: 10, tokens_cache: 0, tokens_iesire: 1 };
    };
    const r = await raspunde(mediu(), { model: "deepseek-flash", catalog, istoric: [], intrebare: "pachete", buget: 1000 }, apel);
    expect(cereri).toHaveLength(2);
    expect(cereri[1]!.context.length).toBeLessThan(cereri[0]!.context.length);
    expect(r.mod).toBe("filtrat");

    const mereu = async (): Promise<RaspunsModel> => { throw new EroareModel(400, "maximum context length exceeded"); };
    await expect(raspunde(mediu(), { model: "deepseek-flash", catalog, istoric: [], intrebare: "x", buget: 1000 }, mereu)).rejects.toThrow(/context length/);
  });

  it("fara cheie DeepSeek raspunde 503, chiar daca exista cheia Anthropic", async () => {
    const { catalog } = await catalogCuText();
    await expect(raspunde({ DB: env.DB, FISIERE: env.FISIERE, ANTHROPIC_API_KEY: "a" }, { model: "deepseek-flash", catalog, istoric: [], intrebare: "x", buget: 1000 }))
      .rejects.toMatchObject({ status: 503, message: "Cheia DeepSeek nu este configurată pe server." });
  });

  it("un model scos din aplicatie (ex. Gemini) raspunde 409", async () => {
    const { catalog } = await catalogCuText();
    await expect(raspunde(mediu(), { model: "gemini-3.5-flash-lite", catalog, istoric: [], intrebare: "x", buget: 1000 }))
      .rejects.toMatchObject({ status: 409 });
  });
});
