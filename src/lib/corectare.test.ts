import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  adaugaLaCorectare, citesteCorectare, consumUtilizator, corectariUtilizator, costPropriu, costTotalToti, creeazaCorectare,
  incheieCorectare, inregistreazaIntrebare, intrebariAzi, modelCorector, raportUtilizatori, seteazaSetare,
} from "./consum";
import { corecteazaLot, EroareCorectare, raspunde, verificaDocument, type ApelText } from "./motor";
import { PROMPT_CORECTOR, PROMPT_VERIFICARE } from "./corector";
import { creeazaCatalog } from "./db";

const A = "ion@anp.md";
const B = "ana@anp.md";
const ZI = "2026-09-14";

describe("jurnalul corectarilor", () => {
  it("aduna loturile paralele, se incheie o singura data si intra in costuri, dar nu la limita", async () => {
    const c = await creeazaCorectare(env.DB, { email: A, zi: ZI, fisier: "raport.docx", mod: "corectura", caractere: 12_000, model: "deepseek-flash" });
    expect(c).toMatchObject({ stare: "in_curs", loturi: 0, cost_microdolari: 0 });
    await Promise.all([
      adaugaLaCorectare(env.DB, c.id, { caractere: 4000, tokens_intrare: 1000, tokens_iesire: 200, cost_microdolari: 300, credite: 0, reusit: true }),
      adaugaLaCorectare(env.DB, c.id, { caractere: 4000, tokens_intrare: 500, tokens_iesire: 100, cost_microdolari: 150, credite: 0, reusit: true }),
      adaugaLaCorectare(env.DB, c.id, { caractere: 4000, tokens_intrare: 50, tokens_iesire: 10, cost_microdolari: 20, credite: 0, reusit: false }),
    ]);
    expect(await incheieCorectare(env.DB, c.id, { stare: "ok", corecturi: 9, aplicate: 8, mesaj: null, durata_ms: 5000 })).toBe(true);
    expect(await incheieCorectare(env.DB, c.id, { stare: "eroare", corecturi: 0, aplicate: 0, mesaj: "x", durata_ms: 1 })).toBe(false);
    expect(await citesteCorectare(env.DB, c.id)).toMatchObject({
      stare: "ok", mod: "corectura", loturi: 2, caractere_trimise: 12_000, tokens_intrare: 1550, tokens_iesire: 310, cost_microdolari: 470, corecturi: 9, aplicate: 8, durata_ms: 5000,
    });

    const catalog = await creeazaCatalog(env.DB, "penala", { titlu: "Legislația penală", stare: "activ" });
    await inregistreazaIntrebare(env.DB, {
      email: A, catalog_id: catalog.id, zi: ZI, intrebare: "?", raspuns: "!", citari: [], model: "deepseek-flash",
      tokens_intrare: 10, tokens_iesire: 5, cost_microdolari: 1000, credite: 0, stare: "ok", durata_ms: 1,
    });
    await creeazaCorectare(env.DB, { email: B, zi: ZI, fisier: "nota.docx", mod: "verificare", caractere: 100, model: "deepseek-flash" });

    expect(await intrebariAzi(env.DB, A, ZI)).toBe(1);
    expect(await costPropriu(env.DB, A)).toBe(1470);
    expect(await costTotalToti(env.DB)).toBe(1470);
    expect(await consumUtilizator(env.DB, A, ZI)).toMatchObject({ azi: 1, total: 1, cost_azi: 1470, cost_total: 1470, tokens_total: 1875 });
    const raport = await raportUtilizatori(env.DB, ZI);
    expect(raport.map((r) => r.email)).toEqual([A, B]);
    expect(raport[0]).toMatchObject({ azi: 1, total: 1, cost_microdolari: 1470, tokens_intrare: 1560, documente_30: 1 });
    expect(raport[1]).toMatchObject({ azi: 0, cost_microdolari: 0, documente_30: 0 });
    expect((await corectariUtilizator(env.DB, A)).map((x) => x.fisier)).toEqual(["raport.docx"]);
    expect(await corectariUtilizator(env.DB, "nimeni@anp.md")).toEqual([]);
  });

  it("modelul corectorului vine din setari, cu revenire la implicit", async () => {
    expect(await modelCorector(env.DB)).toBe("deepseek-flash");
    await seteazaSetare(env.DB, "model_corector", "gemini-3.8-flash");
    expect(await modelCorector(env.DB)).toBe("gemini-3.8-flash");
    await seteazaSetare(env.DB, "model_corector", "nu-exista");
    expect(await modelCorector(env.DB)).toBe("deepseek-flash");
  });
});

describe("corecteazaLot", () => {
  const raspuns = JSON.stringify({
    corecturi: [
      { i: 4, vechi: "insa", nou: "însă", tip: "ortografie", motiv: "Se scrie cu î și ă." },
      { i: 99, vechi: "a", nou: "b", tip: "ortografie", motiv: "" },
    ],
  });

  it("trimite lotul cu promptul corectorului pe motorul modelului si calculeaza costul", async () => {
    const cereri: Parameters<ApelText>[] = [];
    const apel: ApelText = async (...args) => {
      cereri.push(args);
      return { text: raspuns, tokens_intrare: 1000, tokens_cache: 0, tokens_iesire: 100 };
    };
    const r = await corecteazaLot({ DB: env.DB, FISIERE: env.FISIERE, GEMINI_API_KEY: "g" }, "gemini-3.5-flash-lite", [{ i: 4, text: "insa" }], apel);
    expect(r).toEqual({
      corecturi: [{ i: 4, vechi: "insa", nou: "însă", tip: "ortografie", motiv: "Se scrie cu î și ă." }],
      tokens_intrare: 1000, tokens_cache: 0, tokens_iesire: 100, cost_microdolari: 550, credite: 0,
    });
    expect(cereri[0]!.slice(0, 2)).toEqual(["gemini", "g"]);
    expect(cereri[0]![3]).toMatchObject({ model: "gemini-3.5-flash-lite", sistem: PROMPT_CORECTOR });

    await corecteazaLot({ DB: env.DB, FISIERE: env.FISIERE, DEEPSEEK_API_KEY: "d" }, "deepseek-flash", [{ i: 4, text: "insa" }], apel);
    expect(cereri[1]!.slice(0, 3)).toEqual(["deepseek", "d", "https://api.deepseek.com"]);

    // Claude: cheia Anthropic, schema impusa, costul la tariful Sonnet 5 (2 $ / 10 $ per M)
    const c = await corecteazaLot({ DB: env.DB, FISIERE: env.FISIERE, ANTHROPIC_API_KEY: "a" }, "claude-sonnet-5", [{ i: 4, text: "insa" }], apel);
    expect(cereri[2]!.slice(0, 3)).toEqual(["claude", "a", "https://api.anthropic.com"]);
    expect(cereri[2]![3].schema).toBeDefined();
    expect(c.cost_microdolari).toBe(3000);
  });

  it("fara cheie da 503; un raspuns ilizibil poarta consumul, ca sa intre in jurnal", async () => {
    await expect(corecteazaLot({ DB: env.DB, FISIERE: env.FISIERE }, "deepseek-flash", [{ i: 0, text: "x" }])).rejects.toMatchObject({ status: 503 });
    const apel: ApelText = async () => ({ text: "Documentul e corect.", tokens_intrare: 1000, tokens_cache: 0, tokens_iesire: 100 });
    const e = await corecteazaLot({ DB: env.DB, FISIERE: env.FISIERE, GEMINI_API_KEY: "g" }, "gemini-3.5-flash-lite", [{ i: 0, text: "x" }], apel).catch((x) => x);
    expect(e).toBeInstanceOf(EroareCorectare);
    expect((e as EroareCorectare).consum).toMatchObject({ tokens_intrare: 1000, cost_microdolari: 550 });
  });
});

describe("verificaDocument", () => {
  const raspuns = JSON.stringify({
    corecturi: [{ i: 2, vechi: "учереждение", nou: "учреждение", tip: "ortografie", motiv: "Ortografie rusă." }],
    observatii: [
      { tip: "date", text: "„02.01.2018” față de „02.10.2018”: datele nu se potrivesc." },
      { tip: "lipsa", text: "Rubrica de înregistrare a rămas fără număr." },
    ],
  });

  it("trimite tot documentul intr-o cerere, cu promptul de verificare, si intoarce si observatiile", async () => {
    const cereri: Parameters<ApelText>[] = [];
    const apel: ApelText = async (...args) => {
      cereri.push(args);
      return { text: raspuns, tokens_intrare: 8000, tokens_cache: 0, tokens_iesire: 900 };
    };
    const paragrafe = [
      { i: 1, text: "Prin prezentul Vă informăm", fel: "corp" as const },
      { i: 2, text: "Пенитенциарная учереждение", fel: "antet" as const },
    ];
    const r = await verificaDocument({ DB: env.DB, FISIERE: env.FISIERE, DEEPSEEK_API_KEY: "d" }, "deepseek-flash", paragrafe, apel);
    expect(r.corecturi).toEqual([{ i: 2, vechi: "учереждение", nou: "учреждение", tip: "ortografie", motiv: "Ortografie rusă." }]);
    expect(r.observatii.map((o) => o.tip)).toEqual(["date", "lipsa"]);
    expect(cereri[0]!.slice(0, 2)).toEqual(["deepseek", "d"]);
    expect(cereri[0]![3]).toMatchObject({ model: "deepseek-flash", sistem: PROMPT_VERIFICARE });
    // paragrafele merg cu locul lor, ca modelul sa stie ce e antet si ce e corp
    expect(JSON.parse(cereri[0]![3].utilizator)).toEqual({
      paragrafe: [{ i: 1, unde: "corp", text: "Prin prezentul Vă informăm" }, { i: 2, unde: "antet", text: "Пенитенциарная учереждение" }],
    });
  });

  it("un raspuns care nu e verificare poarta consumul, ca sa intre in jurnal", async () => {
    const apel: ApelText = async () => ({ text: "Documentul e în regulă.", tokens_intrare: 8000, tokens_cache: 0, tokens_iesire: 50 });
    const e = await verificaDocument({ DB: env.DB, FISIERE: env.FISIERE, DEEPSEEK_API_KEY: "d" }, "deepseek-flash", [{ i: 1, text: "x", fel: "corp" }], apel).catch((x) => x);
    expect(e).toBeInstanceOf(EroareCorectare);
    expect((e as EroareCorectare).consum.tokens_intrare).toBe(8000);
  });
});

describe("modelele Claude la chat", () => {
  it("raspunde refuza modelele doar pentru corector", async () => {
    const catalog = await creeazaCatalog(env.DB, "penala", { titlu: "Legislația penală", stare: "activ" });
    await expect(raspunde({ DB: env.DB, FISIERE: env.FISIERE, ANTHROPIC_API_KEY: "a" }, {
      model: "claude-sonnet-5", catalog, istoric: [], intrebare: "?", buget: 1000,
    })).rejects.toMatchObject({ status: 409 });
  });
});
