import { clamp } from "../shared/math";
import type { PlayerPosition, PlayerProfile } from "../roster/model";
import { lineDistance, POSITION_SIDE, type FieldSide } from "../roster/positions";
import type { TacticalSlot } from "./slots";

/**
 * Qualidade do encaixe entre um jogador e um slot, do melhor ao pior:
 *
 * - `natural`      posição principal e preferencial do slot;
 * - `accomplished` posição principal entre as permitidas, mas não a preferencial;
 * - `secondary`    uma posição secundária do jogador atende ao slot;
 * - `awkward`      improviso leve (linha vizinha ou lado trocado);
 * - `makeshift`    improviso pesado;
 * - `blocked`      goleiro fora do gol ou jogador de linha no gol.
 */
export type PositionFitLevel = "natural" | "accomplished" | "secondary" | "awkward" | "makeshift" | "blocked";

export interface PositionFit {
  level: PositionFitLevel;
  /** Multiplicador de desempenho aplicado pelo motor. 1 é pleno; `blocked` devolve 0. */
  rating: number;
}

const FIT_BY_LEVEL: Record<Exclude<PositionFitLevel, "awkward" | "makeshift">, number> = {
  natural: 1,
  accomplished: 0.95,
  secondary: 0.9,
  blocked: 0,
};

// Improviso puro: cada linha de distância custa mais que trocar o lado do campo, e o piso
// garante que nenhum jogador vire um cone — ele joga mal, não deixa de jogar.
const LINE_PENALTY = 0.15;
const SIDE_PENALTY = 0.07;
const IMPROVISED_FLOOR = 0.55;
const IMPROVISED_CEILING = 0.88;
const AWKWARD_THRESHOLD = 0.8;

const sideDistance = (first: FieldSide, second: FieldSide): number => {
  if (first === second) return 0;
  return first === "center" || second === "center" ? 1 : 2;
};

const improvisedRating = (position: PlayerPosition, slot: TacticalSlot): number => {
  const closest = Math.min(...slot.allowedPositions.map((allowed) => lineDistance(position, allowed)));
  const side = sideDistance(POSITION_SIDE[position], slot.side);
  return clamp(1 - closest * LINE_PENALTY - side * SIDE_PENALTY, IMPROVISED_FLOOR, IMPROVISED_CEILING);
};

export const positionFit = (
  player: Pick<PlayerProfile, "position" | "secondaryPositions">,
  slot: TacticalSlot,
): PositionFit => {
  const slotIsGoal = slot.allowedPositions.includes("goalkeeper");
  const playerIsGoalkeeper = player.position === "goalkeeper";
  // Gol é troca bloqueada, não improviso: goleiro na linha e jogador de linha no gol
  // desmontariam a simulação em vez de render um jogo ruim.
  if (slotIsGoal !== playerIsGoalkeeper) return { level: "blocked", rating: FIT_BY_LEVEL.blocked };
  if (slotIsGoal) return { level: "natural", rating: FIT_BY_LEVEL.natural };

  if (player.position === slot.allowedPositions[0]) return { level: "natural", rating: FIT_BY_LEVEL.natural };
  if (slot.allowedPositions.includes(player.position)) return { level: "accomplished", rating: FIT_BY_LEVEL.accomplished };
  if (player.secondaryPositions.some((position) => slot.allowedPositions.includes(position))) {
    return { level: "secondary", rating: FIT_BY_LEVEL.secondary };
  }

  const rating = improvisedRating(player.position, slot);
  return { level: rating >= AWKWARD_THRESHOLD ? "awkward" : "makeshift", rating };
};

export const isPlayableSlot = (
  player: Pick<PlayerProfile, "position" | "secondaryPositions">,
  slot: TacticalSlot,
): boolean => positionFit(player, slot).level !== "blocked";
