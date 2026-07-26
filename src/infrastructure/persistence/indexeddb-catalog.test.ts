// Instala IDBFactory/IDBKeyRange como globais: o adapter usa `IDBKeyRange` como a plataforma
// o oferece, e não como dependência injetada.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestWorld } from "../../application/__fixtures__/test-world";
import type { PageQuery } from "../../application/ports/catalog";
import type { World } from "../../domain/world/model";
import { IndexedDbCatalog } from "./indexeddb-catalog";
import { MemoryCatalog } from "./memory-catalog";

const createCatalog = (storage: Storage | null = null) => new IndexedDbCatalog(new IDBFactory(), storage);

const fakeStorage = (initial: Record<string, string> = {}): Storage => {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => data.delete(key),
    setItem: (key: string, value: string) => data.set(key, value),
  } as Storage;
};

describe("IndexedDbCatalog", () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld(2);
  });

  it("devolve null nas configurações enquanto o banco está vazio", async () => {
    expect(await createCatalog().loadSettings()).toBeNull();
  });

  it("importa e exporta o mundo inteiro", async () => {
    const catalog = createCatalog();
    await catalog.importWorld(world);

    const loaded = await catalog.exportWorld();

    expect(loaded.players).toHaveLength(world.players.length);
    expect(loaded.clubs.map(({ id }) => id).sort()).toEqual(world.clubs.map(({ id }) => id).sort());
    expect(loaded.contracts).toHaveLength(world.contracts.length);
    expect(loaded.settings).toEqual(world.settings);
  });

  it("não deixa a chave interna da store vazar para as configurações", async () => {
    const catalog = createCatalog();
    await catalog.importWorld(world);

    expect(Object.keys((await catalog.loadSettings())!).sort())
      .toEqual(["catalogSeed", "currentYear", "learningEnabled", "randomSeed"]);
  });

  it("não devolve o campo derivado overall junto do jogador", async () => {
    const catalog = createCatalog();
    await catalog.importWorld(world);

    const { rows } = await catalog.players.page({ sort: "overall", limit: 1 });

    expect(rows[0]).not.toHaveProperty("overall");
  });

  it("grava só o que a operação toca", async () => {
    const catalog = createCatalog();
    await catalog.importWorld(world);

    const target = { ...world.players[0], name: "Renomeado" };
    await catalog.players.put([target]);

    expect((await catalog.players.get(target.id))!.name).toBe("Renomeado");
    expect((await catalog.clubs.page()).total).toBe(2);
    expect((await catalog.players.page()).total).toBe(world.players.length);
  });

  it("descarta registros corrompidos e ainda entrega um mundo coerente", async () => {
    const catalog = createCatalog();
    world.contracts.push({
      id: "quebrado", playerId: world.players[0].id, clubId: world.clubs[0].id,
      shirtNumber: 0, startYear: 2026, endYear: 2027, wage: 1, status: "active",
    });
    await catalog.importWorld(world);

    expect((await catalog.exportWorld()).contracts.some(({ id }) => id === "quebrado")).toBe(false);
  });

  it("apaga tudo em clear", async () => {
    const catalog = createCatalog();
    await catalog.importWorld(world);
    await catalog.clear();

    expect(await catalog.loadSettings()).toBeNull();
  });

  it("remove o save antigo em localStorage no primeiro carregamento", async () => {
    const storage = fakeStorage({ "futeverso.save": "{}", "autoball.save": "{}", outro: "manter" });
    await createCatalog(storage).loadSettings();

    expect(storage.getItem("futeverso.save")).toBeNull();
    expect(storage.getItem("autoball.save")).toBeNull();
    expect(storage.getItem("outro")).toBe("manter");
  });
});

/**
 * O adapter volátil é a definição da semântica de paginação; o de IndexedDB tem de reproduzi-la
 * apesar de percorrer cursor e índice. Divergência aqui é do tipo que passa despercebida — uma
 * linha que some entre duas páginas — então os dois são comparados diretamente.
 */
describe("paginação: IndexedDB reproduz o adapter volátil", () => {
  const QUERIES: { label: string; query: PageQuery }[] = [
    { label: "por nome, primeira página", query: { sort: "name", limit: 10 } },
    { label: "por nome, com deslocamento", query: { sort: "name", offset: 17, limit: 10 } },
    { label: "por nota, decrescente", query: { sort: "overall", direction: "desc", limit: 12 } },
    { label: "por nota, decrescente com deslocamento", query: { sort: "overall", direction: "desc", offset: 9, limit: 7 } },
    { label: "por ano de nascimento", query: { sort: "birthYear", limit: 8 } },
    { label: "posição exata, ordenada por nota", query: { filter: { field: "position", value: "centerBack" }, sort: "overall", direction: "desc" } },
    { label: "sem ordenação explícita", query: { limit: 5 } },
  ];

  it.each(QUERIES)("$label", async ({ query }) => {
    const world = createTestWorld(3);
    const memory = new MemoryCatalog(world);
    const indexed = createCatalog();
    await indexed.importWorld(world);

    const expected = await memory.players.page(query);
    const actual = await indexed.players.page(query);

    expect(actual.total).toBe(expected.total);
    expect(actual.rows.map(({ id }) => id)).toEqual(expected.rows.map(({ id }) => id));
  });

  it("pagina sem repetir nem perder registro ao varrer tudo", async () => {
    const world = createTestWorld(2);
    const indexed = createCatalog();
    await indexed.importWorld(world);

    const seen: string[] = [];
    for (let offset = 0; offset < world.players.length; offset += 7) {
      const { rows } = await indexed.players.page({ sort: "overall", direction: "desc", offset, limit: 7 });
      seen.push(...rows.map(({ id }) => id));
    }

    expect(seen).toHaveLength(world.players.length);
    expect(new Set(seen).size).toBe(world.players.length);
  });

  it("busca por prefixo de nome nos dois adapters", async () => {
    const world = createTestWorld(2);
    const prefix = world.players[0].name.slice(0, 3);
    const memory = new MemoryCatalog(world);
    const indexed = createCatalog();
    await indexed.importWorld(world);

    const query: PageQuery = { filter: { field: "name", value: prefix, match: "prefix" }, sort: "name" };
    const expected = await memory.players.page(query);
    const actual = await indexed.players.page(query);

    expect(actual.total).toBeGreaterThan(0);
    expect(actual.rows.map(({ id }) => id)).toEqual(expected.rows.map(({ id }) => id));
  });
});
