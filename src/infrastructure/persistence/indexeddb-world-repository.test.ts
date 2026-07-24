import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestWorld } from "../../application/__fixtures__/test-world";
import type { World } from "../../domain/world/model";
import { IndexedDbWorldRepository } from "./indexeddb-world-repository";

const createRepository = (storage: Storage | null = null) =>
  new IndexedDbWorldRepository(new IDBFactory(), storage);

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

describe("IndexedDbWorldRepository", () => {
  let world: World;

  beforeEach(() => {
    world = createTestWorld(2);
  });

  it("devolve null enquanto o banco está vazio", async () => {
    expect(await createRepository().load()).toBeNull();
  });

  it("grava e relê o mundo inteiro", async () => {
    const repository = createRepository();
    await repository.save(world);

    const loaded = await repository.load();

    expect(loaded).not.toBeNull();
    expect(loaded!.players).toHaveLength(world.players.length);
    expect(loaded!.clubs.map(({ id }) => id).sort()).toEqual(world.clubs.map(({ id }) => id).sort());
    expect(loaded!.contracts).toHaveLength(world.contracts.length);
    expect(loaded!.settings).toEqual(world.settings);
  });

  it("não deixa a chave interna da store vazar para as configurações", async () => {
    const repository = createRepository();
    await repository.save(world);

    const loaded = await repository.load();

    expect(Object.keys(loaded!.settings).sort()).toEqual(["catalogSeed", "currentYear", "learningEnabled", "randomSeed"]);
  });

  it("saveProgress grava memórias e configurações sem tocar no catálogo", async () => {
    const repository = createRepository();
    await repository.save(world);

    const target = world.players[0].id;
    world.memories[target].stats.goals = 5;
    world.settings.learningEnabled = false;
    world.clubs = [];

    await repository.saveProgress(world);
    const loaded = await repository.load();

    expect(loaded!.memories[target].stats.goals).toBe(5);
    expect(loaded!.settings.learningEnabled).toBe(false);
    expect(loaded!.clubs).toHaveLength(2);
  });

  it("substitui o conteúdo anterior em vez de acumular", async () => {
    const repository = createRepository();
    await repository.save(world);
    await repository.save(createTestWorld(3));

    const loaded = await repository.load();

    expect(loaded!.clubs).toHaveLength(3);
  });

  it("descarta registros corrompidos e ainda entrega um mundo coerente", async () => {
    const repository = createRepository();
    world.contracts.push({
      id: "quebrado", playerId: world.players[0].id, clubId: world.clubs[0].id,
      shirtNumber: 0, startYear: 2026, endYear: 2027, wage: 1, status: "active",
    });
    await repository.save(world);

    const loaded = await repository.load();

    expect(loaded!.contracts.some(({ id }) => id === "quebrado")).toBe(false);
  });

  it("apaga tudo em clear", async () => {
    const repository = createRepository();
    await repository.save(world);
    await repository.clear();

    expect(await repository.load()).toBeNull();
  });

  it("remove o save antigo em localStorage no primeiro carregamento", async () => {
    const storage = fakeStorage({ "futeverso.save": "{}", "autoball.save": "{}", outro: "manter" });
    await createRepository(storage).load();

    expect(storage.getItem("futeverso.save")).toBeNull();
    expect(storage.getItem("autoball.save")).toBeNull();
    expect(storage.getItem("outro")).toBe("manter");
  });
});
