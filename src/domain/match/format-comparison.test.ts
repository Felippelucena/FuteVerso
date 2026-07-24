import { describe, expect, it } from "vitest";
import { referenceMatchConfig, smallSidedMatchConfig } from "./__fixtures__/reference-match";
import { FIELD, FIXED_STEP } from "./config";
import { createMatchState, stepMatch } from "./index";
import type { MatchConfig, MatchState } from "./model";
import type { Team } from "../shared/model";

/**
 * Comparação entre o 5x5 antigo e o 11x11 do jogo, nas mesmas sementes. É o instrumento que
 * justifica (ou desautoriza) cada mudança de campo, gol e calibragem na virada de formato:
 * nenhuma constante se mexe sem um número daqui.
 *
 * Fica `it.skip` porque simula partidas inteiras e leva minutos; roda sob demanda trocando
 * para `it` ou com `vitest -t`.
 */
const SEEDS = [12_345, 98_765, 2026];

interface FormatReport {
  formato: string;
  jogadoresEmCampo: number;
  espacoPorJogador: number;
  segundosDeSimulacaoPorMinutoDeJogo: number;
  gols: number;
  finalizacoes: number;
  precisaoDePasse: number;
  passesPorMinuto: number;
  desarmes: number;
  entradasNoTercoFinal: number;
  quebrasDeLinha: number;
  larguraMedia: number;
  profundidadeMedia: number;
  compactacaoMedia: number;
  distanciaPorJogador: number;
  estaminaLongaFinal: number;
  volatilMinima: number;
  fracaoSemPapelColetivo: number;
}

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const namedRoleIds = (state: MatchState, team: Team): Set<string> => {
  const plan = state.tactics[team].collectivePlan;
  if (!plan) return new Set();
  return new Set([
    plan.primaryRunnerId, plan.secondaryRunnerId, plan.safetyPlayerId,
    plan.presserId, plan.secondPresserId, plan.overlapFullBackId,
  ].filter((id): id is string => id !== null));
};

const simulate = (config: MatchConfig) => {
  const state = createMatchState(config);
  const started = performance.now();
  let roleSamples = 0;
  let idleSamples = 0;
  const lowestVolatile = new Map<string, number>();

  while (!state.finished) {
    stepMatch(state, FIXED_STEP);
    for (const player of state.players) {
      lowestVolatile.set(player.profile.id, Math.min(lowestVolatile.get(player.profile.id) ?? 1, player.sprintEnergy));
    }
    // Amostra a ociosidade a cada segundo simulado, não a cada tick.
    if (Math.abs(state.elapsed % 1) < FIXED_STEP) {
      for (const team of ["blue", "coral"] as const) {
        const named = namedRoleIds(state, team);
        const outfield = state.players.filter((player) => player.team === team && player.profile.position !== "goalkeeper");
        roleSamples += outfield.length;
        idleSamples += outfield.filter((player) => !named.has(player.profile.id)).length;
      }
    }
  }

  const wallSeconds = (performance.now() - started) / 1000;
  const outfield = state.players.filter((player) => player.profile.position !== "goalkeeper");
  const totals = (["blue", "coral"] as const).map((team) => state.stats[team]);
  const sum = (pick: (stats: typeof totals[number]) => number) => totals.reduce((acc, stats) => acc + pick(stats), 0);
  const spatial = sum((stats) => stats.spatialSeconds) / 2;

  return {
    wallSeconds,
    matchMinutes: state.elapsed / 60,
    playersOnPitch: state.players.length,
    goals: sum((stats) => stats.goals),
    shots: sum((stats) => stats.shots),
    passes: sum((stats) => stats.passes),
    completedPasses: sum((stats) => stats.completedPasses),
    tackles: sum((stats) => stats.tacklesWon),
    finalThirdEntries: sum((stats) => stats.finalThirdEntries),
    lineBreaks: sum((stats) => stats.lineBreaks),
    width: spatial > 0 ? sum((stats) => stats.widthIntegral) / 2 / spatial : 0,
    depth: spatial > 0 ? sum((stats) => stats.depthIntegral) / 2 / spatial : 0,
    compactness: spatial > 0 ? sum((stats) => stats.compactnessIntegral) / 2 / spatial : 0,
    distancePerPlayer: sum((stats) => stats.distanceCovered) / state.players.length,
    longStamina: average(outfield.map((player) => player.stamina)),
    volatileMinimum: Math.min(...outfield.map((player) => lowestVolatile.get(player.profile.id) ?? 1)),
    idleShare: roleSamples > 0 ? idleSamples / roleSamples : 0,
  };
};

const report = (formato: string, build: (seed: number) => MatchConfig): FormatReport => {
  const runs = SEEDS.map((seed) => simulate(build(seed)));
  const mean = (pick: (run: typeof runs[number]) => number) => average(runs.map(pick));
  const players = runs[0].playersOnPitch;
  return {
    formato,
    jogadoresEmCampo: players,
    espacoPorJogador: Math.round(FIELD.width * FIELD.height / players),
    segundosDeSimulacaoPorMinutoDeJogo: Number((mean((run) => run.wallSeconds) / mean((run) => run.matchMinutes)).toFixed(2)),
    gols: Number(mean((run) => run.goals).toFixed(1)),
    finalizacoes: Number(mean((run) => run.shots).toFixed(1)),
    precisaoDePasse: Number((mean((run) => run.completedPasses) / Math.max(1, mean((run) => run.passes))).toFixed(3)),
    passesPorMinuto: Number((mean((run) => run.passes) / mean((run) => run.matchMinutes)).toFixed(1)),
    desarmes: Number(mean((run) => run.tackles).toFixed(1)),
    entradasNoTercoFinal: Number(mean((run) => run.finalThirdEntries).toFixed(1)),
    quebrasDeLinha: Number(mean((run) => run.lineBreaks).toFixed(1)),
    larguraMedia: Number(mean((run) => run.width).toFixed(1)),
    profundidadeMedia: Number(mean((run) => run.depth).toFixed(1)),
    compactacaoMedia: Number(mean((run) => run.compactness).toFixed(1)),
    distanciaPorJogador: Number(mean((run) => run.distancePerPlayer).toFixed(0)),
    estaminaLongaFinal: Number(mean((run) => run.longStamina).toFixed(3)),
    volatilMinima: Number(mean((run) => run.volatileMinimum).toFixed(3)),
    fracaoSemPapelColetivo: Number(mean((run) => run.idleShare).toFixed(3)),
  };
};

describe("comparação de formatos", () => {
  it.skip("mede 5x5 contra 11x11 nas mesmas sementes", () => {
    const small = report("5x5", smallSidedMatchConfig);
    const full = report("11x11", referenceMatchConfig);
    // eslint-disable-next-line no-console
    console.info("FORMAT_COMPARISON", JSON.stringify({ small, full }, null, 2));
    expect(full.jogadoresEmCampo).toBe(22);
  }, 900_000);
});
