import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { FIXED_STEP } from "./config";
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

  it("mantém física e cognição bloqueadas durante o kickoff", () => {
    const state = createState();
    state.kickoffTimer = 0.5;
    state.nextCognitionAt = 0;
    const positions = state.players.map((player) => ({ ...player.position }));
    const ball = structuredClone(state.ball);

    stepMatch(state, FIXED_STEP);

    expect(state.kickoffTimer).toBeCloseTo(0.5 - FIXED_STEP, 10);
    expect(state.contestedSeconds).toBeCloseTo(FIXED_STEP, 10);
    expect(state.players.map((player) => player.position)).toEqual(positions);
    expect(state.players.every((player) => player.plan === null)).toBe(true);
    expect(state.ball).toEqual(ball);
  });

  it("expira um passe pendente após quatro segundos", () => {
    const state = createState();
    state.kickoffTimer = 0;
    state.elapsed = 4;
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
