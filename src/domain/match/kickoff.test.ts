import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { FIELD, FIXED_STEP, HALF_DURATION, MATCH_DURATION, MATCH_HALVES } from "./config";
import { createMatchState, stepMatch } from "./index";
import type { MatchState } from "./model";
import { attackDirection } from "./runtime/formation-geometry";

const createState = (seed = 4242) => createMatchState(referenceMatchConfig(seed));

const distanceToCenter = (position: { x: number; y: number }): number =>
  Math.hypot(position.x - FIELD.width / 2, position.y - FIELD.height / 2);

/** Profundidade do jogador no próprio campo: negativa quando ele invadiu o campo adversário. */
const ownHalfDepth = (position: { x: number; y: number }, team: "blue" | "coral"): number =>
  attackDirection(team) > 0 ? FIELD.width / 2 - position.x : position.x - FIELD.width / 2;

const stepUntil = (state: MatchState, done: (state: MatchState) => boolean, seconds: number): void => {
  for (let tick = 0; tick < seconds * 120 && !done(state); tick += 1) stepMatch(state, FIXED_STEP);
};

describe("regra 8 — pontapé de saída", () => {
  it("põe a bola na marca central com um cobrador do time que sai jogando", () => {
    const state = createState();

    expect(state.ball.position).toEqual({ x: FIELD.width / 2, y: FIELD.height / 2 });
    expect(state.ball.velocity).toEqual({ x: 0, y: 0 });
    expect(state.kickoff).toMatchObject({ team: "blue", ballInPlay: false });
    const taker = state.players.find((player) => player.profile.id === state.kickoff?.takerId)!;
    expect(taker.team).toBe("blue");
    expect(taker.profile.position).not.toBe("goalkeeper");
  });

  it("mantém os dois times no próprio campo e o adversário fora do círculo central", () => {
    const state = createState();
    const kickoffTeam = state.kickoff!.team;

    for (const player of state.players) {
      // O corpo inteiro fica no próprio campo: quem cobra pode encostar na linha do meio.
      expect(ownHalfDepth(player.position, player.team)).toBeGreaterThanOrEqual(player.radius - 0.001);
      if (player.team === kickoffTeam) continue;
      // Regra 8: adversário a pelo menos 9,15 m da bola, ou seja, fora do círculo central.
      expect(distanceToCenter(player.position)).toBeGreaterThanOrEqual(FIELD.centerCircleRadius);
    }
  });

  it("faz do primeiro toque um passe, nunca uma condução do próprio cobrador", () => {
    const state = createState();
    const takerId = state.kickoff!.takerId;

    stepUntil(state, (current) => current.kickoff?.ballInPlay === true, 6);

    expect(state.kickoff?.ballInPlay).toBe(true);
    expect(state.ball.lastTouchPlayerId).toBe(takerId);
    // Passe a caminho: a bola saiu do pé para um companheiro, não à frente para ele mesmo.
    expect(state.pendingPass?.passerId).toBe(takerId);
    expect(state.ball.dribbleOwnerId).toBeNull();
  });

  it("impede o cobrador de tocar a bola de novo antes de outro jogador", () => {
    const state = createState();
    const takerId = state.kickoff!.takerId;
    stepUntil(state, (current) => current.kickoff?.ballInPlay === true, 6);

    // Enquanto a restrição vale, a bola nunca volta ao domínio de quem cobrou.
    stepUntil(state, (current) => current.kickoff === null, 8);
    expect(state.kickoff).toBeNull();
    expect(state.ball.lastTouchPlayerId).not.toBe(takerId);
  });
});

describe("regra 7 — dois tempos", () => {
  it("divide a partida em tempos iguais que somam a duração total", () => {
    expect(MATCH_HALVES).toBe(2);
    expect(HALF_DURATION * MATCH_HALVES).toBe(MATCH_DURATION);
  });

  it("recomeça no intervalo com uma nova saída, cobrada pelo outro time", () => {
    const state = createState();
    expect(state.half).toBe(1);

    stepUntil(state, (current) => current.half === 2, MATCH_DURATION);

    expect(state.half).toBe(2);
    expect(state.elapsed).toBeGreaterThanOrEqual(HALF_DURATION);
    // O relógio atravessa o intervalo: não zera, como numa partida de verdade.
    expect(state.elapsed).toBeLessThan(HALF_DURATION + 1);
    expect(state.finished).toBe(false);
    // Regra 8: quem não cobrou a saída do 1º tempo cobra a do 2º.
    expect(state.kickoff).toMatchObject({ team: "coral", ballInPlay: false });
    expect(state.ball.position).toEqual({ x: FIELD.width / 2, y: FIELD.height / 2 });
    expect(state.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["half-ended", "half-started"]),
    );
  }, 120_000);

  it("só encerra a partida depois do último tempo", () => {
    const state = createState();

    stepUntil(state, (current) => current.finished, MATCH_DURATION + 1);

    expect(state.finished).toBe(true);
    expect(state.half).toBe(MATCH_HALVES);
    expect(state.elapsed).toBe(MATCH_DURATION);
  }, 120_000);
});
