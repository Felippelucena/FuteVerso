import {
  CLUB_INDEXES,
  CONTRACT_INDEXES,
  PLAYER_INDEXES,
  type Catalog,
  type Page,
  type PageQuery,
  type Store,
} from "../../application/ports/catalog";
import { isValidClub } from "../../domain/club/rules";
import type { Club } from "../../domain/club/model";
import type { Contract } from "../../domain/contract/model";
import { isValidContract } from "../../domain/contract/rules";
import type { PlayerMemory, PlayerProfile } from "../../domain/roster/model";
import { playerOverall } from "../../domain/roster/rating";
import { isValidProfile } from "../../domain/roster/rules";
import { sortKey } from "../../domain/shared/text";
import type { World, WorldSettings } from "../../domain/world/model";
import { emptyWorld } from "../../domain/world/rules";
import { filterValue, pageFromArray, readField, type FieldReader } from "./paging";

export const DATABASE_NAME = "futeverso";
/**
 * v2 acrescenta os índices que sustentam listas paginadas e a busca por prefixo, e passa a
 * gravar `overall` no registro do jogador. Subir o número dispara `onupgradeneeded`, onde a
 * store de jogadores é reescrita uma vez para ganhar o campo derivado.
 */
export const DATABASE_VERSION = 2;

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

/**
 * Campos derivados que só existem para o índice: o IndexedDB só ordena por campo gravado, e
 * `overall` é calculado enquanto `name` precisa de uma chave sem acento para ordenar direito.
 * O domínio segue dono das duas fórmulas e o adapter é o único escritor, então não divergem.
 */
type Derived = { overall: number; sortName: string };
type PlayerRecord = PlayerProfile & Derived;
type ClubRecord = Club & Pick<Derived, "sortName">;

const toPlayerRecord = (player: PlayerProfile): PlayerRecord => ({
  ...player,
  overall: playerOverall(player),
  sortName: sortKey(player.name),
});

const fromPlayerRecord = ({ overall: _overall, sortName: _sortName, ...player }: PlayerRecord): PlayerProfile => player;

const toClubRecord = (club: Club): ClubRecord => ({ ...club, sortName: sortKey(club.name) });

const fromClubRecord = ({ sortName: _sortName, ...club }: ClubRecord): Club => club;

/**
 * Ordenação lógica pedida pela porta → índice físico. Só `name` traduz, porque quem ordena de
 * fato é a chave normalizada; o resto do catálogo indexa pelo próprio nome do campo.
 */
const physicalIndex = (field: string): string => (field === "name" ? "sortName" : field);

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

const rangeOf = (filter: NonNullable<PageQuery["filter"]>): IDBKeyRange => {
  const value = filterValue(filter);
  // Prefixo puro de índice: tudo entre "sil" e "sil￿" começa com "sil". É o que evita varrer
  // a store inteira para responder à busca por nome.
  return filter.match === "prefix" ? IDBKeyRange.bound(value, `${value}￿`) : IDBKeyRange.only(value);
};

interface StoreShape<T, R> {
  readonly name: string;
  readonly keyOf: (entity: T) => string;
  readonly fieldOf: FieldReader<R>;
  readonly toRecord: (entity: T) => R;
  readonly fromRecord: (record: R) => T;
  readonly isValid: (value: unknown) => boolean;
}

class IndexedDbStore<T, R> implements Store<T> {
  constructor(
    private readonly open: () => Promise<IDBDatabase>,
    private readonly shape: StoreShape<T, R>,
  ) {}

  async page(query: PageQuery = {}): Promise<Page<T>> {
    const database = await this.open();
    const objectStore = database.transaction(this.shape.name, "readonly").objectStore(this.shape.name);

    // Filtrado: o índice do filtro estreita, e a ordenação acontece sobre o resultado. Filtrar
    // e ordenar por campos diferentes é impossível num índice só, e o conjunto filtrado é
    // pequeno por natureza — o elenco de um clube, um prefixo digitado.
    if (query.filter) {
      const records = await promisify<R[]>(
        objectStore.index(physicalIndex(query.filter.field)).getAll(rangeOf(query.filter)) as IDBRequest<R[]>,
      );
      const page = pageFromArray(records, { ...query, filter: undefined }, (record) =>
        this.shape.keyOf(this.shape.fromRecord(record)), this.shape.fieldOf);
      return { rows: page.rows.map(this.shape.fromRecord), total: page.total };
    }

    const source = query.sort ? objectStore.index(physicalIndex(query.sort)) : objectStore;
    // Contagem e cursor são emitidos no mesmo tique, antes de qualquer await: uma transação de
    // IndexedDB se encerra sozinha quando fica sem pedido pendente, e esperar a contagem antes
    // de abrir o cursor a fecharia no meio.
    const counting = promisify(source.count());
    const walking = this.walk(source, query.direction === "desc" ? "prev" : "next", query.offset ?? 0, query.limit);
    const [total, rows] = await Promise.all([counting, walking]);
    return { rows, total };
  }

  /** Percorre o cursor pulando `offset` e coletando `limit`. Só a página sai do banco. */
  private walk(source: IDBObjectStore | IDBIndex, direction: IDBCursorDirection, offset: number, limit?: number): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (limit !== undefined && limit <= 0) {
        resolve([]);
        return;
      }
      const wanted = limit ?? Number.POSITIVE_INFINITY;
      const rows: T[] = [];
      let skipped = offset <= 0;
      const request = source.openCursor(null, direction);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(rows);
          return;
        }
        if (!skipped) {
          skipped = true;
          cursor.advance(offset);
          return;
        }
        if (this.shape.isValid(cursor.value)) rows.push(this.shape.fromRecord(cursor.value as R));
        if (rows.length >= wanted) {
          resolve(rows);
          return;
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error("Falha ao percorrer o índice."));
    });
  }

  async get(id: string): Promise<T | null> {
    const database = await this.open();
    const record = await promisify<R | undefined>(
      database.transaction(this.shape.name, "readonly").objectStore(this.shape.name).get(id) as IDBRequest<R | undefined>,
    );
    return record && this.shape.isValid(record) ? this.shape.fromRecord(record) : null;
  }

  async getMany(ids: readonly string[]): Promise<T[]> {
    if (ids.length === 0) return [];
    const database = await this.open();
    const objectStore = database.transaction(this.shape.name, "readonly").objectStore(this.shape.name);
    // Pedidos emitidos e envolvidos em promessa no mesmo tique: anexar o handler depois de um
    // await perderia o evento de quem já tivesse respondido.
    const pending = ids.map((id) => promisify(objectStore.get(id) as IDBRequest<R | undefined>));
    const records = (await Promise.all(pending)) as (R | undefined)[];
    return records
      .filter((record): record is R => record !== undefined && this.shape.isValid(record))
      .map(this.shape.fromRecord);
  }

  async put(entities: readonly T[]): Promise<void> {
    if (entities.length === 0) return;
    const database = await this.open();
    const transaction = database.transaction(this.shape.name, "readwrite");
    const objectStore = transaction.objectStore(this.shape.name);
    for (const entity of entities) objectStore.put(this.shape.toRecord(entity));
    await finished(transaction);
  }

  async remove(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const database = await this.open();
    const transaction = database.transaction(this.shape.name, "readwrite");
    const objectStore = transaction.objectStore(this.shape.name);
    for (const id of ids) objectStore.delete(id);
    await finished(transaction);
  }
}

const isMemory = (value: unknown): value is PlayerMemory =>
  !!value && typeof value === "object" && typeof (value as PlayerMemory).playerId === "string";

export class IndexedDbCatalog implements Catalog {
  private connection: Promise<IDBDatabase> | null = null;

  readonly players: Store<PlayerProfile>;
  readonly clubs: Store<Club>;
  readonly contracts: Store<Contract>;
  readonly memories: Store<PlayerMemory>;

  constructor(
    private readonly factory: IDBFactory,
    private readonly legacyStorage: Storage | null = null,
  ) {
    const open = () => this.open();
    this.players = new IndexedDbStore<PlayerProfile, PlayerRecord>(open, {
      name: STORES.players,
      keyOf: (player) => player.id,
      fieldOf: readField,
      toRecord: toPlayerRecord,
      fromRecord: fromPlayerRecord,
      isValid: isValidProfile,
    });
    this.clubs = new IndexedDbStore<Club, ClubRecord>(open, {
      name: STORES.clubs,
      keyOf: (club) => club.id,
      fieldOf: readField,
      toRecord: toClubRecord,
      fromRecord: fromClubRecord,
      isValid: isValidClub,
    });
    this.contracts = new IndexedDbStore<Contract, Contract>(open, {
      name: STORES.contracts,
      keyOf: (contract) => contract.id,
      fieldOf: readField,
      toRecord: (contract) => contract,
      fromRecord: (contract) => contract,
      isValid: isValidContract,
    });
    this.memories = new IndexedDbStore<PlayerMemory, PlayerMemory>(open, {
      name: STORES.memories,
      keyOf: (memory) => memory.playerId,
      fieldOf: readField,
      toRecord: (memory) => memory,
      fromRecord: (memory) => memory,
      isValid: isMemory,
    });
  }

  async loadSettings(): Promise<WorldSettings | null> {
    this.dropLegacySave();
    const database = await this.open();
    const transaction = database.transaction([STORES.settings, STORES.clubs], "readonly");
    const [stored, clubCount] = await Promise.all([
      promisify(transaction.objectStore(STORES.settings).get(SETTINGS_KEY)),
      promisify(transaction.objectStore(STORES.clubs).count()),
    ]);
    // Sem clube nenhum o banco está vazio de verdade: o boot gera o catálogo de exemplo.
    if (!isValidSettings(stored) || clubCount === 0) return null;
    const { id: _key, ...settings } = stored as WorldSettings & { id?: string };
    return settings;
  }

  async saveSettings(settings: WorldSettings): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(STORES.settings, "readwrite");
    transaction.objectStore(STORES.settings).put({ ...settings, id: SETTINGS_KEY });
    await finished(transaction);
  }

  async exportWorld(): Promise<World> {
    const database = await this.open();
    const transaction = database.transaction(Object.values(STORES), "readonly");
    const [players, clubs, contracts, memories, settings] = await Promise.all([
      promisify(transaction.objectStore(STORES.players).getAll()),
      promisify(transaction.objectStore(STORES.clubs).getAll()),
      promisify(transaction.objectStore(STORES.contracts).getAll()),
      promisify(transaction.objectStore(STORES.memories).getAll()),
      promisify(transaction.objectStore(STORES.settings).get(SETTINGS_KEY)),
    ]);
    const { id: _key, ...stored } = (settings ?? {}) as WorldSettings & { id?: string };
    return {
      // Registro inválido é descartado em vez de derrubar a leitura; o mundo é reparado depois.
      players: (players as PlayerRecord[]).filter(isValidProfile).map(fromPlayerRecord),
      clubs: (clubs as ClubRecord[]).filter(isValidClub).map(fromClubRecord),
      contracts: (contracts as unknown[]).filter(isValidContract),
      memories: Object.fromEntries((memories as PlayerMemory[]).filter(isMemory).map((memory) => [memory.playerId, memory])),
      settings: isValidSettings(stored) ? stored : emptyWorld().settings,
    };
  }

  async importWorld(world: World): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(Object.values(STORES), "readwrite");
    for (const [store, records] of [
      [STORES.players, world.players.map(toPlayerRecord)],
      [STORES.clubs, world.clubs.map(toClubRecord)],
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
      request.onupgradeneeded = () => upgrade(request.result, request.transaction!);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o banco."));
      request.onblocked = () => reject(new Error("Banco bloqueado por outra aba aberta."));
    });
    return this.connection;
  }
}

const ensureStore = (database: IDBDatabase, transaction: IDBTransaction, name: string, keyPath: string): IDBObjectStore =>
  database.objectStoreNames.contains(name)
    ? transaction.objectStore(name)
    : database.createObjectStore(name, { keyPath });

/** Criação e consulta passam pelo mesmo mapeamento, então índice e busca nunca se desencontram. */
const ensureIndexes = (objectStore: IDBObjectStore, fields: readonly string[]): void => {
  for (const field of fields) {
    const index = physicalIndex(field);
    if (!objectStore.indexNames.contains(index)) objectStore.createIndex(index, index, { unique: false });
  }
};

/** Reescreve os registros que ainda não têm o campo derivado, sem tocar nos que já têm. */
const backfill = <T>(
  objectStore: IDBObjectStore,
  isStale: (record: unknown) => boolean,
  toRecord: (entity: T) => unknown,
  isValid: (value: unknown) => boolean,
): void => {
  objectStore.openCursor().onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
    if (!cursor) return;
    if (isStale(cursor.value) && isValid(cursor.value)) cursor.update(toRecord(cursor.value as T));
    cursor.continue();
  };
};

const upgrade = (database: IDBDatabase, transaction: IDBTransaction): void => {
  const players = ensureStore(database, transaction, STORES.players, "id");
  ensureIndexes(players, PLAYER_INDEXES);
  // v1 gravava o registro sem os campos derivados; sem eles o registro fica fora do índice e
  // some da lista ordenada. As duas stores são reescritas uma vez, aqui.
  backfill(players, (record) => typeof (record as PlayerRecord).overall !== "number", toPlayerRecord, isValidProfile);

  const clubs = ensureStore(database, transaction, STORES.clubs, "id");
  ensureIndexes(clubs, CLUB_INDEXES);
  backfill(clubs, (record) => typeof (record as ClubRecord).sortName !== "string", toClubRecord, isValidClub);

  const contracts = ensureStore(database, transaction, STORES.contracts, "id");
  ensureIndexes(contracts, CONTRACT_INDEXES);
  // v1 nomeava os índices por relação; agora o nome é o do campo, e o antigo vira ruído.
  for (const legacy of ["by-club", "by-player"]) {
    if (contracts.indexNames.contains(legacy)) contracts.deleteIndex(legacy);
  }

  ensureStore(database, transaction, STORES.memories, "playerId");
  ensureStore(database, transaction, STORES.settings, "id");
};
