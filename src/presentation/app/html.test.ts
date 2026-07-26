import { describe, expect, it } from "vitest";
import { html, markup } from "./html";

describe("html", () => {
  it("escapa string interpolada", () => {
    expect(markup(html`<p>${'<b>&"x\'</b>'}</p>`)).toBe("<p>&lt;b&gt;&amp;&quot;x&#39;&lt;/b&gt;</p>");
  });

  it("insere marcação aninhada sem reescapar", () => {
    expect(markup(html`<ul>${html`<li>${"a&b"}</li>`}</ul>`)).toBe("<ul><li>a&amp;b</li></ul>");
  });

  it("junta array aplicando a regra de cada item", () => {
    expect(markup(html`${[html`<i></i>`, "a&b", 7]}`)).toBe("<i></i>a&amp;b7");
  });

  it("descarta null, undefined e false", () => {
    expect(markup(html`[${null}${undefined}${false}]`)).toBe("[]");
  });

  it("interpola número sem passar pelo escape", () => {
    expect(markup(html`<span>${42}</span>`)).toBe("<span>42</span>");
  });
});
