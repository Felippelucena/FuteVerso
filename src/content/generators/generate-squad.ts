import type { Contract } from "../../domain/contract/model";
import type { PlayerPosition, PlayerProfile } from "../../domain/roster/model";
import type { CountryCode } from "../../domain/shared/model";
import { COUNTRIES } from "../countries";
import { generatePlayer } from "./generate-player";
import type { ContentRandom } from "./random";

/**
 * Cobertura mínima de um elenco: quantos jogadores de cada posição o clube precisa ter para
 * escalar qualquer formação do editor sem improvisar. Soma 22.
 */
export const SQUAD_GRID: readonly [PlayerPosition, number][] = [
  ["goalkeeper", 3],
  ["centerBack", 3],
  ["rightBack", 2],
  ["leftBack", 2],
  ["defensiveMid", 2],
  ["centerMid", 3],
  ["rightMid", 1],
  ["leftMid", 1],
  ["attackingMid", 1],
  ["rightWing", 1],
  ["leftWing", 1],
  ["striker", 2],
];

export const SQUAD_SIZE = SQUAD_GRID.reduce((total, [, count]) => total + count, 0);

// Camisas tradicionais por posição. Quem chega depois pega o primeiro número livre.
const PREFERRED_SHIRTS: Record<PlayerPosition, number[]> = {
  goalkeeper: [1, 12, 22],
  rightBack: [2, 13],
  centerBack: [3, 4, 14, 15],
  leftBack: [6, 16],
  defensiveMid: [5, 18],
  centerMid: [8, 17, 20],
  rightMid: [7],
  leftMid: [11],
  attackingMid: [10, 21],
  rightWing: [19, 27],
  leftWing: [23, 28],
  striker: [9, 24],
};

export interface SquadGenerationOptions {
  clubId: string;
  /** Nota média do elenco (1 a 100). Titulares saem acima, reservas abaixo. */
  quality: number;
  nationality: CountryCode;
  currentYear: number;
  /** Probabilidade de cada jogador ser estrangeiro. */
  foreignChance?: number;
  usedNames?: Set<string>;
}

export interface GeneratedSquad {
  players: PlayerProfile[];
  contracts: Contract[];
}

const pickShirt = (random: ContentRandom, position: PlayerPosition, taken: Set<number>): number => {
  for (const shirt of PREFERRED_SHIRTS[position]) {
    if (!taken.has(shirt)) {
      taken.add(shirt);
      return shirt;
    }
  }
  for (let shirt = 2; shirt <= 99; shirt += 1) {
    if (!taken.has(shirt)) {
      taken.add(shirt);
      return shirt;
    }
  }
  return random.int(1, 99);
};

export const generateSquad = (
  random: ContentRandom,
  options: SquadGenerationOptions,
): GeneratedSquad => {
  const { clubId, quality, nationality, currentYear } = options;
  const foreignChance = options.foreignChance ?? 0.18;
  const players: PlayerProfile[] = [];
  const contracts: Contract[] = [];
  const takenShirts = new Set<number>();

  for (const [position, count] of SQUAD_GRID) {
    for (let index = 0; index < count; index += 1) {
      // O primeiro de cada posição é o titular natural; os demais caem de nível. A queda é
      // contida de propósito: reserva muito pior que titular faz a escalação automática
      // preferir improvisar um jogador de outra posição a usar o substituto natural.
      const spread = index === 0 ? random.gaussian(3, 2.5) : random.gaussian(-3 - index * 1.5, 2.5);
      const playerNationality = random.chance(foreignChance) ? random.pick(COUNTRIES).code : nationality;
      const player = generatePlayer(random, {
        currentYear,
        nationality: playerNationality,
        position,
        quality: Math.max(20, Math.min(95, quality + spread)),
        usedNames: options.usedNames,
      });
      players.push(player);

      const startYear = currentYear - random.int(0, 4);
      contracts.push({
        id: `contract-${player.id}`,
        playerId: player.id,
        clubId,
        shirtNumber: pickShirt(random, position, takenShirts),
        startYear,
        endYear: currentYear + random.int(1, 4),
        wage: Math.round(Math.pow(Math.max(1, quality + spread) / 10, 2.4) * 100),
        status: "active",
      });
    }
  }

  return { players, contracts };
};
