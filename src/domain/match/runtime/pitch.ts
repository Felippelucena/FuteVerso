import { clamp } from "../../shared/math";
import { FIELD } from "../config";
import type { AttackChannel, Team, Vec2 } from "../model";

/**
 * A régua do gramado: as medidas que todo mundo faz sobre o campo, antes de existir formação,
 * incumbência ou regra. Vivem aqui porque eram recalculadas módulo a módulo — o mesmo
 * `attackingProgress` em quatro lugares, o mesmo `channelY` em quatro — e duas cópias da mesma
 * conta são uma mentira esperando a primeira delas mudar.
 *
 * `runtime/formation-geometry` continua com a tradução grade↔gramado, que é outra coisa: aqui
 * está a régua; lá, o desenho do time medido com ela.
 */

/**
 * Percentual de campo → unidades. A régua histórica do motor é um campo de 100×60, e os pesos de
 * decisão foram todos calibrados nela — daí os dois eixos terem denominadores diferentes.
 */
export const fieldX = (percent: number): number => percent * FIELD.width / 100;

export const fieldY = (percent: number): number => percent * FIELD.height / 60;

/** Progresso rumo ao gol atacado: 0 no próprio gol, 1 na linha de fundo adversária. */
export const attackingProgress = (team: Team, x: number): number =>
  team === "blue" ? x / FIELD.width : (FIELD.width - x) / FIELD.width;

/** Volta de progresso para X do gramado — usado para desenhar a linha da bandeira. */
export const progressToX = (team: Team, progress: number): number =>
  team === "blue" ? progress * FIELD.width : FIELD.width - progress * FIELD.width;

/** Eixo do corredor de ataque, em unidades verticais do campo. */
export const channelY = (channel: AttackChannel): number => channel === "left"
  ? FIELD.height * 0.22
  : channel === "right"
    ? FIELD.height * 0.78
    : FIELD.height * 0.5;

/** Quanto um ponto pertence ao corredor: 1 sobre o eixo dele, 0 a meia largura de distância. */
export const channelAffinity = (position: { y: number }, channel: AttackChannel): number =>
  1 - clamp(Math.abs(position.y - channelY(channel)) / (FIELD.height * 0.42), 0, 1);

/** Quanto um ponto está no miolo do campo: 0 na linha lateral, 1 no eixo. */
export const centrality = (position: { y: number }): number =>
  1 - clamp(Math.abs(position.y - FIELD.height / 2) / (FIELD.height / 2), 0, 1);

/** Risco de estar encurralado numa linha: cresce junto da lateral e junto da linha de fundo. */
export const edgeRisk = (position: Vec2): number => {
  const nearestTouchline = Math.min(position.y, FIELD.height - position.y);
  const nearestGoalLine = Math.min(position.x, FIELD.width - position.x);
  return clamp(1 - Math.min(nearestTouchline / fieldY(10), nearestGoalLine / fieldX(7)), 0, 1);
};

export const clampToField = (target: Vec2, margin = 4): Vec2 => ({
  x: clamp(target.x, margin, FIELD.width - margin),
  y: clamp(target.y, margin, FIELD.height - margin),
});
