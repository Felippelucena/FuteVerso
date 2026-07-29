import type { PlayerMatchStats, PlayerRuntime } from "../model";
import type { PlayerCareerStats } from "../../roster/model";

export const createPlayerMatchStats = (): PlayerMatchStats => ({
  goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, expectedGoals: 0,
  passes: 0, completedPasses: 0, failedPasses: 0,
  interceptions: 0, tacklesWon: 0, dribbles: 0, saves: 0, distanceCovered: 0,
});

/**
 * Quais feitos da partida também são da carreira. O que não está aqui é medida só desta partida —
 * xG, desarmes, defesas e distância não existem em `PlayerCareerStats`, e inventá-los ali
 * mudaria o formato do save por um número que ninguém pediu para guardar ainda.
 */
const CAREER_MIRROR: Partial<Record<keyof PlayerMatchStats, keyof PlayerCareerStats>> = {
  goals: "goals",
  assists: "assists",
  shots: "shots",
  completedPasses: "completedPasses",
  failedPasses: "failedPasses",
  interceptions: "interceptions",
  dribbles: "dribbles",
};

/**
 * Registra um feito do jogador nos dois livros de uma vez.
 *
 * Uma linha aqui substitui uma linha em cada sistema — a regra de "isto conta para a partida e
 * também para a carreira" mora num lugar só, em vez de virar dois incrementos lado a lado que
 * alguém esquece de manter em par.
 */
export const recordDeed = (player: PlayerRuntime, key: keyof PlayerMatchStats, amount = 1): void => {
  player.match[key] += amount;
  const careerKey = CAREER_MIRROR[key];
  if (careerKey) player.memory.stats[careerKey] += amount;
};
