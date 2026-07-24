import { clamp } from "../../shared/math";
import { findSlot, TACTICAL_GRID } from "../../tactics/slots";
import { FIELD } from "../config";
import type { AssignmentZone, PlayerRuntime, Team, TeamShapePlacement, Vec2 } from "../model";

/**
 * Tradução entre a grade tática 7x5 — a mesma em que o treinador escala — e as coordenadas do
 * gramado. Vive fora do `ai.ts` porque tanto o plano coletivo quanto a decisão individual
 * precisam dela: o coletivo distribui células, o individual as transforma em alvo de corrida.
 *
 * A tradução separa duas coisas que antes estavam grudadas:
 *
 * - **forma** (`COLUMN_SHAPE`): a distância relativa de cada linha da formação à linha mais
 *   recuada. É o desenho do time, e não muda durante a partida.
 * - **colocação** (`TeamShapePlacement`): onde essa forma está agora — a altura da linha mais
 *   recuada e a largura que o time abre. É o que sobe, desce e comprime.
 *
 * Enquanto as duas estavam na mesma tabela, a forma tinha um teto: o jogador mais avançado
 * nunca passava de 53% do campo, e os dois times viviam cada um na sua metade sem se misturar.
 */
const fieldX = (original: number): number => original * FIELD.width / 100;

export const attackDirection = (team: Team): number => (team === "blue" ? 1 : -1);

const LAST_GRID_ROW = TACTICAL_GRID.rows[TACTICAL_GRID.rows.length - 1];

/**
 * Coluna do goleiro. Nenhum jogador de linha pode acabar aqui: a profundidade desta coluna é a
 * linha do gol e não acompanha o bloco, então um zagueiro empurrado para cá nasceria dentro da
 * própria meta.
 */
export const GOALKEEPER_COLUMN = TACTICAL_GRID.columns[0];

/** Célula neutra: usada quando o jogador entra sem slot conhecido. */
export const FALLBACK_CELL: AssignmentZone = { column: 6, row: 4 };

/** O goleiro não se desloca com o bloco: a linha do gol é a linha do gol. */
const GOALKEEPER_DEPTH = 6;

/**
 * Forma da formação: distância de cada coluna à linha de campo mais recuada, em percentual da
 * largura. A coluna 2 (zagueiros) é a referência zero; da zaga ao centroavante vão 31 pontos,
 * que é a compactação vertical de um time de verdade (~35 m num campo de 105 m).
 */
const COLUMN_SHAPE: Record<number, number> = {
  2: 0,
  4: 8,
  6: 16,
  8: 22,
  10: 28,
  11: 31,
};

/** Altura de linha em que a formação reproduz exatamente as âncoras da escalação. */
export const NEUTRAL_LINE_HEIGHT = 22;

/** A linha mais recuada nunca cola no próprio gol nem invade o campo adversário sozinha. */
export const LINE_HEIGHT_RANGE = { lowest: 4, highest: 58 } as const;

/** Colocação neutra: bloco no meio-campo, largura de meio campo. Equivale à âncora fixa. */
export const NEUTRAL_PLACEMENT: TeamShapePlacement = {
  lineHeight: NEUTRAL_LINE_HEIGHT,
  width: 0.5,
  depth: 1,
  forwardLimit: 94,
};

/** Distância da coluna mais avançada à mais recuada, na forma desenhada pela escalação. */
export const SHAPE_SPAN = 31;

const columnShape = (column: number): number => {
  const known = COLUMN_SHAPE[column];
  if (known !== undefined) return known;
  // Coluna nova na grade: interpola entre as vizinhas conhecidas em vez de cair na zaga.
  const columns = Object.keys(COLUMN_SHAPE).map(Number).sort((first, second) => first - second);
  const next = columns.find((candidate) => candidate > column) ?? columns[columns.length - 1];
  const previous = [...columns].reverse().find((candidate) => candidate < column) ?? columns[0];
  if (next === previous) return COLUMN_SHAPE[next];
  const amount = (column - previous) / (next - previous);
  return COLUMN_SHAPE[previous] + (COLUMN_SHAPE[next] - COLUMN_SHAPE[previous]) * amount;
};

/** Profundidade da célula a partir do próprio gol, em percentual da largura do campo. */
export const cellDepth = (zone: AssignmentZone, placement: TeamShapePlacement = NEUTRAL_PLACEMENT): number =>
  zone.column === GOALKEEPER_COLUMN
    ? GOALKEEPER_DEPTH
    : clamp(
      placement.lineHeight + columnShape(zone.column) * placement.depth,
      GOALKEEPER_DEPTH + 2,
      Math.min(94, placement.forwardLimit),
    );

/** Faixa lateral da célula, de 0 (borda de cima) a 1 (borda de baixo). */
export const cellLane = (zone: AssignmentZone, placement: TeamShapePlacement = NEUTRAL_PLACEMENT): number =>
  clamp(0.5 + (zone.row / LAST_GRID_ROW - 0.5) * placement.width, 0.04, 0.96);

/** Grade → gramado. O time coral joga espelhado no eixo da profundidade. */
export const cellAnchor = (
  zone: AssignmentZone,
  team: Team,
  placement: TeamShapePlacement = NEUTRAL_PLACEMENT,
): Vec2 => {
  const depth = fieldX(cellDepth(zone, placement));
  return {
    x: attackDirection(team) > 0 ? depth : FIELD.width - depth,
    y: FIELD.height * cellLane(zone, placement),
  };
};

/** Gramado → grade: em que célula cai um ponto qualquer (a bola, um adversário). */
export const cellAt = (
  point: Vec2,
  team: Team,
  placement: TeamShapePlacement = NEUTRAL_PLACEMENT,
): AssignmentZone => {
  const column = [...TACTICAL_GRID.columns].sort((first, second) =>
    Math.abs(cellAnchor({ column: first, row: 4 }, team, placement).x - point.x)
    - Math.abs(cellAnchor({ column: second, row: 4 }, team, placement).x - point.x))[0];
  const row = [...TACTICAL_GRID.rows].sort((first, second) =>
    Math.abs(cellLane({ column, row: first }, placement) * FIELD.height - point.y)
    - Math.abs(cellLane({ column, row: second }, placement) * FIELD.height - point.y))[0];
  return { column, row };
};

/** Centro do gol que o time ataca, ou do que ele defende. */
export const goalCenter = (team: Team, ownGoal: boolean): Vec2 => {
  const attackingX = attackDirection(team) > 0 ? FIELD.width : 0;
  return { x: ownGoal ? FIELD.width - attackingX : attackingX, y: FIELD.height / 2 };
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
 * Âncora de formação: a célula-base na colocação neutra. É a posição fixa da escalação, usada
 * como referência de recomposição e como reserva quando ainda não há plano coletivo.
 */
export const formationAnchor = (player: PlayerRuntime): Vec2 => {
  const anchor = cellAnchor(baseCell(player), player.team);
  // O goleiro não desloca por função: a linha do gol é a linha do gol.
  const roleAdvance = fieldX(roleAdvancePercent(player));
  return { x: anchor.x + attackDirection(player.team) * roleAdvance, y: anchor.y };
};

/** Avanço que a função do jogador aplica sobre a célula-base, em percentual da largura. */
const roleAdvancePercent = (player: PlayerRuntime): number =>
  player.profile.position === "goalkeeper"
    ? 0
    : player.profile.role === "finisher" ? 4 : player.profile.role === "defender" ? -3 : 0;

/** Faixa de profundidade que a formação neutra ocupa: da zaga (recuada) ao centroavante. */
const OUTFIELD_BACK_DEPTH = NEUTRAL_LINE_HEIGHT - 3;
const OUTFIELD_FRONT_DEPTH = NEUTRAL_LINE_HEIGHT + SHAPE_SPAN + 4;

/**
 * Colocação de saída de bola. Vale a regra do jogo de verdade: na saída todo mundo está no
 * próprio campo e só quem cobra entra no círculo central — antes os atacantes nasciam a 57% do
 * campo, ou seja, já dentro da metade adversária.
 *
 * A forma do time é preservada: em vez de empilhar os avançados na linha do meio, as linhas
 * são comprimidas em direção ao próprio gol até a mais adiantada caber no limite. A zaga, que
 * já está atrás do limite, não se mexe.
 */
export const kickoffPosition = (player: PlayerRuntime, kickoffTeam: Team): Vec2 => {
  const anchor = formationAnchor(player);
  if (player.profile.position === "goalkeeper") return anchor;
  const direction = attackDirection(player.team);
  const depth = direction > 0 ? anchor.x : FIELD.width - anchor.x;
  // Quem cobra pode encostar na linha do meio; quem espera fica fora do círculo central.
  const limit = FIELD.width / 2 - player.radius
    - (player.team === kickoffTeam ? 0 : FIELD.centerCircleRadius);
  const back = fieldX(OUTFIELD_BACK_DEPTH);
  const front = fieldX(OUTFIELD_FRONT_DEPTH);
  const squeezed = front <= limit || depth <= back
    ? depth
    : back + (depth - back) * (limit - back) / (front - back);
  const finalDepth = clamp(squeezed, player.radius, limit);
  return { x: direction > 0 ? finalDepth : FIELD.width - finalDepth, y: anchor.y };
};

/** A bola da saída descansa um passo dentro do campo de quem cobra. */
export const kickoffBallPosition = (kickoffTeam: Team, lane: number = FIELD.height / 2): Vec2 => ({
  x: FIELD.width / 2 - attackDirection(kickoffTeam) * 1.5,
  y: lane,
});

/** Quem cobra fica atrás da bola, do lado do próprio campo, pronto para o primeiro toque. */
export const kickoffTakerPosition = (taker: PlayerRuntime, ball: Vec2): Vec2 => ({
  x: ball.x - attackDirection(taker.team) * (taker.radius + FIELD.ballRadius + 0.4),
  y: ball.y,
});

/** Quem cobra a saída: o jogador de linha mais avançado da formação, o mais central entre eles. */
export const kickoffTaker = (players: PlayerRuntime[], kickoffTeam: Team): PlayerRuntime | null => {
  const direction = attackDirection(kickoffTeam);
  const depth = (player: PlayerRuntime): number => {
    const anchor = formationAnchor(player);
    return direction > 0 ? anchor.x : FIELD.width - anchor.x;
  };
  const lane = (player: PlayerRuntime): number => Math.abs(formationAnchor(player).y - FIELD.height / 2);
  return players
    .filter((player) => player.team === kickoffTeam && player.profile.position !== "goalkeeper")
    .sort((first, second) =>
      depth(second) - depth(first)
      || lane(first) - lane(second)
      || first.profile.id.localeCompare(second.profile.id))[0] ?? null;
};
