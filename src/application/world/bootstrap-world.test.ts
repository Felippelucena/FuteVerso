import { describe, expect, it, vi } from "vitest";
import { inspectWorld } from "../../domain/world/rules";
import { MemoryWorldRepository } from "../../infrastructure/persistence/memory-world-repository";
import type { WorldRepository } from "../ports/world-repository";
import { createTestWorld } from "../__fixtures__/test-world";
import { bootstrapWorld } from "./bootstrap-world";

const options = { catalogSeed: 4321, clubCount: 2, currentYear: 2026 };

describe("bootstrapWorld", () => {
  it("gera e grava um catálogo no primeiro boot", async () => {
    const repository = new MemoryWorldRepository();

    const world = await bootstrapWorld(repository, options);

    expect(world.clubs).toHaveLength(2);
    expect(world.settings.catalogSeed).toBe(4321);
    expect(inspectWorld(world)).toEqual([]);
    expect((await repository.load())?.clubs).toHaveLength(2);
  });

  it("reaproveita o mundo salvo em vez de gerar outro", async () => {
    const saved = createTestWorld(3);
    const repository = new MemoryWorldRepository(saved);

    const world = await bootstrapWorld(repository, options);

    expect(world.clubs).toHaveLength(3);
    expect(world.settings.catalogSeed).toBe(saved.settings.catalogSeed);
  });

  it("repara o mundo salvo antes de entregá-lo", async () => {
    const saved = createTestWorld(2);
    const target = saved.players[0].id;
    delete saved.memories[target];
    const repository = new MemoryWorldRepository(saved);

    const world = await bootstrapWorld(repository, options);

    expect(world.memories[target]).toBeDefined();
  });

  it("gera um mundo novo quando a leitura falha", async () => {
    const repository: WorldRepository = {
      load: vi.fn().mockRejectedValue(new Error("banco indisponível")),
      save: vi.fn().mockResolvedValue(undefined),
      saveProgress: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };

    const world = await bootstrapWorld(repository, options);

    expect(world.clubs).toHaveLength(2);
  });

  it("entrega o mundo mesmo se a gravação inicial falhar", async () => {
    const repository: WorldRepository = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockRejectedValue(new Error("sem espaço")),
      saveProgress: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };

    await expect(bootstrapWorld(repository, options)).resolves.toMatchObject({ clubs: expect.any(Array) });
  });
});
