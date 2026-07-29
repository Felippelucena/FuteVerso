import { ANALYTICS_GRID, FIELD, MOMENTUM_WINDOWS } from "../config";
import { clamp } from "../../shared/math";
import type { MatchState } from "../model";
import { attackingProgress } from "../runtime/pitch";

/**
 * Quem estava por cima nesta janela. A definição não inventa fórmula nenhuma: é **onde a bola
 * estava, do lado de quem a tinha** — o mesmo `attackingProgress` que decide entrada no terço
 * final, e a mesma posse confirmada que alimenta o percentual. Bola em disputa entra na conta
 * como zero, que é o que ela é: pressão de ninguém.
 */
const sampleMomentum = (state: MatchState): void => {
  const index = clamp(
    Math.floor(state.elapsed / state.rules.matchDuration * MOMENTUM_WINDOWS),
    0,
    MOMENTUM_WINDOWS - 1,
  );
  const window = state.momentum[index]!;
  window.samples += 1;
  const team = state.possessionTeam;
  if (!team) return;
  const progress = attackingProgress(team, state.ball.position.x);
  window.pressure += team === "blue" ? progress : -progress;
};

export const sampleSpatialAnalytics = (state: MatchState): void => {
  if (state.elapsed + 0.0001 < state.nextAnalyticsSample) return;
  state.nextAnalyticsSample += ANALYTICS_GRID.sampleInterval;
  for (const player of state.players) {
    if (player.profile.position === "goalkeeper") continue;
    const column = clamp(Math.floor(player.position.x / FIELD.width * ANALYTICS_GRID.columns), 0, ANALYTICS_GRID.columns - 1);
    const row = clamp(Math.floor(player.position.y / FIELD.height * ANALYTICS_GRID.rows), 0, ANALYTICS_GRID.rows - 1);
    state.heatmaps[player.team][row * ANALYTICS_GRID.columns + column] += 1;
  }
  sampleMomentum(state);
};
