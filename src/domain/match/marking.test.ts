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

    // O cenário é um ataque azul, e vale enquanto durar: quando o coral recupera a bola, este
    // zagueiro passa a apoiar o próprio ataque — corretamente, e aí não há mais marcação a medir.
    // Mede-se a tendência enquanto ele defende (ele vai ao homem, e chega perto), e não um ponto
    // de chegada cravado ao fim de quatro segundos, que amarra o teste à evolução inteira do lance.
    let frames = 0;
    let markingFrames = 0;
    let closest = before;
    while (frames < 480 && defender.posture === "outOfPossession") {
      stepMatch(state, FIXED_STEP);
      if (defender.intent === "marking") markingFrames += 1;
      closest = Math.min(closest, distance(defender.position, runner.position));
      frames += 1;
    }

    // Rede de segurança da própria medida: um lance que morresse em meio segundo não provaria nada.
    expect(frames).toBeGreaterThan(120);
    expect(markingFrames).toBeGreaterThan(frames * 0.5);
    expect(closest).toBeLessThan(before * 0.75);
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
