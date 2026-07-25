import { describe, expect, it } from "vitest";
import { referenceMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { FIELD } from "./config";
import { createMatchState, stepMatch } from "./index";
import type { MatchState } from "./model";

/** Bola livre lançada contra o gol do coral (lado x = FIELD.width), tocada por último pelo blue. */
const aimAtGoal = (seed: number, position: { x: number; y: number }, height: number, speed: number): MatchState => {
  const state = createMatchState(referenceMatchConfig(seed));
  startOpenPlay(state);
  state.ball.controllerId = null;
  state.ball.lastTouch = "blue";
  state.ball.position = { ...position };
  state.ball.height = height;
  state.ball.verticalVelocity = 0;
  state.ball.velocity = { x: speed, y: 0 };
  return state;
};

describe("baliza", () => {
  it("manda para fora a bola que passa por cima do travessao", () => {
    const state = aimAtGoal(11, { x: FIELD.width - 0.2, y: FIELD.height / 2 }, FIELD.goalHeight + 1, 90);

    stepMatch(state, 1 / 120);

    expect(state.stats.blue.goals).toBe(0);
    expect(state.restart).toMatchObject({ kind: "goalKick", team: "coral" });
  });

  it("rebate na trave em vez de contar gol rente a linha do poste", () => {
    // Rente à borda interna do poste: antes das traves isto entrava como gol.
    const state = aimAtGoal(12, { x: FIELD.width - 1, y: FIELD.goalTop + 0.1 }, 0.4, 70);

    stepMatch(state, 1 / 120);

    expect(state.stats.blue.goals).toBe(0);
    expect(state.restart).toBeNull();
    // Voltou para dentro do campo em vez de atravessar a madeira.
    expect(state.ball.velocity.x).toBeLessThan(0);
    expect(state.ball.position.x).toBeLessThan(FIELD.width);
  });

  it("rebate no travessao e derruba a bola de volta ao campo", () => {
    const state = aimAtGoal(13, { x: FIELD.width - 1, y: FIELD.height / 2 }, FIELD.goalHeight - 0.2, 70);

    stepMatch(state, 1 / 120);

    expect(state.stats.blue.goals).toBe(0);
    expect(state.restart).toBeNull();
    expect(state.ball.velocity.x).toBeLessThan(0);
    expect(state.ball.verticalVelocity).toBeLessThan(0);
  });

  it("continua validando o gol pela boca livre entre os postes", () => {
    const state = aimAtGoal(14, { x: FIELD.width - 1, y: FIELD.height / 2 }, 1, 70);

    for (let tick = 0; tick < 5 && state.stats.blue.goals === 0; tick += 1) stepMatch(state, 1 / 120);

    expect(state.stats.blue.goals).toBe(1);
  });
});
