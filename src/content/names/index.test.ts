import { describe, expect, it } from "vitest";
import { isKnownCountry } from "../countries";
import { clubNamePartsFor, countriesWithNames, hasOwnNames, mixedNameCatalog, nameCatalogFor } from "./index";

describe("listas de nomes", () => {
  it("carrega os arquivos da pasta e conhece cada país declarado", () => {
    const countries = countriesWithNames();
    expect(countries.length).toBeGreaterThan(0);
    expect(countries).toContain("BR");
    for (const country of countries) expect(isKnownCountry(country)).toBe(true);
  });

  it("devolve listas não vazias para país com arquivo próprio", () => {
    const catalog = nameCatalogFor("BR");
    expect(hasOwnNames("BR")).toBe(true);
    expect(catalog.country).toBe("BR");
    expect(catalog.firstNames.length).toBeGreaterThan(10);
    expect(catalog.lastNames.length).toBeGreaterThan(10);
  });

  it("empresta a união das listas para país sem arquivo", () => {
    expect(hasOwnNames("JP")).toBe(false);
    const borrowed = nameCatalogFor("JP");
    const mixed = mixedNameCatalog();

    expect(borrowed).toBe(mixed);
    expect(borrowed.firstNames.length).toBeGreaterThanOrEqual(nameCatalogFor("BR").firstNames.length);
  });

  it("não repete nomes na união das listas", () => {
    const mixed = mixedNameCatalog();
    expect(new Set(mixed.firstNames).size).toBe(mixed.firstNames.length);
    expect(new Set(mixed.lastNames).size).toBe(mixed.lastNames.length);
  });

  it("entrega partes de nome de clube com ou sem arquivo do país", () => {
    for (const country of ["BR", "JP"]) {
      const parts = clubNamePartsFor(country);
      expect(parts.cities.length).toBeGreaterThan(0);
      expect(parts.prefixes.length).toBeGreaterThan(0);
      expect(parts.suffixes.length).toBeGreaterThan(0);
    }
  });
});
