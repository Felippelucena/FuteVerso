import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { FIELD, FIXED_STEP } from "./config";
import { createMatchState, stepMatch } from "./index";
import { distance } from "../shared/math";
import { resolveMarking } from "./runtime/marking";
import { updateTacticalContext } from "./systems/tactics-system";
import type { MatchState, PlayerRuntime } from "./model";

const createTestMatch = (seed = 51) => createMatchState(smallSidedMatchConfig(seed));

/**
 * Um ataque do azul pelo meio, com um atacante entre as linhas do coral. Só os nomeados ficam no
 * lance — o resto vai para a faixa de fora, para o cenário medir uma marcação e não uma multidão.
 */
const buildAttack = (state: MatchState): { carrier: PlayerRuntime; runner: PlayerRuntime; defender: PlayerRuntime } => {
  startOpenPlay(state);
  const carrier = state.players.find((p) => p.team === "blue" && p.profile.position === "centerMid")!;
  const runner = state.players.find((p) => p.team === "blue" && p.profile.position === "striker")!;
  const defender = state.players.find((p) => p.team === "coral" && p.profile.position === "centerBack")!;
  // Alguém do coral tem de ir à bola, senão é o zagueiro quem vai — e aí ele não está marcando
  // ninguém, está pressionando, que é outro comportamento.
  const presser = state.players.find((p) => p.team === "coral" && p.profile.position === "centerMid")!;
  state.players.forEach((player, index) => {
    if (player === carrier || player === runner || player === defender || player === presser) return;
    player.position = { x: FIELD.width * 0.06, y: 6 + index * 5 };
  });
  presser.position = { x: FIELD.width * 0.66, y: FIELD.height * 0.48 };
  carrier.position = { x: FIELD.width * 0.62, y: FIELD.height * 0.5 };
  runner.position = { x: FIELD.width * 0.72, y: FIELD.height * 0.58 };
  defender.position = { x: FIELD.width * 0.82, y: FIELD.height * 0.72 };
  state.ball.position = { ...carrier.position };
  state.ball.velocity = { x: 0, y: 0 };
  state.ball.controllerId = carrier.profile.id;
  state.ball.lastTouch = "blue";
  state.ball.lastTouchPlayerId = carrier.profile.id;
  state.ball.controlStartedAt = state.elapsed;
  state.possessionTeam = "blue";
  state.ballControlTeam = "blue";
  state.lastControlledTeam = "blue";
  return { carrier, runner, defender };
};

describe("marcacao — zona com pega firme", () => {
  it("fecha o adversario que entra na faixa, em vez de sustentar a celula", () => {
    const state = createTestMatch();
    const { runner, defender } = buildAttack(state);
    const before = distance(defender.position, runner.position);

    // Quatro segundos, partindo de treze metros e com o marcado em movimento. O que se mede é a
    // tendência — o defensor chega nele —, e não um ponto de chegada cravado, que travaria a
    // próxima calibragem da defesa.
    for (let frame = 0; frame < 480; frame += 1) stepMatch(state, FIXED_STEP);
    const after = distance(defender.position, runner.position);

    expect(defender.intent).toBe("marking");
    expect(after).toBeLessThan(before * 0.4);
  });

  it("aperta a marcacao conforme a bola se aproxima do marcado", () => {
    const state = createTestMatch(52);
    const { carrier, runner, defender } = buildAttack(state);
    updateTacticalContext(state, 0);
    const plan = state.tactics.coral.collectivePlan!;

    const near = resolveMarking(state, "coral", plan).get(defender.profile.id);
    expect(near?.mark.profile.id).toBe(runner.profile.id);

    // A mesma geometria, com a bola do outro lado do campo: a zona volta a mandar.
    carrier.position = { x: FIELD.width * 0.12, y: FIELD.height * 0.2 };
    state.ball.position = { ...carrier.position };
    const far = resolveMarking(state, "coral", plan).get(defender.profile.id);

    expect(far?.mark.profile.id).toBe(runner.profile.id);
    expect(far!.tightness).toBeLessThan(near!.tightness);
  });
});
