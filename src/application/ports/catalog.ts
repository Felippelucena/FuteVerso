import type { Club } from "../../domain/club/model";
import type { Contract } from "../../domain/contract/model";
import type { PlayerMemory, PlayerProfile } from "../../domain/roster/model";
import type { World, WorldSettings } from "../../domain/world/model";

export type SortDirection = "asc" | "desc";

/**
 * Recorte por um campo indexado. Um só, e não uma lista: o IndexedDB não cruza índices, e
 * fingir que cruza produziria paginação com total errado.
 */
export interface PageFilter {
  readonly field: string;
  readonly value: string | number;
  /** `prefix` vale só para texto — é o que sustenta a busca por nome sem varrer a store. */
  readonly match?: "exact" | "prefix";
}

export interface PageQuery {
  /** Campo indexado pelo qual ordenar. Ausente: a ordem da chave primária. */
  readonly sort?: string;
  readonly direction?: SortDirection;
  readonly offset?: number;
  readonly limit?: number;
  readonly filter?: PageFilter;
}

export interface Page<T> {
  readonly rows: readonly T[];
  /** Quantos satisfazem o filtro, não quantos vieram. É o número que a paginação exibe. */
  readonly total: number;
}

/**
 * Coleção consultável. A mesma interface serve às quatro entidades e é a fonte que a tabela do
 * editor consome, então acrescentar Estádio é acrescentar um store — não um caminho novo.
 *
 * Escrita e remoção são em lote porque toda edição real mexe em mais de um registro (excluir um
 * jogador mata os contratos dele) e o adapter precisa fazer isso numa transação só.
 */
export interface Store<T> {
  page(query?: PageQuery): Promise<Page<T>>;
  get(id: string): Promise<T | null>;
  getMany(ids: readonly string[]): Promise<T[]>;
  put(entities: readonly T[]): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
}

/**
 * Porta de persistência do catálogo. Substitui o antigo `WorldRepository`, que carregava e
 * regravava o mundo inteiro a cada edição: com um catálogo construído pelo usuário isso é
 * inviável. Aqui só entra e sai o que a operação toca.
 *
 * `World` continua existindo como a forma serializada inteira — geração, import/export e
 * testes — mas nunca no caminho de edição.
 */
/**
 * Coleção sem escrita. É o que a apresentação recebe: telas leem à vontade, mas gravar só pelos
 * comandos da aplicação, que são quem mantém a integridade do que a edição toca.
 */
export type ReadonlyStore<T> = Pick<Store<T>, "page" | "get" | "getMany">;

export interface ReadonlyCatalog {
  readonly players: ReadonlyStore<PlayerProfile>;
  readonly clubs: ReadonlyStore<Club>;
  readonly contracts: ReadonlyStore<Contract>;
}

export interface Catalog {
  readonly players: Store<PlayerProfile>;
  readonly clubs: Store<Club>;
  readonly contracts: Store<Contract>;
  readonly memories: Store<PlayerMemory>;

  loadSettings(): Promise<WorldSettings | null>;
  saveSettings(settings: WorldSettings): Promise<void>;

  /** Mundo inteiro, para o boot de um catálogo novo, import/export e testes. */
  exportWorld(): Promise<World>;
  importWorld(world: World): Promise<void>;
  clear(): Promise<void>;
}

/** Índices que os adapters mantêm. Nomeados aqui porque a aplicação consulta por estes campos. */
export const PLAYER_INDEXES = ["name", "overall", "position", "nationality", "birthYear"] as const;
export const CLUB_INDEXES = ["name", "reputation", "nationality"] as const;
export const CONTRACT_INDEXES = ["clubId", "playerId"] as const;
