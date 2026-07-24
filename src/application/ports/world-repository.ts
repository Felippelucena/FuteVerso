import type { World } from "../../domain/world/model";

/**
 * Porta de persistência do catálogo. É assíncrona porque o adapter real é IndexedDB; a
 * aplicação carrega o mundo antes de mostrar qualquer tela, então a espera acontece uma vez
 * só, no boot.
 */
export interface WorldRepository {
  /** Devolve o mundo salvo, ou `null` quando o banco ainda está vazio. */
  load(): Promise<World | null>;
  /** Grava o mundo inteiro. Usado no boot e sempre que o catálogo muda. */
  save(world: World): Promise<void>;
  /**
   * Grava só o que muda durante uma partida — memórias e ajustes de configuração. Evita
   * reescrever clubes, contratos e elencos a cada autosave.
   */
  saveProgress(world: World): Promise<void>;
  /** Apaga tudo. Usado por "recomeçar" e pelos testes. */
  clear(): Promise<void>;
}
