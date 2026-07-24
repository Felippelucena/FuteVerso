import { describe, expect, it } from "vitest";
import type { PlayerPosition } from "../roster/model";
import { positionFit } from "./position-fit";
import { findSlot, type TacticalSlot } from "./slots";

const slot = (id: string): TacticalSlot => findSlot(id)!;

const player = (position: PlayerPosition, secondaryPositions: PlayerPosition[] = []) =>
  ({ position, secondaryPositions });

describe("positionFit", () => {
  it("dá encaixe natural na posição preferencial do slot", () => {
    expect(positionFit(player("centerBack"), slot("zag-e"))).toEqual({ level: "natural", rating: 1 });
    expect(positionFit(player("goalkeeper"), slot("gol"))).toEqual({ level: "natural", rating: 1 });
  });

  it("reconhece posição permitida que não é a preferencial", () => {
    const fit = positionFit(player("defensiveMid"), slot("zag"));
    expect(fit.level).toBe("accomplished");
    expect(fit.rating).toBeLessThan(1);
    expect(fit.rating).toBeGreaterThan(0.9);
  });

  it("aproveita a posição secundária do jogador", () => {
    const fit = positionFit(player("centerBack", ["rightBack"]), slot("ld"));
    expect(fit.level).toBe("secondary");
    expect(fit.rating).toBe(0.9);
  });

  it("bloqueia goleiro na linha e jogador de linha no gol", () => {
    expect(positionFit(player("goalkeeper"), slot("zag")).level).toBe("blocked");
    expect(positionFit(player("striker"), slot("gol")).level).toBe("blocked");
  });

  it("penaliza improviso conforme a distância entre as linhas", () => {
    const nearby = positionFit(player("centerBack"), slot("med"));
    const distant = positionFit(player("striker"), slot("zag-e"));

    expect(nearby.level).toBe("awkward");
    expect(distant.level).toBe("makeshift");
    expect(distant.rating).toBeLessThan(nearby.rating);
    expect(distant.rating).toBeGreaterThanOrEqual(0.55);
  });

  it("cobra a mais por jogar do lado trocado", () => {
    const ownSide = positionFit(player("leftWing"), slot("ee"));
    const wrongSide = positionFit(player("leftWing"), slot("ed"));

    expect(wrongSide.rating).toBeLessThan(ownSide.rating);
  });

  it("nunca zera o desempenho de quem apenas está improvisando", () => {
    for (const position of ["striker", "centerBack", "rightWing"] as PlayerPosition[]) {
      for (const slotId of ["zag-e", "ce", "med", "ee"]) {
        const fit = positionFit(player(position), slot(slotId));
        if (fit.level === "blocked") continue;
        expect(fit.rating).toBeGreaterThanOrEqual(0.55);
        expect(fit.rating).toBeLessThanOrEqual(1);
      }
    }
  });
});
