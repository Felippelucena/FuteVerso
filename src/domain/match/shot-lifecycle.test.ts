import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { FIELD, FIXED_STEP } from "./config";
import { stepMatch } from "./engine";
import type { MatchState } from "./model";
import { createMatchState } from "./state";
import { executeBallAction } from "./systems/ball-system";

/**
 * A estatística do chute é lançada no DESFECHO. Antes ela saía no instante do chute, de uma
 * previsão da trajetória, e era subtraída depois quando alguém interceptava a bola no caminho —
 * o que dava a um mesmo lance dois lançamentos opostos e um placar que andava para trás.
 */
const createState = (seed = 21): MatchState => {
  const state = createMatchState(smallSidedMatchConfig(seed));
  startOpenPlay(state);
  return state;
};

/**
 * Põe a bola no pé do atacante coral, virado para a meta azul, e manda chutar. Ninguém no caminho
 * além do goleiro: o cenário mede o desfecho do chute, não o zagueiro que o corta antes.
 */
const shootAtBlueGoal = (state: MatchState, fromX: number): void => {
  const striker = state.players.find((player) => player.profile.id === "maya-fw")!;
  for (const player of state.players) {
    if (player === striker || player.profile.position === "goalkeeper") continue;
    player.position = { x: FIELD.width - 6, y: 6 };
    player.velocity = { x: 0, y: 0 };
  }
  striker.position = { x: fromX, y: FIELD.height / 2 };
  striker.velocity = { x: 0, y: 0 };
  striker.facing = { x: -1, y: 0 };
  striker.kickCooldown = 0;
  state.ball.position = { x: fromX - striker.radius - FIELD.ballRadius - 0.15, y: FIELD.height / 2 };
  state.ball.velocity = { x: 0, y: 0 };
  state.ball.height = 0;
  state.ball.controllerId = striker.profile.id;
  state.ball.controlStartedAt = state.elapsed;
  executeBallAction(state, striker, {
    kind: "shot",
    target: { x: 0, y: FIELD.height / 2 },
    targetHeight: 0.4,
    power: 0.9,
    technique: "power",
  });
};

const totals = (state: MatchState) => ({
  shots: state.stats.coral.shots,
  onTarget: state.stats.coral.shotsOnTarget,
});

describe("ciclo de vida do chute", () => {
  it("nao conta chute no alvo no instante do chute — so quando ele termina", () => {
    const state = createState();
    // Longe da meta: no quadro do chute a bola mal saiu do pé, e nada terminou ainda.
    shootAtBlueGoal(state, FIELD.width * 0.4);

    expect(totals(state)).toEqual({ shots: 1, onTarget: 0 });
    expect(state.activeShot).not.toBeNull();
  });

  it("conta quando o goleiro precisa resolver o chute", () => {
    const state = createState();
    shootAtBlueGoal(state, FIELD.width * 0.28);

    for (let tick = 0; tick < 300 && state.activeShot; tick += 1) stepMatch(state, FIXED_STEP);

    // O cenário é este e não outro: o goleiro defende. Sem esta âncora o teste passaria de graça
    // num lance em que a bola saísse pela linha de fundo.
    expect(state.stats.blue.saves).toBe(1);
    expect(totals(state)).toEqual({ shots: 1, onTarget: 1 });
  });

  it("a estatistica nunca anda para tras", () => {
    const state = createState(7);
    shootAtBlueGoal(state, FIELD.width * 0.3);
    let highest = 0;

    for (let tick = 0; tick < 900; tick += 1) {
      stepMatch(state, FIXED_STEP);
      const { onTarget } = totals(state);
      expect(onTarget).toBeGreaterThanOrEqual(highest);
      highest = onTarget;
      expect(onTarget).toBeLessThanOrEqual(state.stats.coral.shots);
    }
  });
});
