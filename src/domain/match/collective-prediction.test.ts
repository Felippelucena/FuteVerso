import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig } from "./__fixtures__/reference-match";
import { FIELD } from "./config";
import { createMatchState } from "./index";
import { predictBallPosition, predictPlayerPosition } from "./runtime/prediction";
import { dutyLeader } from "./systems/assignment-system";
import { updateTacticalContext } from "./systems/tactics-system";

const createTestMatch = (seed = 2026) => createMatchState(smallSidedMatchConfig(seed));

describe("cerebro coletivo e previsao curta", () => {
  it("define papeis coletivos distintos e sustenta o plano entre atualizacoes", () => {
    const state = createTestMatch();
    state.kickoffTimer = 0;
    state.elapsed = 20;
    const controller = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
    state.ball.controllerId = controller.profile.id;
    state.ball.position = { ...controller.position };
    state.possessionTeam = "blue";
    state.ballControlTeam = "blue";

    updateTacticalContext(state, 0);
    state.elapsed += 0.5;
    updateTacticalContext(state, 0);
    const plan = state.tactics.blue.collectivePlan!;
    expect(plan.posture).toBe("inPossession");
    const runner = dutyLeader(plan, "runInBehind");
    expect(runner).not.toBeNull();
    expect(dutyLeader(plan, "restDefense")).not.toBe(runner);
    // Todo jogador de linha tem dever, e dois deveres nunca apontam para a mesma célula.
    const outfield = state.players.filter((player) => player.team === "blue" && player.profile.position !== "goalkeeper");
    expect(outfield.every((player) => plan.assignments[player.profile.id])).toBe(true);

    state.elapsed += 0.5;
    updateTacticalContext(state, 0);
    expect(state.tactics.blue.collectivePlan).toBe(plan);
  });

  it("projeta deslocamentos de jogador e bola sem alterar o estado", () => {
    const state = createTestMatch(903);
    state.kickoffTimer = 0;
    const runner = state.players.find((player) => player.team === "blue" && player.profile.position === "striker")!;
    runner.position = { x: FIELD.width * 0.4, y: FIELD.height / 2 };
    runner.velocity = { x: 12, y: -3 };
    state.ball.controllerId = null;
    state.ball.position = { x: FIELD.width * 0.5, y: FIELD.height * 0.5 };
    state.ball.velocity = { x: 24, y: 4 };
    const originalPlayer = { ...runner.position };
    const originalBall = { ...state.ball.position };

    const predictedPlayer = predictPlayerPosition(runner, 1);
    const predictedBall = predictBallPosition(state, 1);

    expect(predictedPlayer.x).toBeGreaterThan(runner.position.x);
    expect(predictedPlayer.y).toBeLessThan(runner.position.y);
    expect(predictedBall.x).toBeGreaterThan(state.ball.position.x);
    expect(runner.position).toEqual(originalPlayer);
    expect(state.ball.position).toEqual(originalBall);
  });
});
