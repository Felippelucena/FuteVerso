import type { Club } from "../../domain/club/model";
import type { Contract } from "../../domain/contract/model";
import type { PlayerProfile } from "../../domain/roster/model";
import { createMemory } from "../../domain/roster/rules";
import type { CountryCode } from "../../domain/shared/model";
import type { World } from "../../domain/world/model";
import { repairWorld } from "../../domain/world/rules";
import { applyDefaultLineup, generateClub } from "./generate-club";
import { generateSquad } from "./generate-squad";
import { createRandom } from "./random";

export interface CatalogOptions {
  seed: number;
  currentYear: number;
  clubCount?: number;
  /** Nacionalidade predominante dos clubes gerados. */
  nationality?: CountryCode;
  /** Semente inicial das partidas do mundo novo. */
  matchSeed?: number;
}

export const DEFAULT_CLUB_COUNT = 8;

// Faixa de reputação do catálogo: do clube modesto ao forte. Espalhar em vez de sortear
// evita um catálogo em que todos os times se parecem.
const REPUTATION_RANGE = { minimum: 52, maximum: 84 } as const;

/**
 * Constrói um mundo completo a partir de uma semente: clubes, elencos, contratos, memórias
 * e planos táticos padrão. A mesma semente sempre produz o mesmo catálogo, então dá para
 * reproduzir um mundo inteiro guardando um número.
 */
export const generateCatalog = (options: CatalogOptions): World => {
  const { seed, currentYear } = options;
  const clubCount = Math.max(2, options.clubCount ?? DEFAULT_CLUB_COUNT);
  const nationality = options.nationality ?? "BR";
  const random = createRandom(seed);

  const clubs: Club[] = [];
  const players: PlayerProfile[] = [];
  const contracts: Contract[] = [];
  const takenNames = new Set<string>();
  const takenShortNames = new Set<string>();
  const usedNames = new Set<string>();

  for (let index = 0; index < clubCount; index += 1) {
    const position = clubCount === 1 ? 0.5 : index / (clubCount - 1);
    const reputation = REPUTATION_RANGE.minimum
      + position * (REPUTATION_RANGE.maximum - REPUTATION_RANGE.minimum)
      + random.gaussian(0, 2.5);

    const club = generateClub(random, { nationality, reputation, takenNames, takenShortNames });
    // Elenco um pouco abaixo da reputação: reputação é o tamanho do clube, não a média do time.
    const squad = generateSquad(random, {
      clubId: club.id,
      quality: club.reputation - 4,
      nationality,
      currentYear,
      usedNames,
    });
    players.push(...squad.players);
    contracts.push(...squad.contracts);
    clubs.push(applyDefaultLineup(random, club, squad.players));
  }

  const world: World = {
    players,
    clubs,
    contracts,
    memories: Object.fromEntries(players.map((player) => [player.id, createMemory(player)])),
    settings: {
      learningEnabled: true,
      randomSeed: options.matchSeed ?? seed,
      currentYear,
      catalogSeed: seed,
    },
  };
  return repairWorld(world);
};
