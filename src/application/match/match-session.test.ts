import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "../profile/create-default-profile";
import { buildMatchConfig } from "./build-match-config";
import { MatchSession, SIMULATION_SPEEDS } from "./match-session";

const createSession = (seed = 2026): MatchSession => new MatchSession(buildMatchConfig(createDefaultProfile(), seed));

describe("MatchSession", () => {
  it("nao avanca quando pausada ou quando a partida terminou", () => {
    const session = createSession();
    session.setPaused(true);
    expect(session.advance(0.1)).toBe(0);
    expect(session.state.elapsed).toBe(0);

    session.setPaused(false);
    session.state.finished = true;
    expect(session.advance(0.1)).toBe(0);
    expect(session.state.elapsed).toBe(0);
  });

  it.each([
    [0.5, 6],
    [1, 12],
    [2, 24],
    [4, 47],
    [8, 96],
  ] as const)("aplica a velocidade %sx", (speed, expectedSteps) => {
    const session = createSession();
    session.setSpeed(speed);

    expect(session.advance(0.1)).toBe(expectedSteps);
  });

  it("limita o delta real e respeita o teto de seguranca", () => {
    const session = createSession();
    session.setSpeed(8);

    const steps = session.advance(10);

    expect(steps).toBe(96);
    expect(steps).toBeLessThanOrEqual(140);
  });

  it("ignora deltas negativos e nao finitos", () => {
    const session = createSession();

    expect(session.advance(-1)).toBe(0);
    expect(session.advance(Number.NaN)).toBe(0);
    expect(session.advance(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("reinicia o estado e o acumulador preservando pausa e velocidade", () => {
    const session = createSession();
    session.setSpeed(2);
    session.advance(0.004);
    session.setPaused(true);

    session.restart(buildMatchConfig(createDefaultProfile(), 99));
    session.setPaused(false);

    expect(session.speed).toBe(2);
    expect(session.state.randomSeed).toBe(99);
    expect(session.advance(0.004)).toBe(0);
  });

  it("rejeita velocidades fora do contrato", () => {
    const session = createSession();

    expect(SIMULATION_SPEEDS).toEqual([0.5, 1, 2, 4, 8]);
    expect(() => session.setSpeed(3 as never)).toThrow(RangeError);
  });
});
