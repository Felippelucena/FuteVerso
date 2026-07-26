import { ANALYTICS_GRID, FIELD } from "../../domain/match/config";
import type { MatchState } from "../../domain/match";
import type { Team } from "../../domain/shared/model";

const HEAT_COLORS: Record<Team, string> = { blue: "59,130,246", coral: "243,111,86" };
const PLAYER_COLORS: Record<Team, string> = { blue: "#7fb0ff", coral: "#ff9b87" };

export const drawTacticalMap = (canvas: HTMLCanvasElement, state: MatchState, team: Team): void => {
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#1d4f36";
  context.fillRect(0, 0, width, height);

  const cells = state.heatmaps[team];
  const maximum = Math.max(1, ...cells);
  const cellWidth = width / ANALYTICS_GRID.columns;
  const cellHeight = height / ANALYTICS_GRID.rows;
  for (let index = 0; index < cells.length; index += 1) {
    const alpha = cells[index] / maximum * 0.58;
    if (alpha < 0.02) continue;
    context.fillStyle = `rgba(${HEAT_COLORS[team]},${alpha})`;
    context.fillRect(index % ANALYTICS_GRID.columns * cellWidth, Math.floor(index / ANALYTICS_GRID.columns) * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
  }

  context.strokeStyle = "rgba(235,247,238,.42)";
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, width - 1, height - 1);
  context.beginPath();
  context.moveTo(width / 2, 0);
  context.lineTo(width / 2, height);
  context.stroke();

  const players = state.players.filter((player) => player.team === team);
  const byId = new Map(players.map((player) => [player.profile.id, player]));
  const connections = Object.entries(state.passNetwork[team]);
  const strongest = Math.max(1, ...connections.map(([, count]) => count));
  for (const [key, count] of connections) {
    const [fromId, toId] = key.split(">");
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from || !to) continue;
    context.strokeStyle = `rgba(255,255,255,${0.18 + count / strongest * 0.52})`;
    context.lineWidth = 0.7 + count / strongest * 2.1;
    context.beginPath();
    context.moveTo(from.position.x / FIELD.width * width, from.position.y / FIELD.height * height);
    context.lineTo(to.position.x / FIELD.width * width, to.position.y / FIELD.height * height);
    context.stroke();
  }

  for (const player of players) {
    context.fillStyle = PLAYER_COLORS[team];
    context.beginPath();
    context.arc(player.position.x / FIELD.width * width, player.position.y / FIELD.height * height, player.profile.position === "goalkeeper" ? 2.2 : 2.8, 0, Math.PI * 2);
    context.fill();
  }
};
