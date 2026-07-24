import { describe, expect, it } from "vitest";
import { createMatchState, stepMatch } from "../../domain/match";
import { FIXED_STEP } from "../../domain/match/config";
import { createTestSetup, createTestWorld } from "../__fixtures__/test-world";
import { buildMatchConfig } from "./build-match-config";
import { MatchSession, SIMULATION_SPEEDS } from "./match-session";

const testWorld = createTestWorld();

const createConfig = (seed = 2026) => buildMatchConfig(testWorld, createTestSetup(testWorld), seed);

const createSession = (seed = 2026): MatchSession => new MatchSession(createConfig(seed));

const advanceToStep = (session: MatchSession, target: number): void => {
  while (session.liveStep < target && !session.state.finished) session.advance(0.1);
};

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

    session.restart(createConfig(99));
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

describe("MatchSession linha do tempo", () => {
  it("reconstrói um instante do passado de forma determinística", () => {
    const seed = 2026;
    const session = new MatchSession(createConfig(seed));
    advanceToStep(session, 600); // cruza os keyframes em 240 e 480

    // Referência independente: mesma configuração simulada do zero até o passo 250.
    const reference = createMatchState(createConfig(seed));
    for (let step = 0; step < 250; step += 1) stepMatch(reference, FIXED_STEP);

    session.seek(250);

    expect(session.viewStep).toBe(250);
    expect(session.scrubbing).toBe(true);
    expect(session.viewElapsed).toBeCloseTo(250 * FIXED_STEP);
    expect(session.state).toEqual(reference);
  });

  it("reproduz o passado para frente sem mover a fronteira ao vivo", () => {
    const session = createSession(7);
    advanceToStep(session, 480);
    const live = session.liveStep;

    session.seek(120);
    expect(session.scrubbing).toBe(true);

    const steps = session.advance(0.1); // agora reproduz o replay, não congela
    expect(steps).toBeGreaterThan(0);
    expect(session.viewStep).toBe(120 + steps);
    expect(session.liveStep).toBe(live); // fronteira intacta enquanto reproduz
    expect(session.scrubbing).toBe(true);

    // O quadro reproduzido bate com a simulação determinística até o mesmo passo.
    const reference = createMatchState(createConfig(7));
    for (let step = 0; step < 120 + steps; step += 1) stepMatch(reference, FIXED_STEP);
    expect(session.state).toEqual(reference);
  });

  it("congela o replay quando pausado ou arrastando o slider", () => {
    const session = createSession(7);
    advanceToStep(session, 480);
    session.seek(120);

    session.setPaused(true);
    expect(session.advance(0.1)).toBe(0);
    expect(session.viewStep).toBe(120);

    session.setPaused(false);
    session.beginSeek();
    expect(session.advance(0.1)).toBe(0); // o arrasto tem prioridade sobre o play
    expect(session.viewStep).toBe(120);
    session.endSeek();
    expect(session.advance(0.1)).toBeGreaterThan(0); // solto o slider, volta a tocar
  });

  it("reancora ao vivo quando o replay alcança a fronteira", () => {
    const session = createSession(7);
    advanceToStep(session, 240);
    const live = session.liveStep;

    session.seek(live - 5);
    expect(session.scrubbing).toBe(true);

    session.setSpeed(8); // passos suficientes para cobrir a folga em um advance
    session.advance(0.1);

    expect(session.scrubbing).toBe(false);
    expect(session.viewStep).toBe(live);
    expect(session.state).toBe(session.liveState); // reancorado na fronteira ao vivo
    expect(session.advance(0.1)).toBeGreaterThan(0); // e volta a avançar ao vivo
  });

  it("o botão ao vivo pula direto para a fronteira", () => {
    const session = createSession(7);
    advanceToStep(session, 480);
    const live = session.liveStep;

    session.seek(120);
    session.resumeLive();

    expect(session.scrubbing).toBe(false);
    expect(session.viewStep).toBe(live);
    expect(session.state).toBe(session.liveState);
  });

  it("limita o seek entre zero e a fronteira", () => {
    const session = createSession(7);
    advanceToStep(session, 240);
    const live = session.liveStep;

    session.seek(-100);
    expect(session.viewStep).toBe(0);
    expect(session.scrubbing).toBe(true);

    session.seek(999_999);
    expect(session.viewStep).toBe(live);
    expect(session.scrubbing).toBe(false);
  });

  it("descarta a linha do tempo ao reiniciar", () => {
    const session = createSession(7);
    advanceToStep(session, 480);
    session.seek(100);

    session.restart(createConfig(7));

    expect(session.liveStep).toBe(0);
    expect(session.viewStep).toBe(0);
    expect(session.scrubbing).toBe(false);
  });
});
