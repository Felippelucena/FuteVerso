import type { WorldRepository } from "../../application/ports/world-repository";
import { isValidClub } from "../../domain/club/rules";
import { isValidContract } from "../../domain/contract/rules";
import type { PlayerMemory } from "../../domain/roster/model";
import { isValidProfile } from "../../domain/roster/rules";
import type { World, WorldSettings } from "../../domain/world/model";
import { repairWorld } from "../../domain/world/rules";

export const DATABASE_NAME = "futeverso";
/**
 * Versão do banco. O IndexedDB versiona nativamente: subir este número dispara
 * `onupgradeneeded`, onde as stores novas são criadas e as antigas migradas. Substitui o
 * registro manual de migrações que o save em localStorage precisava manter.
 */
export const DATABASE_VERSION = 1;

export const STORES = {
  players: "players",
  clubs: "clubs",
  contracts: "contracts",
  memories: "memories",
  settings: "settings",
} as const;

const SETTINGS_KEY = "world";

// Chave do save antigo em localStorage. O formato v3 não tem equivalente no mundo novo
// (não havia clubes nem contratos), então ela é apagada em vez de migrada.
const LEGACY_STORAGE_KEYS = ["futeverso.save", "autoball.save"] as const;

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha no IndexedDB."));
  });

const finished = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Transação abortada."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Transação falhou."));
  });

const isValidSettings = (value: unknown): value is WorldSettings => {
  if (!value || typeof value !== "object") return false;
  const settings = value as WorldSettings;
  return typeof settings.learningEnabled === "boolean"
    && Number.isInteger(settings.randomSeed)
    && settings.randomSeed >= 0
    && settings.randomSeed <= 0xffff_ffff
    && Number.isInteger(settings.currentYear)
    && Number.isInteger(settings.catalogSeed);
};

export class IndexedDbWorldRepository implements WorldRepository {
  private connection: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory,
    private readonly legacyStorage: Storage | null = null,
  ) {}

  async load(): Promise<World | null> {
    this.dropLegacySave();
    const database = await this.open();
    const transaction = database.transaction(Object.values(STORES), "readonly");
    const [players, clubs, contracts, memories, settings] = await Promise.all([
      promisify(transaction.objectStore(STORES.players).getAll()),
      promisify(transaction.objectStore(STORES.clubs).getAll()),
      promisify(transaction.objectStore(STORES.contracts).getAll()),
      promisify(transaction.objectStore(STORES.memories).getAll()),
      promisify(transaction.objectStore(STORES.settings).get(SETTINGS_KEY)),
    ]);

    if (!isValidSettings(settings) || players.length === 0 || clubs.length === 0) return null;
    // A store guarda a chave junto com o registro; ela não faz parte do mundo.
    const { id: _key, ...worldSettings } = settings as WorldSettings & { id?: string };
    // Conteúdo inválido é descartado em vez de derrubar o boot: o mundo é reparado depois,
    // e um catálogo novo é gerado se sobrar pouca coisa.
    const world: World = {
      players: (players as unknown[]).filter(isValidProfile),
      clubs: (clubs as unknown[]).filter(isValidClub),
      contracts: (contracts as unknown[]).filter(isValidContract),
      memories: Object.fromEntries((memories as PlayerMemory[])
        .filter((memory) => memory && typeof memory.playerId === "string")
        .map((memory) => [memory.playerId, memory])),
      settings: worldSettings,
    };
    if (world.players.length === 0 || world.clubs.length === 0) return null;
    return repairWorld(world);
  }

  async save(world: World): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(Object.values(STORES), "readwrite");
    for (const [store, records] of [
      [STORES.players, world.players],
      [STORES.clubs, world.clubs],
      [STORES.contracts, world.contracts],
      [STORES.memories, Object.values(world.memories)],
    ] as const) {
      const objectStore = transaction.objectStore(store);
      objectStore.clear();
      for (const record of records) objectStore.put(record);
    }
    transaction.objectStore(STORES.settings).put({ ...world.settings, id: SETTINGS_KEY });
    await finished(transaction);
  }

  async saveProgress(world: World): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction([STORES.memories, STORES.settings], "readwrite");
    const memories = transaction.objectStore(STORES.memories);
    for (const memory of Object.values(world.memories)) memories.put(memory);
    transaction.objectStore(STORES.settings).put({ ...world.settings, id: SETTINGS_KEY });
    await finished(transaction);
  }

  async clear(): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(Object.values(STORES), "readwrite");
    for (const store of Object.values(STORES)) transaction.objectStore(store).clear();
    await finished(transaction);
  }

  private dropLegacySave(): void {
    if (!this.legacyStorage) return;
    for (const key of LEGACY_STORAGE_KEYS) this.legacyStorage.removeItem(key);
  }

  private open(): Promise<IDBDatabase> {
    this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const store of [STORES.players, STORES.clubs] as const) {
          if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(STORES.contracts)) {
          const contracts = database.createObjectStore(STORES.contracts, { keyPath: "id" });
          contracts.createIndex("by-club", "clubId", { unique: false });
          contracts.createIndex("by-player", "playerId", { unique: false });
        }
        if (!database.objectStoreNames.contains(STORES.memories)) {
          database.createObjectStore(STORES.memories, { keyPath: "playerId" });
        }
        if (!database.objectStoreNames.contains(STORES.settings)) {
          database.createObjectStore(STORES.settings, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o banco."));
      request.onblocked = () => reject(new Error("Banco bloqueado por outra aba aberta."));
    });
    return this.connection;
  }
}
