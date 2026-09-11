import { describe, expect, it } from "vitest";
import { legaReferinte } from "./referinte";

const CITARI = [
  { sursa_id: "s1", titlu: "Instrucțiune", pagina: 35 },
  { sursa_id: "s2", titlu: "Codul de executare al Republicii Moldova", pagina: 118 },
];

describe("legaReferinte", () => {
  it("transforma [Titlu, pag. N] in link spre PDF la pagina, cu titlul scurt", () => {
    const html = legaReferinte("<p>Se face cu cerneală neagră (pct. 218) [Instrucțiune, pag. 35].</p>", CITARI);
    expect(html).toBe(
      '<p>Se face cu cerneală neagră (pct. 218) <a class="ref" href="/f/pdf/s1#page=35" target="_blank" rel="noopener" title="Instrucțiune, pagina 35">Instrucțiune, p. 35</a>.</p>'
    );
  });

  it("potriveste titlul fara diacritice, prin prefix, scurteaza titlurile lungi si ignora ce e dupa pagina", () => {
    const html = legaReferinte("x [Codul de executare, pag. 118, art. 216] y [instructiune, p. 36]", CITARI);
    expect(html).toContain('href="/f/pdf/s2#page=118"');
    expect(html).toContain(">Codul de executare…, p. 118<");
    expect(html).toContain('href="/f/pdf/s1#page=36"');
  });

  it("fara sursa cunoscuta ramane span; textul deja escapat nu se escapeaza a doua oara", () => {
    const html = legaReferinte("[Alt &lt;act&gt;, pag. 2]", CITARI);
    expect(html).toBe('<span class="ref" title="Alt &lt;act&gt;, pagina 2">Alt &lt;act&gt;, p. 2</span>');
  });

  it("nu atinge textul fara referinte sau linkurile Markdown", () => {
    expect(legaReferinte("<p>fără [paranteze] de pagină</p>", CITARI)).toBe("<p>fără [paranteze] de pagină</p>");
  });
});
