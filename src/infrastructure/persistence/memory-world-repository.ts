import type { WorldRepository } from "../../application/ports/world-repository";
import type { World } from "../../domain/world/model";

/**
 * Repositório volátil. Entra quando o IndexedDB não está disponível — navegação privada,
 * permissão negada, ambiente de teste — para que o jogo abra e rode normalmente, apenas sem
 * guardar nada entre sessões.
 */
export class MemoryWorldRepository implements WorldRepository {
  private stored: World | null = null;

  constructor(initial: World | null = null) {
    this.stored = initial ? structuredClone(initial) : null;
  }

  async load(): Promise<World | null> {
    return this.stored ? structuredClone(this.stored) : null;
  }

  async save(world: World): Promise<void> {
    this.stored = structuredClone(world);
  }

  async saveProgress(world: World): Promise<void> {
    if (!this.stored) {
      this.stored = structuredClone(world);
      return;
    }
    this.stored.memories = structuredClone(world.memories);
    this.stored.settings = { ...world.settings };
  }

  async clear(): Promise<void> {
    this.stored = null;
  }
}
