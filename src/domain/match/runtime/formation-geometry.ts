import { clamp, lerp } from "../../shared/math";
import { findSlot, TACTICAL_GRID } from "../../tactics/slots";
import { FIELD } from "../config";
import type { AssignmentZone, PlayerRuntime, Team, Vec2 } from "../model";

/**
 * Tradução entre a grade tática 7x5 — a mesma em que o treinador escala — e as coordenadas do
 * gramado. Vive fora do `ai.ts` porque tanto a decisão individual quanto o plano coletivo
 * precisam dela: o coletivo distribui células, o individual as transforma em alvo de corrida.
 */
const fieldX = (original: number): number => original * FIELD.width / 100;

export const attackDirection = (team: Team): number => (team === "blue" ? 1 : -1);

const LAST_GRID_ROW = TACTICAL_GRID.rows[TACTICAL_GRID.rows.length - 1];

/** Célula neutra: usada quando o jogador entra sem slot conhecido. */
export const FALLBACK_CELL: AssignmentZone = { column: 6, row: 4 };

/**
 * Profundidade da âncora por coluna do slot, em percentual da largura do campo a partir do
 * próprio gol. A grade vai da coluna 0 (gol) à 11 (centroavante avançado), mas o time inteiro
 * cabe na metade defensiva mais um pedaço: a âncora é a posição-base com a bola no meio, não
 * onde o jogador ataca. Espalhar até o fundo faria o centroavante nascer dentro da área.
 */
const SLOT_COLUMN_DEPTH: Record<number, number> = {
  0: 6,
  2: 22,
  4: 30,
  6: 38,
  8: 44,
  10: 50,
  11: 53,
};

/** Faixa lateral ocupada pela formação: do quarto de cima ao quarto de baixo do campo. */
export const LANE_BAND = { first: 0.25, last: 0.75 } as const;

export const slotDepth = (column: number): number => {
  const known = SLOT_COLUMN_DEPTH[column];
  if (known !== undefined) return known;
  // Coluna nova na grade: interpola entre as vizinhas conhecidas em vez de cair no gol.
  const columns = Object.keys(SLOT_COLUMN_DEPTH).map(Number).sort((first, second) => first - second);
  const next = columns.find((candidate) => candidate > column) ?? columns[columns.length - 1];
  const previous = [...columns].reverse().find((candidate) => candidate < column) ?? columns[0];
  if (next === previous) return SLOT_COLUMN_DEPTH[next];
  return lerp(SLOT_COLUMN_DEPTH[previous], SLOT_COLUMN_DEPTH[next], (column - previous) / (next - previous));
};

/**
 * Grade → gramado. A coluna dá a profundidade a partir do próprio gol, a linha dá a faixa
 * lateral. O time coral joga espelhado.
 */
export const cellAnchor = (zone: AssignmentZone, team: Team): Vec2 => {
  const depth = fieldX(slotDepth(zone.column));
  const lane = LANE_BAND.first + (LANE_BAND.last - LANE_BAND.first) * (zone.row / LAST_GRID_ROW);
  return {
    x: attackDirection(team) > 0 ? depth : FIELD.width - depth,
    y: FIELD.height * lane,
  };
};

/** Centro do gol que o time ataca, ou do que ele defende. */
export const goalCenter = (team: Team, ownGoal: boolean): Vec2 => {
  const attackingX = attackDirection(team) > 0 ? FIELD.width : 0;
  return { x: ownGoal ? FIELD.width - attackingX : attackingX, y: FIELD.height / 2 };
};

/** Gramado → grade: em que célula cai um ponto qualquer (a bola, um adversário). */
export const cellAt = (point: Vec2, team: Team): AssignmentZone => {
  const depth = attackDirection(team) > 0 ? point.x : FIELD.width - point.x;
  const progress = clamp(depth / FIELD.width * 100, 0, 100);
  const column = [...TACTICAL_GRID.columns].sort((first, second) =>
    Math.abs(slotDepth(first) - progress) - Math.abs(slotDepth(second) - progress))[0];
  const lane = clamp((point.y / FIELD.height - LANE_BAND.first) / (LANE_BAND.last - LANE_BAND.first), 0, 1);
  const row = [...TACTICAL_GRID.rows].sort((first, second) =>
    Math.abs(first / LAST_GRID_ROW - lane) - Math.abs(second / LAST_GRID_ROW - lane))[0];
  return { column, row };
};

const stepAlong = (axis: readonly number[], value: number, steps: number): number => {
  let nearest = 0;
  for (let index = 1; index < axis.length; index += 1) {
    if (Math.abs(axis[index] - value) < Math.abs(axis[nearest] - value)) nearest = index;
  }
  return axis[clamp(Math.round(nearest + steps), 0, axis.length - 1)];
};

/**
 * Desloca uma célula em passos da grade, sem sair dela. As coordenadas são esparsas (colunas
 * 0,2,4,6,8,10,11), então andar "uma coluna" é andar um índice, não somar 1.
 */
export const shiftCell = (zone: AssignmentZone, columnSteps: number, rowSteps: number): AssignmentZone => ({
  column: stepAlong(TACTICAL_GRID.columns, zone.column, columnSteps),
  row: stepAlong(TACTICAL_GRID.rows, zone.row, rowSteps),
});

/** Distância entre células em passos da grade — a métrica que resolve disputa de ocupação. */
export const cellDistance = (first: AssignmentZone, second: AssignmentZone): number => {
  const columnIndex = (value: number) => TACTICAL_GRID.columns.findIndex((candidate) => candidate === value);
  const rowIndex = (value: number) => TACTICAL_GRID.rows.findIndex((candidate) => candidate === value);
  return Math.abs(columnIndex(first.column) - columnIndex(second.column))
    + Math.abs(rowIndex(first.row) - rowIndex(second.row));
};

export const cellKey = (zone: AssignmentZone): string => `${zone.column}:${zone.row}`;

/** Célula-base do jogador: a que o treinador escolheu ao escalá-lo. */
export const baseCell = (player: PlayerRuntime): AssignmentZone => findSlot(player.slotId)?.zone ?? FALLBACK_CELL;

/**
 * Âncora de formação: a célula-base traduzida para o gramado. A função do jogador (finalizador,
 * defensor) ainda desloca alguns pontos, porque posição diz onde e função diz como.
 */
export const formationAnchor = (player: PlayerRuntime): Vec2 => {
  const anchor = cellAnchor(baseCell(player), player.team);
  // O goleiro não desloca por função: a linha do gol é a linha do gol.
  const roleAdvance = player.profile.position === "goalkeeper"
    ? 0
    : fieldX(player.profile.role === "finisher" ? 4 : player.profile.role === "defender" ? -3 : 0);
  return { x: anchor.x + attackDirection(player.team) * roleAdvance, y: anchor.y };
};
