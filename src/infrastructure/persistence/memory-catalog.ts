import type { Catalog, Page, PageQuery, Store } from "../../application/ports/catalog";
import type { Club } from "../../domain/club/model";
import type { Contract } from "../../domain/contract/model";
import type { PlayerMemory, PlayerProfile } from "../../domain/roster/model";
import { playerOverall } from "../../domain/roster/rating";
import type { World, WorldSettings } from "../../domain/world/model";
import { emptyWorld } from "../../domain/world/rules";
import { pageFromArray, readField, type FieldReader } from "./paging";

const clone = <T>(value: T): T => structuredClone(value);

class MemoryStore<T> implements Store<T> {
  constructor(
    private readonly read: () => T[],
    private readonly write: (rows: T[]) => void,
    private readonly keyOf: (entity: T) => string,
    private readonly fieldOf: FieldReader<T>,
  ) {}

  async page(query: PageQuery = {}): Promise<Page<T>> {
    const page = pageFromArray(this.read(), query, this.keyOf, this.fieldOf);
    return { rows: clone(page.rows as T[]), total: page.total };
  }

  async get(id: string): Promise<T | null> {
    const found = this.read().find((entity) => this.keyOf(entity) === id);
    return found ? clone(found) : null;
  }

  async getMany(ids: readonly string[]): Promise<T[]> {
    const wanted = new Set(ids);
    return clone(this.read().filter((entity) => wanted.has(this.keyOf(entity))));
  }

  async put(entities: readonly T[]): Promise<void> {
    const byKey = new Map(this.read().map((entity) => [this.keyOf(entity), entity]));
    for (const entity of entities) byKey.set(this.keyOf(entity), clone(entity));
    this.write([...byKey.values()]);
  }

  async remove(ids: readonly string[]): Promise<void> {
    const doomed = new Set(ids);
    this.write(this.read().filter((entity) => !doomed.has(this.keyOf(entity))));
  }
}

/**
 * Catálogo volátil. Entra quando o IndexedDB não está disponível — navegação privada, permissão
 * negada, teste — para que o jogo abra e rode normalmente, apenas sem guardar entre sessões.
 */
export class MemoryCatalog implements Catalog {
  private world: World;

  readonly players: Store<PlayerProfile>;
  readonly clubs: Store<Club>;
  readonly contracts: Store<Contract>;
  readonly memories: Store<PlayerMemory>;

  constructor(initial: World | null = null) {
    this.world = initial ? clone(initial) : emptyWorld();
    this.players = new MemoryStore(
      () => this.world.players,
      (rows) => { this.world.players = rows; },
      (player) => player.id,
      // `overall` é calculado, não guardado — e é exatamente o valor que o adapter de
      // IndexedDB desnormaliza para conseguir ordenar por ele.
      (player, field) => field === "overall" ? playerOverall(player) : readField(player, field),
    );
    this.clubs = new MemoryStore(
      () => this.world.clubs,
      (rows) => { this.world.clubs = rows; },
      (club) => club.id,
      readField,
    );
    this.contracts = new MemoryStore(
      () => this.world.contracts,
      (rows) => { this.world.contracts = rows; },
      (contract) => contract.id,
      readField,
    );
    this.memories = new MemoryStore(
      () => Object.values(this.world.memories),
      (rows) => { this.world.memories = Object.fromEntries(rows.map((memory) => [memory.playerId, memory])); },
      (memory) => memory.playerId,
      readField,
    );
  }

  async loadSettings(): Promise<WorldSettings | null> {
    return this.world.clubs.length === 0 && this.world.players.length === 0 ? null : { ...this.world.settings };
  }

  async saveSettings(settings: WorldSettings): Promise<void> {
    this.world.settings = { ...settings };
  }

  async exportWorld(): Promise<World> {
    return clone(this.world);
  }

  async importWorld(world: World): Promise<void> {
    this.world = clone(world);
  }

  async clear(): Promise<void> {
    this.world = emptyWorld();
  }
}
