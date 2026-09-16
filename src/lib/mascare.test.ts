import { describe, expect, it } from "vitest";
import {
  desfaceCorectura, desfaceCorecturi, desfaceObservatii, desfaceText, gasesteDate, mascheaza, pregateste,
  rezumatMascare, reziduu, scapatInDocument, verificaDate, type Entitate, type Fel,
} from "./mascare";
import { NUME_FALSE } from "./nume-md";

// Un demers ca cele reale: antet de institutie, datele condamnatului, o trimitere mai departe la nume scurt,
// contacte in subsol, bloc de semnatura.
const ACT = [
  { i: 0, text: "ADMINISTRAȚIA NAȚIONALĂ A PENITENCIARELOR" },
  { i: 1, text: "Penitenciarul nr. 13 - Chișinău, str. Nicolae Titulescu 35, mun. Chișinău" },
  { i: 2, text: "Solicităm examinarea demersului în privința condamnatului Cazacu Valeriu Simion, IDNP 2004005123456, născut la 12.03.1985, domiciliat în str. Alexandru cel Bun 15, ap. 7." },
  { i: 3, text: "Cazacu a fost transferat în Penitenciarul nr. 13 la data de 4 septembrie 2026, în temeiul art. 84 alin. (4) din Codul penal." },
  { i: 4, text: "Relații la tel. 022 409 715 sau la adresa serviciu@anp.gov.md." },
  { i: 5, text: "Șef al Direcției securitate, colonel Rotaru Ion" },
];

const felurile = (e: Entitate[], fel: Fel) => e.filter((x) => x.fel === fel).map((x) => x.text);
const tot = (paragrafe: { text: string }[]) => paragrafe.map((p) => p.text).join("\n");

describe("gasirea datelor personale", () => {
  const entitati = gasesteDate(ACT);

  it("gaseste numele, si acolo unde e scris singur mai incolo", () => {
    expect(felurile(entitati, "persoana")).toEqual(["Cazacu Valeriu Simion", "Cazacu", "Rotaru Ion"]);
  });

  it("gaseste identificatorii", () => {
    expect(felurile(entitati, "idnp")).toEqual(["2004005123456"]);
    expect(felurile(entitati, "telefon")).toEqual(["022 409 715"]);
    expect(felurile(entitati, "email")).toEqual(["serviciu@anp.gov.md"]);
    expect(felurile(entitati, "nastere")).toEqual(["12.03.1985"]);
    expect(felurile(entitati, "adresa")).toEqual(["str. Nicolae Titulescu 35", "str. Alexandru cel Bun 15, ap. 7"]);
  });

  it("nu ia denumirile de institutii drept nume de oameni", () => {
    const text = felurile(entitati, "persoana").join(" ");
    for (const denumire of ["ADMINISTRAȚIA", "NAȚIONALĂ", "PENITENCIARELOR", "Penitenciarul", "Chișinău", "Direcției", "Codul"]) {
      expect(text).not.toContain(denumire);
    }
  });

  it("prinde si numele fara prenume cunoscut, dupa declansator sau grad", () => {
    const e = gasesteDate([
      { i: 0, text: "În privința deținutului Ghelbert Zaporojan s-a dispus transferul." },
      { i: 1, text: "Inspector Mocanu Vladislav" },
      { i: 2, text: "Raportul a fost întocmit de BUZILĂ Anatolie." },
    ]);
    expect(felurile(e, "persoana")).toEqual(["Ghelbert Zaporojan", "Mocanu Vladislav", "BUZILĂ Anatolie"]);
  });

  it("nu atinge antetul rusesc, dar ia numele dupa un declansator rusesc", () => {
    const e = gasesteDate([
      { i: 0, text: "МИНИСТЕРСТВО ЮСТИЦИИ РЕСПУБЛИКИ МОЛДОВА" },
      { i: 1, text: "Пенитенциарное учреждение №.6-Сорока" },
      { i: 2, text: "В отношении осужденного Казаку Валерий принято решение." },
    ]);
    expect(felurile(e, "persoana")).toEqual(["Казаку Валерий"]);
  });

  it("mai mascheaza si cuvintele cerute de om", () => {
    const e = gasesteDate([{ i: 0, text: "Dosarul a fost preluat de Osoianu." }], ["Osoianu"]);
    expect(felurile(e, "persoana")).toEqual(["Osoianu"]);
  });
});

describe("mascarea si desfacerea", () => {
  it("scoate datele adevarate din textul care pleaca", () => {
    const { paragrafe, harta } = pregateste(ACT, "tot");
    const plecat = tot(paragrafe);
    for (const adevarat of ["Cazacu", "Valeriu", "Simion", "Rotaru", "2004005123456", "022 409 715", "serviciu@anp.gov.md", "12.03.1985", "Titulescu"]) {
      expect(plecat).not.toContain(adevarat);
    }
    expect(plecat).toContain("condamnatului "); // fraza ramane intreaga, doar numele e altul
    expect(harta.perechi.length).toBeGreaterThan(5);
  });

  it("da acelasi nume fals peste tot, si pastreaza MAJUSCULELE", () => {
    const { paragrafe, harta } = pregateste([
      { i: 0, text: "condamnatul Cazacu Valeriu" },
      { i: 1, text: "Cazacu a solicitat" },
      { i: 2, text: "CAZACU VALERIU" },
    ], "tot");
    const fals = paragrafe[1]!.text.replace(" a solicitat", "");
    expect(paragrafe[0]!.text).toBe(`condamnatul ${fals} ${paragrafe[0]!.text.split(" ")[2]}`);
    expect(paragrafe[2]!.text).toBe(paragrafe[0]!.text.replace("condamnatul ", "").toUpperCase());
    expect(harta.perechi.filter((p) => p.adevarat === "Cazacu")).toHaveLength(1);
  });

  it("textul mascat se desface inapoi, caracter cu caracter", () => {
    const { paragrafe, harta } = pregateste(ACT, "tot");
    for (const [k, p] of paragrafe.entries()) expect(desfaceText(p.text, harta)).toBe(ACT[k]!.text);
  });

  it("nu ia un nume fals care seamana cu un cuvant din document", () => {
    const act = [{ i: 0, text: `Condamnatul Cazacu Valeriu și avocatul ${NUME_FALSE[0]} Ion au semnat.` }];
    const { paragrafe } = pregateste(act, "tot");
    expect(paragrafe[0]!.text).not.toContain(NUME_FALSE[0]);
  });

  it("la „identificatori” numele raman, la „fara” nu se atinge nimic", () => {
    const doar = pregateste(ACT, "identificatori");
    expect(tot(doar.paragrafe)).toContain("Cazacu Valeriu Simion");
    expect(tot(doar.paragrafe)).not.toContain("2004005123456");

    const deloc = pregateste(ACT, "fara");
    expect(tot(deloc.paragrafe)).toBe(tot(ACT));
    expect(deloc.harta.perechi).toEqual([]);
  });

  it("spune ce a ascuns", () => {
    const { harta } = pregateste(ACT, "tot");
    expect(rezumatMascare(harta)).toMatch(/^3 nume, 1 IDNP, 1 telefon/);
  });
});

describe("paznicii", () => {
  const act = [{ i: 0, text: "Condamnatul Cazacu Valeriu a fost transferat în penitenciar." }];
  const { paragrafe, harta } = pregateste(act, "tot");
  const numeFals = paragrafe[0]!.text.replace("Condamnatul ", "").replace(" a fost transferat în penitenciar.", "");

  it("lasa sa treaca o corectura care nu atinge datele mascate", () => {
    const c = { i: 0, vechi: "transferat în penitenciar", nou: "transferat în penitenciarul", tip: "gramatică", motiv: "articol" };
    expect(desfaceCorectura(c, harta)).toEqual({ ...c, vechi: "transferat în penitenciar", nou: "transferat în penitenciarul" });
  });

  it("arunca corectura care atinge zona mascata", () => {
    const c = { i: 0, vechi: `Condamnatul ${numeFals} a fost`, nou: `Condamnatului ${numeFals} i-a fost`, tip: "gramatică", motiv: "caz" };
    expect(desfaceCorectura(c, harta)).toBeNull();
  });

  it("arunca si corectura in care numele fals a ramas flexionat", () => {
    const flexionat = `${numeFals.split(" ")[0]}ului`;
    const c = { i: 0, vechi: "a fost transferat", nou: `${flexionat} i s-a dispus transferul`, tip: "formulare", motiv: "stil" };
    expect(desfaceCorectura(c, harta)).toBeNull();
    expect(reziduu(flexionat, harta)).toBe(true);
    expect(reziduu("Condamnatul a fost transferat", harta)).toBe(false);
  });

  it("numara ce a sarit", () => {
    const bune = { i: 0, vechi: "transferat în penitenciar", nou: "transferat în penitenciarul", tip: "gramatică", motiv: "articol" };
    const rea = { i: 0, vechi: `${numeFals} a fost`, nou: `${numeFals} este`, tip: "formulare", motiv: "timp" };
    expect(desfaceCorecturi([bune, rea], harta)).toMatchObject({ sarite: 1, corecturi: [{ vechi: "transferat în penitenciar" }] });
  });

  it("desface observatiile si le arunca pe cele despre date false", () => {
    const { observatii, sarite } = desfaceObservatii([
      { tip: "lipsa", text: "Rubrica „numărul de înregistrare” e goală.", solutie: "Completează numărul." },
      { tip: "date", text: `Numele „${numeFals}” apare o singură dată.`, solutie: "Verifică." },
      { tip: "date", text: `Verifică dacă ${numeFals.split(" ")[0]}ului i s-a comunicat.`, solutie: "Compară." },
    ], harta);
    expect(sarite).toBe(1);
    expect(observatii).toHaveLength(2);
    expect(observatii[1]!.text).toContain("Cazacu Valeriu");
  });

  it("opreste documentul daca un nume fals a ajuns totusi in textul de inserat", () => {
    expect(scapatInDocument([{ nou: "transferul condamnatului" }], harta)).toBe(false);
    expect(scapatInDocument([{ nou: `transferul lui ${numeFals}` }], harta)).toBe(true);
  });

  it("fara mascare, corecturile trec neatinse", () => {
    const { harta: goala } = pregateste(act, "fara");
    const c = { i: 0, vechi: "Cazacu Valeriu", nou: "Cazacu Valeriu Simion", tip: "formulare", motiv: "" };
    expect(desfaceCorectura(c, goala)).toEqual(c);
    expect(scapatInDocument([{ nou: "orice" }], goala)).toBe(false);
  });
});

describe("verificarile care raman in cod", () => {
  it("vede acelasi om scris in doua feluri, dar nu si forma scurta", () => {
    const e = gasesteDate([
      { i: 0, text: "Condamnatul Cazacu Valeriu Simion a depus cererea." },
      { i: 1, text: "Se dispune transferul lui Cazacu Valeriu Simeon." },
      { i: 2, text: "Demersul privind pe Cazacu Valeriu a fost examinat." },
    ]);
    const observatii = verificaDate(e);
    expect(observatii).toHaveLength(1);
    expect(observatii[0]!.text).toContain("Simion");
    expect(observatii[0]!.text).toContain("Simeon");
    expect(observatii[0]!.tip).toBe("date");
  });

  it("vede IDNP-urile care nu se potrivesc si pe cel cu alte cifre decat 13", () => {
    const e = gasesteDate([
      { i: 0, text: "IDNP 2004005123456, eliberat de ASP." },
      { i: 1, text: "Se indică IDNP 2004005123465 în dispozitiv." },
      { i: 2, text: "IDNP 200400512 la rubrica a treia." },
    ]);
    const texte = verificaDate(e).map((o) => o.text);
    expect(texte.some((t) => t.includes("aproape la fel"))).toBe(true);
    expect(texte.some((t) => t.includes("9 cifre, nu 13"))).toBe(true);
  });

  it("vede telefonul scurtat si data de nastere imposibila", () => {
    const e = gasesteDate([
      { i: 0, text: "Relații la tel. 022 409 71, născut la 31.02.1990." },
    ]);
    const texte = verificaDate(e).map((o) => o.text);
    expect(texte.some((t) => t.includes("nu 8"))).toBe(true);
    expect(texte.some((t) => t.includes("nu poate exista"))).toBe(true);
  });

  it("vede contactele care difera intre varianta romana si cea rusa, pe acelasi rand", () => {
    // In acte cele doua variante stau una langa alta, despartite de tab-uri (antetul demersului din Soroca).
    const antet = [
      { i: 0, text: "tel: 0 230 23674, fax: 0 230 23674\t\tТел. 0 230 23674; Тел-факс: 0 230 23567" },
      { i: 1, text: "e-mail: p6secretariat@anp.gov.md\t\tэл.адрес: p6secretariat@anp.gov.md" },
      { i: 2, text: "Relații suplimentare la e-mail: p6special@anp.gov.md" },
    ];
    const texte = verificaDate(gasesteDate(antet), antet).map((o) => o.text);
    expect(texte.some((t) => t.includes("varianta rusă") && t.includes("23567"))).toBe(true);
    // Alta adresa, din alt loc al documentului, nu intra in comparatie.
    expect(texte.some((t) => t.includes("p6special"))).toBe(false);
  });

  it("tace cand datele sunt in regula", () => {
    expect(verificaDate(gasesteDate(ACT), ACT)).toEqual([]);
  });
});

describe("mascarea nu incurca restul lantului", () => {
  it("pastreaza numerele paragrafelor si celelalte campuri", () => {
    const paragrafe = [{ i: 7, text: "Condamnatul Cazacu Valeriu", fel: "antet" }];
    const { paragrafe: iesire } = mascheaza(paragrafe, "tot", gasesteDate(paragrafe));
    expect(iesire[0]!.i).toBe(7);
    expect(iesire[0]!.fel).toBe("antet");
    expect(iesire[0]!.text).not.toContain("Cazacu");
  });
});
