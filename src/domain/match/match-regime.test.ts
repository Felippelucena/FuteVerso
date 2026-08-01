import { describe, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { REGIME } from "./__fixtures__/calibration";
import { createMatchState, stepMatch } from "./index";
import { FIELD, FIXED_STEP, POSSESSION } from "./config";
import { attackingProgress } from "./runtime/pitch";
import { distance, distanceToSegment } from "../shared/math";
import type { PlayerRuntime } from "./model";

/**
 * **O retrato grosso do jogo**, em duas sementes e ~70 s: onde a bola vive, quanto o portador avança,
 * quantos chutes e gols saem. Não afina nada — não há asserção de faixa aqui de propósito.
 *
 * É o instrumento de **detectar quebra** entre uma fase de reforma e a seguinte, quando afinar número
 * ainda seria trabalho jogado fora porque as fases seguintes vão mexer no comportamento de novo. A
 * calibragem de oito sementes (`pass-calibration`) é a outra metade, e só vale a pena quando a reforma
 * fecha.
 *
 * O que o torna útil é o **controle**: `git stash` das mudanças, rodar, `git stash pop`, rodar de novo.
 * Duas leituras com uma variável de diferença. Foi assim que se descobriu que uma queda de `cleanLanes`
 * pela metade era o goleiro deixando de segurar a bola, e não perda de oferta.
 */
const mean = (values: number[]): number =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

/**
 * Companheiros a distância de passe com o corredor limpo. **Quebrado por papel do portador**: o
 * goleiro tem o time inteiro aberto à frente (4,1 contra 0,3 de um jogador de linha), então bastava
 * ele segurar a bola por 9% das amostras para dobrar a média — e distribuir mais rápido, que é
 * melhorar, derrubava o número. A média única media dwell de goleiro, não triangulação.
 */
const countCleanLanes = (
  controller: PlayerRuntime,
  mates: PlayerRuntime[],
  opponents: PlayerRuntime[],
): number => mates.filter((mate) => {
  if (mate.profile.id === controller.profile.id) return false;
  if (distance(mate.position, controller.position) >= FIELD.width * 0.22) return false;
  return !opponents.some((opponent) =>
    distanceToSegment(opponent.position, controller.position, mate.position) < FIELD.height * 0.06);
}).length;

const SAMPLE_SECONDS = 0.5;
const SEEDS = 2;

describe("regime da partida", () => {
  it.runIf(REGIME)("retrata onde a bola vive e o que o jogo produz", () => {
    const lanes = { goalkeeper: [] as number[], field: [] as number[] };
    const advance: number[] = [];
    const totals = { goals: 0, shots: 0, insideBox: 0, expectedGoals: 0 };
    let finalThirdSamples = 0;
    let controlledSamples = 0;
    let allSamples = 0;

    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const state = createMatchState(referenceMatchConfig(7000 + seed));
      let nextSample = 0;
      while (state.elapsed < state.rules.matchDuration) {
        stepMatch(state, FIXED_STEP);
        if (state.elapsed < nextSample) continue;
        nextSample = state.elapsed + SAMPLE_SECONDS;
        allSamples += 1;
        const controller = state.players.find((player) => player.profile.id === state.ball.controllerId);
        if (!controller) continue;
        controlledSamples += 1;
        const mates = state.players.filter((player) => player.team === controller.team
          && player.profile.position !== "goalkeeper");
        const opponents = state.players.filter((player) => player.team !== controller.team);
        const role = controller.profile.position === "goalkeeper" ? "goalkeeper" : "field";
        lanes[role].push(countCleanLanes(controller, mates, opponents));
        const progress = attackingProgress(controller.team, controller.position.x);
        advance.push(progress);
        if (progress >= POSSESSION.finalThirdEnter) finalThirdSamples += 1;
      }
      for (const team of ["blue", "coral"] as const) {
        totals.goals += state.stats[team].goals;
        totals.shots += state.stats[team].shots;
        totals.insideBox += state.stats[team].shotsInsideBox;
        totals.expectedGoals += state.stats[team].expectedGoals;
      }
    }

    const perMatch = (value: number): number => Number((value / SEEDS).toFixed(2));
    const report = {
      ballAtFeetShare: Number((controlledSamples / Math.max(1, allSamples)).toFixed(3)),
      carrierAdvance: Number(mean(advance).toFixed(3)),
      finalThirdShare: Number((finalThirdSamples / Math.max(1, controlledSamples)).toFixed(3)),
      cleanLanesField: Number(mean(lanes.field).toFixed(2)),
      cleanLanesKeeper: Number(mean(lanes.goalkeeper).toFixed(2)),
      keeperDwellShare: Number((lanes.goalkeeper.length / Math.max(1, controlledSamples)).toFixed(3)),
      goals: perMatch(totals.goals),
      shots: perMatch(totals.shots),
      shotsInsideBox: perMatch(totals.insideBox),
      expectedGoals: perMatch(totals.expectedGoals),
    };
    // eslint-disable-next-line no-console
    console.info("MATCH_REGIME", JSON.stringify(report, null, 1));
  }, 300_000);
});
