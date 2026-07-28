/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

/**
 * A apresentação lê a partida pela porta da frente (`domain/match`), nunca pelos sistemas nem
 * pelo runtime: quem desenha não tem por que saber em que módulo o motor guarda cada regra, e
 * enquanto sabia, reorganizar o motor quebrava a tela.
 *
 * `domain/match/model` e `domain/match/config` seguem liberados — são a declaração (os tipos e as
 * medidas do campo), não o mecanismo.
 */
const FORBIDDEN_IMPORT = /from\s+"[^"]*domain\/match\/(systems|runtime)\//g;

const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("fronteiras da apresentacao", () => {
  it("nao importa as entranhas do motor", () => {
    const offenders = Object.entries(sources)
      .flatMap(([path, source]) => (source.match(FORBIDDEN_IMPORT) ?? []).map((line) => `${path} → ${line.trim()}`));

    expect(offenders).toEqual([]);
  });

  it("enxerga os fontes que deveria vigiar", () => {
    // Rede de segurança do próprio teste: um glob que não casa com nada passaria calado.
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });
});
