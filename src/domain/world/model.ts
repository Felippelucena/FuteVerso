import type { Club } from "../club/model";
import type { Contract } from "../contract/model";
import type { PlayerMemory, PlayerProfile } from "../roster/model";

export interface WorldSettings {
  learningEnabled: boolean;
  /** Semente da próxima partida. */
  randomSeed: number;
  /** Ano corrente do jogo. Define a idade dos jogadores e a validade dos contratos. */
  currentYear: number;
  /** Semente que gerou o catálogo inicial, guardada para reproduzir o mundo. */
  catalogSeed: number;
}

/**
 * Todo o conteúdo editável do jogo. Substitui o antigo GameProfile: elenco não é mais uma
 * escalação fixa de dois times, e sim clubes ligados a jogadores por contratos. Cada modo
 * de jogo monta suas partidas a partir daqui sem alterar o catálogo.
 */
export interface World {
  players: PlayerProfile[];
  clubs: Club[];
  contracts: Contract[];
  memories: Record<string, PlayerMemory>;
  settings: WorldSettings;
}
