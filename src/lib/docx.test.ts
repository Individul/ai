import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  adaugaParagrafLaSfarsit, analizeazaDocument, analizeazaIntreg, aplicaCorecturi, aplicaCorecturiIntreg, deschideDocx, diferente,
  EroareDocx, paragrafeDeCorectat, paragrafeIntreg, salveazaDocx, salveazaDocxParti, type Corectura,
} from "./docx";

const doc = (corp: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corp}<w:sectPr/></w:body></w:document>`;
const TIMES = `<w:rFonts w:ascii="Times"/><w:sz w:val="24"/>`;
const run = (text: string, rPr = TIMES) => `<w:r w:rsidR="00A1"><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const par = (...continut: string[]) => `<w:p><w:pPr><w:spacing w:after="240"/></w:pPr>${continut.join("")}</w:p>`;
const REV = { autor: "Corector AI", data: "2026-09-14T10:00:00Z" };
const c = (i: number, vechi: string, nou: string): Corectura => ({ i, vechi, nou, tip: "ortografie", motiv: "" });

// Textul fiecarui paragraf dupa ce toate reviziile sunt acceptate sau respinse in Word.
function textDupa(xml: string, fel: "accept" | "resping"): string[] {
  const x = fel === "accept"
    ? xml.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, "")
    : xml.replace(/<w:ins\b[^>]*>[\s\S]*?<\/w:ins>/g, "").replace(/w:delText/g, "w:t");
  return [...x.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((m) =>
    [...m[1]!.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>|<w:tab\/>/g)]
      .map((t) => t[1] ?? "\t").join("")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  );
}

// Tagurile se inchid in ordine.
function bineFormat(xml: string): boolean {
  const stiva: string[] = [];
  for (const t of xml.match(/<[^>]*>/g) ?? []) {
    if (t.startsWith("<?") || t.endsWith("/>")) continue;
    const nume = /^<\/?([^\s/>]+)/.exec(t)![1]!;
    if (t[1] === "/") { if (stiva.pop() !== nume) return false; } else stiva.push(nume);
  }
  return stiva.length === 0;
}

describe("adaugaParagrafLaSfarsit", () => {
  it("pune paragraful ca revizie inaintea sectiunii finale: acceptat apare, respins dispare", () => {
    const xml = doc(par(run("Primul.")) + par(`<w:ins w:id="7" w:author="X" w:date="${REV.data}">${run("Deja inserat.")}</w:ins>`));
    const nou = adaugaParagrafLaSfarsit(xml, [{ text: "Atenție: " }, { text: "Legea nr. 1", bold: true }, { text: " & rest." }], REV, 20);
    expect(bineFormat(nou)).toBe(true);
    expect(nou.indexOf("Legea nr. 1")).toBeLessThan(nou.indexOf("<w:sectPr/>"));
    expect(textDupa(nou, "accept").at(-1)).toBe("Atenție: Legea nr. 1 & rest.");
    expect(textDupa(nou, "resping")).not.toContain("Atenție: Legea nr. 1 & rest.");
    // id-urile noi trec de cele existente; si semnul de paragraf e inserat, ca respingerea sa scoata tot paragraful
    expect(nou).toMatch(/<w:rPr><w:ins w:id="8" [^>]*\/><w:sz w:val="20"\/><w:szCs w:val="20"\/><\/w:rPr><\/w:pPr><w:ins w:id="9" /);
    expect(nou).toContain('<w:rPr><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">Legea nr. 1</w:t>');
    expect(nou).toContain("&amp; rest.");
  });

  it("fara sectPr, paragraful merge la sfarsitul corpului", () => {
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${par(run("Unu."))}</w:body></w:document>`;
    const nou = adaugaParagrafLaSfarsit(xml, [{ text: "Doi." }], REV);
    expect(textDupa(nou, "accept")).toEqual(["Unu.", "Doi."]);
    expect(nou.endsWith("</w:ins></w:p></w:body></w:document>")).toBe(true);
    expect(() => adaugaParagrafLaSfarsit("<w:document/>", [{ text: "x" }], REV)).toThrow(EroareDocx);
  });
});

describe("corecturi exacte", () => {
  it("la exact, ş/ţ cu sedila se inlocuiesc cu ș/ț; fara, raman echivalente si nu se ating", () => {
    const a = analizeazaDocument(doc(par(run("Atenţie: conţine date."))));
    const obisnuita = aplicaCorecturi(a, [c(0, "Atenţie: conţine date.", "Atenție: conține date.")], REV);
    expect(obisnuita.aplicari[0]!.stare).toBe("fara_schimbare");
    const exacta = aplicaCorecturi(a, [{ ...c(0, "Atenţie: conţine date.", "Atenție: conține date."), exact: true }], REV);
    expect(exacta.aplicari[0]!.stare).toBe("aplicata");
    expect(textDupa(exacta.xml, "accept")).toEqual(["Atenție: conține date."]);
    expect(textDupa(exacta.xml, "resping")).toEqual(["Atenţie: conţine date."]);
    expect(diferente("conţine", "conține", true)).toEqual([{ de: 0, pana: 7, ins: "conține" }]);
  });
});

describe("analizeazaDocument", () => {
  it("scoate textul paragrafelor, si din tabele, cu entitatile decodate", () => {
    const xml = doc(
      par(run("Deţinutii au fost "), run("informati", TIMES + "<w:b/>"), run(" despre drepturi &amp; obligații.")) +
      `<w:tbl><w:tr><w:tc>${par(run("Celula cu greseala."))}</w:tc></w:tr></w:tbl>` +
      par() + par(run("12"))
    );
    const a = analizeazaDocument(xml);
    expect(a.paragrafe.map((p) => p.text)).toEqual(["Deţinutii au fost informati despre drepturi & obligații.", "Celula cu greseala.", "", "12"]);
    expect(paragrafeDeCorectat(a)).toEqual([
      { i: 0, text: "Deţinutii au fost informati despre drepturi & obligații." },
      { i: 1, text: "Celula cu greseala." },
    ]);
  });

  it("tab-ul, campurile si reviziile existente se vad, dar nu se pot corecta; textul sters nu apare", () => {
    const xml = doc(par(
      run("Nr."), `<w:r><w:tab/><w:t>123</w:t></w:r>`,
      `<w:ins w:id="7" w:author="Ion" w:date="2026-01-01T00:00:00Z">${run(" adaugat")}</w:ins>`,
      `<w:del w:id="8" w:author="Ion" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>sters</w:delText></w:r></w:del>`,
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run("5")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`,
      `<w:hyperlink r:id="rId3">${run(" link")}</w:hyperlink>`,
    ));
    const p = analizeazaDocument(xml).paragrafe[0]!;
    expect(p.text).toBe("Nr.\t123 adaugat5 link");
    const editabil = (fragment: string) => {
      const de = p.text.indexOf(fragment);
      return p.editabil.slice(de, de + fragment.length);
    };
    expect(editabil("Nr.")).toEqual([true, true, true]);
    expect(editabil("\t")).toEqual([false]);
    expect(editabil("123")).toEqual([true, true, true]);
    expect(editabil(" adaugat").includes(true)).toBe(false);
    expect(editabil("5")).toEqual([false]);
    expect(editabil(" link").includes(false)).toBe(false);
  });

  it("paragraful dintr-o caseta de text e separat de cel care o contine", () => {
    const xml = doc(par(run("Afară "), `<w:r><w:drawing><wps:txbx><w:txbxContent>${par(run("Înăuntru"))}</w:txbxContent></wps:txbx></w:drawing></w:r>`));
    expect(analizeazaDocument(xml).paragrafe.map((p) => p.text)).toEqual(["Afară ", "Înăuntru"]);
  });
});

describe("diferente", () => {
  it("marcheaza doar cuvintele schimbate", () => {
    expect(diferente("sa fie facut", "să fie făcut")).toEqual([{ de: 0, pana: 2, ins: "să" }, { de: 7, pana: 12, ins: "făcut" }]);
    expect(diferente("procesul verbal", "procesul-verbal")).toEqual([{ de: 8, pana: 9, ins: "-" }]);
    expect(diferente("în conformitate cu prevederile art. 5", "în conformitate cu art. 5")).toEqual([{ de: 19, pana: 31, ins: "" }]);
  });

  it("ş/ţ cu sedila si ș/ț cu virgula sunt acelasi text", () => {
    expect(diferente("ţinut", "ținut")).toEqual([]);
    expect(diferente("Deţinutii", "Deținuții")).toEqual([{ de: 0, pana: 9, ins: "Deținuții" }]);
  });
});

describe("aplicaCorecturi", () => {
  const ORIGINAL = doc(
    par(run("Deţinutii au fost "), run("informati", TIMES + "<w:b/>"), run(" despre drepturi, insa nu toti au semnat procesul verbal.")) +
    par(run("In conformitate cu prevederile "), run("art. 91", TIMES + "<w:i/>"), run(" din Codul penal se v-a examina cererea."))
  );

  it("pune corecturile ca revizii; acceptate dau textul nou, respinse pe cel vechi", () => {
    const { xml, aplicari } = aplicaCorecturi(analizeazaDocument(ORIGINAL), [
      c(0, "Deţinutii", "Deținuții"), c(0, "fost informati despre", "fost informați despre"), c(0, "insa", "însă"), c(0, "toti", "toți"),
      c(0, "procesul verbal", "procesul-verbal"),
      c(1, "In conformitate cu prevederile art. 91", "În conformitate cu art. 91"), c(1, "se v-a examina", "se va examina"),
    ], REV);
    expect(aplicari.map((x) => x.stare)).toEqual(Array(7).fill("aplicata"));
    expect(bineFormat(xml)).toBe(true);
    expect(textDupa(xml, "accept")).toEqual([
      "Deținuții au fost informați despre drepturi, însă nu toți au semnat procesul-verbal.",
      "În conformitate cu art. 91 din Codul penal se va examina cererea.",
    ]);
    expect(textDupa(xml, "resping")).toEqual(textDupa(ORIGINAL, "accept"));
  });

  it("revizia pastreaza formatarea run-ului, iar run-urile neatinse raman octet cu octet", () => {
    const { xml } = aplicaCorecturi(analizeazaDocument(ORIGINAL), [c(0, "informati", "informați"), c(1, "v-a", "va")], REV);
    expect(xml).toContain(
      `<w:del w:id="1" w:author="Corector AI" w:date="2026-09-14T10:00:00Z"><w:r w:rsidR="00A1"><w:rPr>${TIMES}<w:b/></w:rPr><w:delText xml:space="preserve">informati</w:delText></w:r></w:del>` +
      `<w:ins w:id="2" w:author="Corector AI" w:date="2026-09-14T10:00:00Z"><w:r w:rsidR="00A1"><w:rPr>${TIMES}<w:b/></w:rPr><w:t xml:space="preserve">informați</w:t></w:r></w:ins>`
    );
    expect(xml).toContain(run("Deţinutii au fost "));
    expect(xml).toContain(run("art. 91", TIMES + "<w:i/>"));
  });

  it("numeroteaza reviziile dupa cel mai mare w:id din document", () => {
    const xml = doc(`<w:bookmarkStart w:id="41" w:name="x"/>` + par(run("un cuvant gresit")) + `<w:bookmarkEnd w:id="41"/>`);
    const { xml: nou } = aplicaCorecturi(analizeazaDocument(xml), [c(0, "cuvant gresit", "cuvânt greșit")], REV);
    expect([...nou.matchAll(/<w:(?:ins|del) w:id="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([42, 43, 44, 45]);
  });

  it("spune de ce o corectura nu s-a putut pune", () => {
    const xml = doc(par(run("Nr."), `<w:r><w:tab/><w:t>123 din data de azi, azi.</w:t></w:r>`));
    const { xml: nou, aplicari } = aplicaCorecturi(analizeazaDocument(xml), [
      c(0, "nu exista", "nu există"),   // negasita
      c(0, "Nr. 123", "Nr. 124"),       // blocata: trece prin tab
      c(0, "azi", "astăzi"),            // aplicata pe prima aparitie
      c(0, "de azi", "de ieri"),        // suprapusa peste cea de dinainte
      c(0, "azi.", "azi."),             // fara_schimbare
      c(99, "x", "y"),                  // paragraf inexistent
    ], REV);
    expect(aplicari.map((x) => x.stare)).toEqual(["negasita", "blocata", "aplicata", "suprapusa", "fara_schimbare", "negasita"]);
    expect(aplicari[2]).toMatchObject({ vechi: "azi", inainte: "Nr.\t123 din data de ", dupa: ", azi." });
    expect(textDupa(nou, "accept")).toEqual(["Nr.\t123 din data de astăzi, azi."]);
    expect(bineFormat(nou)).toBe(true);
  });

  it("insereaza intre run-uri, escapeaza textul nou si gaseste fragmentul cu ghilimele copiate altfel", () => {
    const xml = doc(par(run("Conform ordinului nr. 5"), run(" s-a decis „urgent”.")));
    const { xml: nou, aplicari } = aplicaCorecturi(analizeazaDocument(xml), [
      c(0, "nr. 5 s-a", "nr. 5, s-a"),
      c(0, 'decis "urgent"', "decis <R&D> „urgent”"),
    ], REV);
    expect(aplicari.map((x) => x.stare)).toEqual(["aplicata", "aplicata"]);
    expect(nou).toContain("&lt;R&amp;D&gt;");
    expect(bineFormat(nou)).toBe(true);
    expect(textDupa(nou, "accept")).toEqual(["Conform ordinului nr. 5, s-a decis <R&D> „urgent”."]);
  });
});

describe("deschideDocx / salveazaDocx", () => {
  it("ia partea principala din _rels si o inlocuieste, pastrand restul arhivei in ordine", () => {
    const rels = `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="word/document2.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/></Relationships>`;
    const zip = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"), "_rels/.rels": strToU8(rels),
      "word/document2.xml": strToU8(doc(par(run("text")))), "word/media/a.png": new Uint8Array([1, 2, 3]),
    });
    const d = deschideDocx(zip);
    expect(d.cale).toBe("word/document2.xml");
    expect(analizeazaDocument(d.xml).paragrafe[0]!.text).toBe("text");
    const iesire = unzipSync(salveazaDocx(d, "<nou/>"));
    expect(Object.keys(iesire)).toEqual(["[Content_Types].xml", "_rels/.rels", "word/document2.xml", "word/media/a.png"]);
    expect(strFromU8(iesire["word/document2.xml"]!)).toBe("<nou/>");
    expect([...iesire["word/media/a.png"]!]).toEqual([1, 2, 3]);
  });

  it("refuza ce nu e .docx", () => {
    expect(() => deschideDocx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toThrow(EroareDocx);
    expect(() => deschideDocx(zipSync({ "altceva.txt": strToU8("x") }))).toThrow(EroareDocx);
  });
});

describe("documentul intreg (corp, antete, subsoluri)", () => {
  const arhiva = () => {
    const rels = `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="word/document.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/></Relationships>`;
    return deschideDocx(zipSync({
      "_rels/.rels": strToU8(rels),
      "word/document.xml": strToU8(doc(par(run("In corp scrie insa gresit.")) + par(run("Al doilea paragraf.")))),
      "word/header1.xml": strToU8(doc(par(run("Penitenciarul nr.6")))),
      "word/footer1.xml": strToU8(doc(par(run("Tel-fax 0 230 23674")))),
      "word/styles.xml": strToU8("<w:styles/>"),
    }));
  };

  it("citeste toate partile, cu numere globale de paragraf", () => {
    const d = analizeazaIntreg(arhiva());
    expect(d.parti.map((p) => [p.cale, p.fel])).toEqual([
      ["word/document.xml", "corp"], ["word/footer1.xml", "subsol"], ["word/header1.xml", "antet"],
    ]);
    expect(paragrafeIntreg(d)).toEqual([
      { i: 0, text: "In corp scrie insa gresit.", fel: "corp" },
      { i: 1, text: "Al doilea paragraf.", fel: "corp" },
      { i: 2, text: "Tel-fax 0 230 23674", fel: "subsol" },
      { i: 3, text: "Penitenciarul nr.6", fel: "antet" },
    ]);
  });

  it("pune corecturile in partea lor si salveaza doar partile atinse", () => {
    const docx = arhiva();
    const d = analizeazaIntreg(docx);
    const { xml, aplicari } = aplicaCorecturiIntreg(d, [
      { i: 0, vechi: "insa", nou: "însă", tip: "ortografie", motiv: "" },
      { i: 3, vechi: "nr.6", nou: "nr. 6", tip: "punctuație", motiv: "" },
      { i: 9, vechi: "x", nou: "y", tip: "ortografie", motiv: "" },
    ], REV);
    expect(aplicari.map((a) => a.stare)).toEqual(["aplicata", "aplicata", "negasita"]);
    expect(Object.keys(xml).sort()).toEqual(["word/document.xml", "word/header1.xml"]);
    expect(textDupa(xml["word/header1.xml"]!, "accept")).toEqual(["Penitenciarul nr. 6"]);
    expect(textDupa(xml["word/document.xml"]!, "accept")[0]).toBe("In corp scrie însă gresit.");
    const iesire = unzipSync(salveazaDocxParti(docx, xml));
    expect(strFromU8(iesire["word/footer1.xml"]!)).toBe(strFromU8(docx.intrari["word/footer1.xml"]!));
    expect(strFromU8(iesire["word/header1.xml"]!)).toContain("<w:ins ");
  });
});
