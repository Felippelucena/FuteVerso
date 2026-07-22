import { ANALYTICS_GRID, FIELD } from "../config";
import { clamp } from "../../shared/math";
import type { MatchState } from "../model";

export const sampleSpatialAnalytics = (state: MatchState): void => {
  if (state.elapsed + 0.0001 < state.nextAnalyticsSample) return;
  state.nextAnalyticsSample += ANALYTICS_GRID.sampleInterval;
  for (const player of state.players) {
    if (player.profile.position === "goalkeeper") continue;
    const column = clamp(Math.floor(player.position.x / FIELD.width * ANALYTICS_GRID.columns), 0, ANALYTICS_GRID.columns - 1);
    const row = clamp(Math.floor(player.position.y / FIELD.height * ANALYTICS_GRID.rows), 0, ANALYTICS_GRID.rows - 1);
    state.heatmaps[player.team][row * ANALYTICS_GRID.columns + column] += 1;
  }
};
