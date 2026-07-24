import type { PlayerPosition } from "./model";

// Ordem canônica: do gol ao ataque, e dentro de cada linha do centro para os lados.
// Toda listagem de posição na interface deve seguir esta ordem.
export const PLAYER_POSITIONS: readonly PlayerPosition[] = [
  "goalkeeper",
  "centerBack", "rightBack", "leftBack",
  "defensiveMid", "centerMid", "rightMid", "leftMid", "attackingMid",
  "rightWing", "leftWing", "striker",
];

export type PositionLine = "goalkeeper" | "defense" | "midfield" | "attack";

export const POSITION_LINE: Record<PlayerPosition, PositionLine> = {
  goalkeeper: "goalkeeper",
  centerBack: "defense",
  rightBack: "defense",
  leftBack: "defense",
  defensiveMid: "midfield",
  centerMid: "midfield",
  rightMid: "midfield",
  leftMid: "midfield",
  attackingMid: "midfield",
  rightWing: "attack",
  leftWing: "attack",
  striker: "attack",
};

// Distância entre linhas usada para medir improviso: goleiro é incomparável com o resto
// (ver positionFit, que bloqueia a troca em vez de penalizar).
const LINE_DEPTH: Record<PositionLine, number> = { goalkeeper: 0, defense: 1, midfield: 2, attack: 3 };

export const lineDistance = (first: PlayerPosition, second: PlayerPosition): number =>
  Math.abs(LINE_DEPTH[POSITION_LINE[first]] - LINE_DEPTH[POSITION_LINE[second]]);

export type FieldSide = "left" | "center" | "right";

export const POSITION_SIDE: Record<PlayerPosition, FieldSide> = {
  goalkeeper: "center",
  centerBack: "center",
  rightBack: "right",
  leftBack: "left",
  defensiveMid: "center",
  centerMid: "center",
  rightMid: "right",
  leftMid: "left",
  attackingMid: "center",
  rightWing: "right",
  leftWing: "left",
  striker: "center",
};

export const isGoalkeeper = (position: PlayerPosition): boolean => position === "goalkeeper";
