import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { citesteSetare, seteazaSetare } from "./consum";
import { cursUsd, explicatieLei, extrageCursUsd, fmtLei } from "./curs";

// Fragment real din XML-ul BNM (10 sept. 2026).
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<ValCurs Date="10.09.2026" name="Cursul oficial de schimb">
  <Valute ID="47"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>1</Nominal><Name>Euro</Name><Value>20.0487</Value></Valute>
  <Valute ID="44">
    <NumCode>840</NumCode>
    <CharCode>USD</CharCode>
    <Nominal>1</Nominal>
    <Name>Dolar S.U.A.</Name>
    <Value>17.2388</Value>
  </Valute>
  <Valute ID="36"><NumCode>643</NumCode><CharCode>RUB</CharCode><Nominal>1</Nominal><Name>Rubla ruseasca</Name><Value>0.2015</Value></Valute>
</ValCurs>`;

describe("extrageCursUsd", () => {
  it("ia cursul USD si ziua din XML-ul BNM", () => {
    expect(extrageCursUsd(XML)).toEqual({ curs: 17.2388, zi: "2026-09-10" });
  });

  it("imparte la nominal si intoarce null fara USD sau cu XML stricat", () => {
    const cu100 = XML.replace("<Nominal>1</Nominal>\n    <Name>Dolar", "<Nominal>100</Nominal>\n    <Name>Dolar").replace("<Value>17.2388</Value>", "<Value>1723.88</Value>");
    expect(extrageCursUsd(cu100)).toEqual({ curs: 17.2388, zi: "2026-09-10" });
    expect(extrageCursUsd(XML.replace("USD", "GBP"))).toBeNull();
    expect(extrageCursUsd("<html>eroare</html>")).toBeNull();
  });
});

describe("fmtLei si explicatieLei", () => {
  // Cursul 10 in teste, ca sumele sa se citeasca direct: 100.000 microdolari = 1 leu.
  it("desparte leii de bani, cu acordul din romana", () => {
    expect(fmtLei(0, 10)).toBe("0 lei");
    expect(fmtLei(100_000, 10)).toBe("1 leu");
    expect(fmtLei(500_000, 10)).toBe("5 lei");
    expect(fmtLei(104_000, 10)).toBe("1 leu și 4 bani");
    expect(fmtLei(2_494_000, 10)).toBe("24 lei și 94 de bani");
    expect(fmtLei(123_456_000, 10)).toBe("1.234 lei și 56 de bani");
  });

  it("scrie corect banul singur, pluralul si forma cu „de”", () => {
    expect(fmtLei(1_000, 10)).toBe("1 ban");
    expect(fmtLei(19_000, 10)).toBe("19 bani");
    expect(fmtLei(20_000, 10)).toBe("20 de bani");
    expect(fmtLei(94_000, 10)).toBe("94 de bani");
  });

  it("sub un ban spune asta, ca sa nu arate zero", () => {
    expect(fmtLei(200, 17.2388)).toBe("sub 1 ban");   // 0,0034 lei
    expect(fmtLei(3600, 17.2388)).toBe("6 bani");     // 0,062 lei
  });

  it("explica suma in dolari si cursul folosit", () => {
    expect(explicatieLei(3600, { curs: 17.2388, zi: "2026-09-10" })).toBe("0,0036 $ · curs BNM 17,2388 lei/$ din 10 sept. 2026");
  });
});

describe("cursUsd", () => {
  it("cere de la BNM o singura data pe zi, tine minte in setari si cade pe ultimul cunoscut", async () => {
    const cereri: string[] = [];
    const adu = async (zi: string) => { cereri.push(zi); return XML; };
    expect(await cursUsd(env.DB, "2026-09-10", adu)).toEqual({ curs: 17.2388, zi: "2026-09-10" });
    expect(await cursUsd(env.DB, "2026-09-10", adu)).toEqual({ curs: 17.2388, zi: "2026-09-10" });
    expect(cereri).toEqual(["2026-09-10"]);
    expect(JSON.parse(await citesteSetare(env.DB, "curs_usd"))).toEqual({ curs: 17.2388, zi: "2026-09-10" });

    const pica = async () => { throw new Error("BNM nu raspunde"); };
    expect(await cursUsd(env.DB, "2026-09-11", pica)).toEqual({ curs: 17.2388, zi: "2026-09-10" });
  });

  it("fara niciun curs cunoscut si fara BNM intoarce null", async () => {
    await seteazaSetare(env.DB, "curs_usd", "");
    expect(await cursUsd(env.DB, "2026-09-10", async () => "<html>eroare</html>")).toBeNull();
  });
});
