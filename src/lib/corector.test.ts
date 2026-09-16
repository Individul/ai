import { describe, expect, it } from "vitest";
import { bugetCaractere, cerereCorectura, cerereVerificare, continutLocal, eroareTrecatoare, evenimentClaudeCode, extrageVerificare, mesajEroareClaudeCode, mesajEroareLocal, mesajVerificare, MODELE_LOCALE, modelLocal, PROMPT_VERIFICARE, extrageCorecturi, impartePeLoturi, LIMITA_DOCUMENT, LIMITA_LOT, LIMITA_LOTURI, numara, PROMPT_CORECTOR, TIPURI_OBSERVATIE, type MotorLocal } from "./corector";

describe("impartePeLoturi", () => {
  it("umple loturile in ordine, fara sa depaseasca plafonul; un paragraf lung sta singur", () => {
    const p = (i: number, n: number) => ({ i, text: "a".repeat(n) });
    const loturi = impartePeLoturi([p(0, 40), p(1, 50), p(2, 20), p(3, 150), p(4, 10)], 100);
    expect(loturi.map((l) => l.map((x) => x.i))).toEqual([[0, 1], [2], [3], [4]]);
    expect(impartePeLoturi([], 100)).toEqual([]);
  });
});

describe("cerereCorectura", () => {
  it("trimite paragrafele ca JSON, cu promptul corectorului", () => {
    const c = cerereCorectura("deepseek-flash", [{ i: 3, text: "Textul „cu” ghilimele\tși tab." }]);
    expect(c.sistem).toBe(PROMPT_CORECTOR);
    expect(JSON.parse(c.utilizator)).toEqual({ paragrafe: [{ i: 3, text: "Textul „cu” ghilimele\tși tab." }] });
  });
});

describe("extrageCorecturi", () => {
  it("citeste lista, normalizeaza tipul si sare intrarile invalide", () => {
    const text = "```json\n" + JSON.stringify({
      corecturi: [
        { i: 1, vechi: "insa", nou: "însă", tip: "Ortografie", motiv: "Se scrie cu î și ă." },
        { i: 1, vechi: "se v-a", nou: "se va", tip: "gramatica", motiv: "viitorul" },
        { i: 9, vechi: "x", nou: "y", tip: "ortografie" },   // paragraf din alt lot
        { i: 2, vechi: "", nou: "y" },                        // fara fragment
        { i: 2, vechi: "ceva", tip: "punctuație" },           // fara inlocuire
        { i: 2, vechi: "  a", nou: "a", tip: "altceva" },
      ],
    }) + "\n```";
    expect(extrageCorecturi(text, new Set([1, 2]))).toEqual([
      { i: 1, vechi: "insa", nou: "însă", tip: "ortografie", motiv: "Se scrie cu î și ă." },
      { i: 1, vechi: "se v-a", nou: "se va", tip: "gramatică", motiv: "viitorul" },
      { i: 2, vechi: "  a", nou: "a", tip: "formulare", motiv: "" },
    ]);
  });

  it("accepta si lista goala sau o lista directa; arunca la raspuns fara JSON", () => {
    expect(extrageCorecturi('{"corecturi":[]}', new Set([1]))).toEqual([]);
    expect(extrageCorecturi('Iată: {"corecturi":[{"i":1,"vechi":"a","nou":"b","tip":"ortografie","motiv":"m"}]}', new Set([1]))).toHaveLength(1);
    expect(extrageCorecturi('[{"i":1,"vechi":"a","nou":"b"}]', new Set([1]))).toHaveLength(1);
    expect(() => extrageCorecturi("nu am găsit greșeli", new Set([1]))).toThrow(/lista de corecturi/);
  });
});

describe("numara", () => {
  it("pune \"de\" dupa acordul din romana", () => {
    expect([0, 1, 2, 19, 20, 21, 100, 101, 119, 120].map((n) => numara(n, "corectură", "corecturi"))).toEqual([
      "0 corecturi", "1 corectură", "2 corecturi", "19 corecturi", "20 de corecturi", "21 de corecturi",
      "100 de corecturi", "101 corecturi", "119 corecturi", "120 de corecturi",
    ]);
  });
});

describe("plafoane", () => {
  it("bugetul de caractere permite o reincercare a fiecarui lot si e plafonat la LIMITA_DOCUMENT", () => {
    expect(bugetCaractere(10_000)).toBe(45_000);
    expect(bugetCaractere(LIMITA_DOCUMENT * 5)).toBe(LIMITA_DOCUMENT * 2 + 25_000);
    expect(bugetCaractere(-1)).toBe(25_000);
  });

  it("cel mai nefavorabil document (paragrafe putin peste jumatate de lot) incape in LIMITA_LOTURI", () => {
    const n = Math.floor(LIMITA_DOCUMENT / (LIMITA_LOT / 2 + 1));
    const paragrafe = Array.from({ length: n }, (_, i) => ({ i, text: "a".repeat(LIMITA_LOT / 2 + 1) }));
    expect(impartePeLoturi(paragrafe).length).toBeLessThanOrEqual(LIMITA_LOTURI);
  });
});

describe("continutLocal", () => {
  const corectura = { i: 1, vechi: "insa", nou: "însă", tip: "ortografie", motiv: "î și ă" };
  const corecturi = (motor: MotorLocal, iesire: string) => {
    const c = continutLocal(motor, iesire);
    return { corecturi: extrageCorecturi(c.brut, new Set([1])), cost_usd: c.cost_usd, jetoane: c.jetoane };
  };

  it("Claude Code: ia corecturile din structured_output, cu costul raportat", () => {
    const iesire = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", structured_output: { corecturi: [corectura] }, total_cost_usd: 0.0123 });
    expect(corecturi("claude", iesire)).toEqual({ corecturi: [corectura], cost_usd: 0.0123, jetoane: 0 });
  });

  it("Claude Code: fara structured_output, citeste textul din result", () => {
    const iesire = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify({ corecturi: [corectura] }) });
    expect(corecturi("claude", iesire)).toEqual({ corecturi: [corectura], cost_usd: 0, jetoane: 0 });
  });

  it("Antigravity: ia raspunsul si jetoanele, fara cost (intra in planul Google)", () => {
    const iesire = JSON.stringify({ conversation_id: "x", status: "SUCCESS", response: `\`\`\`json\n${JSON.stringify({ corecturi: [corectura] })}\n\`\`\``, usage: { input_tokens: 14_649, output_tokens: 4_652, total_tokens: 19_301 } });
    expect(corecturi("gemini", iesire)).toEqual({ corecturi: [corectura], cost_usd: 0, jetoane: 19_301 });
  });

  it("arunca la eroarea raportata sau la iesire care nu e JSON", () => {
    expect(() => corecturi("claude", JSON.stringify({ subtype: "error_max_turns", is_error: true, result: "Credit balance is too low" }))).toThrow(/Credit balance/);
    expect(() => corecturi("claude", "Invalid API key · Please run /login")).toThrow(/nu a întors JSON/);
    expect(() => corecturi("gemini", JSON.stringify({ status: "ERROR", error: "model overloaded" }))).toThrow(/model overloaded/);
    expect(() => corecturi("gemini", "panic: agy crashed")).toThrow(/nu a întors JSON/);
  });
});

describe("cerereVerificare", () => {
  it("trimite tot documentul cu promptul de verificare si schema celor doua liste", () => {
    const c = cerereVerificare("claude-opus-5", [{ i: 1, text: "Penitenciarul nr.6", fel: "antet" }]);
    expect(c.sistem).toBe(PROMPT_VERIFICARE);
    expect(JSON.parse(c.utilizator)).toEqual({ paragrafe: [{ i: 1, unde: "antet", text: "Penitenciarul nr.6" }] });
    const schema = c.schema as { required: string[]; properties: Record<string, { items?: { properties?: { tip?: { enum?: string[] } } } }> };
    expect(schema.required).toEqual(["corecturi", "observatii"]);
    expect(schema.properties.observatii?.items?.properties?.tip?.enum).toEqual([...TIPURI_OBSERVATIE]);
  });
});

describe("unealta refuzata la Antigravity", () => {
  // 16 sept. 2026, pe demersul real: Flash a vrut „read_url” in mijlocul corecturii, headless nu poate cere
  // permisiunea, iar rularea a iesit fara raspuns dupa 78 s.
  const stderr = 'jetski: no output produced — a tool required the "read_url" permission that headless mode cannot prompt for, so it was auto-denied.';

  it("spune de ce nu a raspuns si o trateaza ca eroare trecatoare", () => {
    const mesaj = mesajEroareLocal("gemini", `Gemini a răspuns fără text. Încearcă din nou. (${stderr})`);
    expect(mesaj).toContain("permisiune pe care modul fără interfață");
    expect(mesaj).toContain("nu porni „--dangerously-skip-permissions”"); // sfatul contrar, pe acte cu date personale
    expect(eroareTrecatoare(mesaj)).toBe(true);
  });

  it("nu reincearca limitele planului",  () => {
    expect(eroareTrecatoare(mesajEroareLocal("gemini", "quota exceeded"))).toBe(false);
  });
});

describe("motoarele locale", () => {
  it("fiecare motor are modelele lui, cu nume scurte in comanda", () => {
    expect(modelLocal("claude", "opus")).toBe("opus");
    expect(modelLocal("gemini", "pro")).toBe("gemini-3.1-pro-high");
    expect(modelLocal("gemini", "opus")).toBeNull();
    expect(Object.keys(MODELE_LOCALE.gemini)).toEqual(["pro", "flash"]);
  });

  it("spune pe romaneste cand Antigravity nu e logat sau a atins limita", () => {
    expect(mesajEroareLocal("gemini", "Gemini: request failed: UNAUTHENTICATED")).toMatch(/nu e logat.*agy/);
    expect(mesajEroareLocal("gemini", "Gemini: RESOURCE_EXHAUSTED quota")).toMatch(/^Ai atins limita planului Google/);
    expect(mesajEroareLocal("gemini", "Gemini: ceva neasteptat")).toBe("Gemini: ceva neasteptat");
    expect(mesajEroareLocal("claude", "Claude AI usage limit reached")).toMatch(/^Ai atins limita planului Claude/);
    expect(mesajEroareLocal("gemini", 'Gemini: API error: UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high')).toMatch(/^Google nu are capacitate/);
  });

  it("se reincearca doar ce tine de furnizor, nu limitele planului sau autentificarea", () => {
    expect(eroareTrecatoare(mesajEroareLocal("gemini", "Gemini: UNAVAILABLE (code 503): No capacity available"))).toBe(true);
    expect(eroareTrecatoare("Claude Code s-a oprit fără rezultat: overloaded_error [cod 1].")).toBe(true);
    expect(eroareTrecatoare(mesajEroareLocal("gemini", "Gemini: RESOURCE_EXHAUSTED quota"))).toBe(false);
    expect(eroareTrecatoare(mesajEroareLocal("claude", "OAuth access token is invalid"))).toBe(false);
  });
});

describe("evenimentClaudeCode", () => {
  it("recunoaste rezultatul, reincercarile si pastreaza in jurnal doar cifrele, fara text", () => {
    const rezultat = evenimentClaudeCode(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 42000, result: "{\"corecturi\":[{\"vechi\":\"text secret\"}]}", total_cost_usd: 0.03 }));
    expect(rezultat).toMatchObject({ fel: "rezultat", jurnal: { type: "result", num_turns: 1, duration_ms: 42000, cost_usd: 0.03, structured_output: false } });
    expect(JSON.stringify(rezultat!.jurnal)).not.toContain("text secret");

    expect(evenimentClaudeCode(JSON.stringify({ type: "system", subtype: "api_retry", attempt: 3, max_retries: 10, error_status: 429, error: "rate_limit", retry_delay_ms: 8000 })))
      .toMatchObject({ fel: "reincercare", eroare: "rate_limit", incercare: 3, max: 10 });

    const asistent = evenimentClaudeCode(JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "secret" }, { type: "tool_use", name: "StructuredOutput", input: { x: "secret" } }], stop_reason: "tool_use" } }));
    expect(asistent).toMatchObject({ fel: "altul", jurnal: { blocuri: ["thinking", "tool_use:StructuredOutput"], stop: "tool_use" } });
    expect(JSON.stringify(asistent!.jurnal)).not.toContain("secret");
  });

  it("la eroare pune mesajul in jurnal; randurile care nu sunt JSON se sar", () => {
    expect(evenimentClaudeCode(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "Claude AI usage limit reached" })))
      .toMatchObject({ fel: "rezultat", jurnal: { eroare: "Claude AI usage limit reached" } });
    expect(evenimentClaudeCode("nu e json")).toBeNull();
  });
});


describe("mesajEroareClaudeCode", () => {
  it("spune pe romaneste cand Claude Code nu e logat sau a atins limita; restul raman neschimbate", () => {
    const autentificare = 'Claude Code: Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth access token is invalid."}}';
    expect(mesajEroareClaudeCode(autentificare)).toMatch(/nu e logat.*\/login/);
    expect(() => continutLocal("claude", JSON.stringify({ type: "result", subtype: "success", is_error: true, result: autentificare.slice(13) }))).toThrow(/nu e logat/);
    expect(mesajEroareClaudeCode("Claude AI usage limit reached|1789400000")).toMatch(/^Ai atins limita planului/);
    expect(mesajEroareClaudeCode("Credit balance is too low")).toBe("Credit balance is too low");
  });
});

describe("verificarea intregului document", () => {
  it("trimite paragrafele cu locul lor si citeste corecturile impreuna cu observatiile", () => {
    expect(JSON.parse(mesajVerificare([{ i: 3, text: "Penitenciarul nr.6", fel: "antet" }]))).toEqual({
      paragrafe: [{ i: 3, unde: "antet", text: "Penitenciarul nr.6" }],
    });
    expect(PROMPT_VERIFICARE).toContain("observatii");

    const raspuns = JSON.stringify({
      corecturi: [{ i: 3, vechi: "nr.6", nou: "nr. 6", tip: "punctuație", motiv: "Spațiu după „nr.”." }],
      observatii: [
        { tip: "date", text: "„din 02.01.2018” față de „reținut la 02.10.2018”: datele nu se potrivesc.", solutie: "Pune data din sentință în ambele locuri." },
        { tip: "inventat", text: "tip necunoscut" },
        { tip: "lipsa", text: "   " },
      ],
    });
    expect(extrageVerificare(raspuns, new Set([3]))).toEqual({
      corecturi: [{ i: 3, vechi: "nr.6", nou: "nr. 6", tip: "punctuație", motiv: "Spațiu după „nr.”." }],
      observatii: [
        { tip: "date", text: "„din 02.01.2018” față de „reținut la 02.10.2018”: datele nu se potrivesc.", solutie: "Pune data din sentință în ambele locuri.", corectura: undefined },
        { tip: "altele", text: "tip necunoscut", solutie: "", corectura: undefined },
      ],
    });
    expect(extrageVerificare('{"corecturi":[],"observatii":[]}', new Set([1]))).toEqual({ corecturi: [], observatii: [] });
    // Un raspuns stricat nu se citeste ca „document curat”: 15 sept. 2026, Gemini 3.8 Flash a intors text
    // fara JSON dupa 125.000 de jetoane, iar documentul parea fara greseli.
    expect(() => extrageVerificare("Am verificat documentul și nu am observații.", new Set([1]))).toThrow(/nu a întors verificarea/);
    expect(() => extrageVerificare('{"corecturi":[{"i":1,', new Set([1]))).toThrow(/nu a întors verificarea/);
  });

  it("citeste solutia si inlocuirea propusa; o inlocuire invalida se arunca, observatia ramane", () => {
    const raspuns = JSON.stringify({
      corecturi: [],
      observatii: [
        { tip: "date", text: "„Tel-fax: 0 230 23674” față de „Тел-факс: 0 230 23567”.", solutie: "Pune același număr în ambele.", corectura: { i: 1, vechi: "23567", nou: "23674" } },
        { tip: "lipsa", text: "Rubrica „nr.” e goală.", solutie: "Completează numărul de ieșire." },
        { tip: "juridic", text: "Trimiterea la art. 470.", solutie: "Verifică textul în vigoare.", corectura: { i: 99, vechi: "x", nou: "y" } },
      ],
    });
    const o = extrageVerificare(raspuns, new Set([1])).observatii;
    expect(o.map((x) => x.solutie)).toEqual(["Pune același număr în ambele.", "Completează numărul de ieșire.", "Verifică textul în vigoare."]);
    expect(o.map((x) => x.corectura)).toEqual([{ i: 1, vechi: "23567", nou: "23674" }, undefined, undefined]);
  });

  it("arunca observatiile despre mentiunea obligatorie, care se verifica in cod", () => {
    const raspuns = JSON.stringify({
      corecturi: [],
      observatii: [
        { tip: "juridic", text: "„Legea Republicii Moldova nr. 160 din 30.07.2026” din mențiunea despre datele cu caracter personal: de verificat." },
        { tip: "lipsa", text: "Rubrica „Anexă pe: ___ file” a rămas necompletată." },
      ],
    });
    expect(extrageVerificare(raspuns, new Set([1])).observatii.map((o) => o.tip)).toEqual(["lipsa"]);
  });
});
