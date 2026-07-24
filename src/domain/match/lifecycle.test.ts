import { describe, expect, it } from "vitest";
import { referenceMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { FIELD, FIXED_STEP } from "./config";
import { createMatchState, stepMatch } from "./index";

const createState = () => createMatchState(referenceMatchConfig(2026));

describe("ciclo de vida da partida", () => {
  it("não altera uma partida finalizada", () => {
    const state = createState();
    state.finished = true;
    const before = structuredClone(state);

    stepMatch(state, FIXED_STEP);

    expect(state).toEqual(before);
  });

  it("na bola parada a bola fica presa no ponto e os jogadores caminham (sem teleporte)", () => {
    const state = createState();
    // O estado inicial já é uma saída de bola: bola parada no ponto, ainda a cobrar.
    expect(state.restart).not.toBeNull();
    expect(state.restart?.ballInPlay).toBe(false);
    const spot = { ...state.restart!.spot };

    // Empurra um jogador que não é o cobrador para longe: ele deve CAMINHAR de volta, não saltar.
    const mover = state.players.find(
      (player) => player.team === "blue"
        && player.profile.position !== "goalkeeper"
        && player.profile.id !== state.restart!.takerId,
    )!;
    mover.position = { x: FIELD.width * 0.82, y: FIELD.height * 0.2 };
    let previous = { ...mover.position };
    let maxStep = 0;

    // Meio segundo: ainda antes do preparo mínimo, então a bola segue parada o tempo todo.
    for (let tick = 0; tick < 60; tick += 1) {
      stepMatch(state, FIXED_STEP);
      expect(state.restart?.ballInPlay).toBe(false);
      expect(state.ball.position).toEqual(spot);
      expect(state.ball.velocity).toEqual({ x: 0, y: 0 });
      maxStep = Math.max(maxStep, Math.hypot(mover.position.x - previous.x, mover.position.y - previous.y));
      previous = { ...mover.position };
    }
    // Caminha de verdade, mas o passo por tick é de quem corre — jamais um salto (teleporte).
    expect(maxStep).toBeGreaterThan(0);
    expect(maxStep).toBeLessThan(FIELD.width * 0.02);
  });

  it("expira um passe pendente após quatro segundos", () => {
    const state = createState();
    startOpenPlay(state);
    state.elapsed = 4;
    // Longe de todo mundo: se alguém alcança a bola, o passe se resolve em vez de expirar.
    state.ball.position = { x: FIELD.width / 2, y: 10 };
    const passer = state.players.find((player) => player.profile.id === "nilo-mid")!;
    state.pendingPass = {
      passerId: passer.profile.id,
      receiverId: "nilo-fw",
      team: "blue",
      startedAt: 0,
      trajectory: "ground",
      range: "short",
      targeting: "feet",
      selectionReason: "progressivePass",
      target: { ...state.ball.position },
      landingPoint: { ...state.ball.position },
      expectedArrivalAt: 1,
      receiverEta: 1,
      opponentEta: 2,
    };

    stepMatch(state, FIXED_STEP);

    expect(state.pendingPass).toBeNull();
    expect(passer.memory.stats.failedPasses).toBe(1);
  });
});
