import { describe, expect, it, vi } from "vitest";
import { inspectWorld } from "../../domain/world/rules";
import { MemoryCatalog } from "../../infrastructure/persistence/memory-catalog";
import type { Catalog } from "../ports/catalog";
import { createTestWorld } from "../__fixtures__/test-world";
import { bootstrapCatalog } from "./bootstrap-catalog";

const options = { catalogSeed: 4321, clubCount: 2, currentYear: 2026 };

/** Catálogo que só responde ao que este teste exercita; o resto explode se for tocado. */
const stubCatalog = (overrides: Partial<Catalog>): Catalog => ({
  loadSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
  exportWorld: vi.fn(),
  importWorld: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  ...overrides,
} as unknown as Catalog);

describe("bootstrapCatalog", () => {
  it("gera e grava um catálogo no primeiro boot", async () => {
    const catalog = new MemoryCatalog();

    const settings = await bootstrapCatalog(catalog, options);

    expect(settings.catalogSeed).toBe(4321);
    expect((await catalog.clubs.page()).total).toBe(2);
    expect(inspectWorld(await catalog.exportWorld())).toEqual([]);
  });

  it("reaproveita o catálogo salvo em vez de gerar outro", async () => {
    const saved = createTestWorld(3);
    const catalog = new MemoryCatalog(saved);

    const settings = await bootstrapCatalog(catalog, options);

    expect((await catalog.clubs.page()).total).toBe(3);
    expect(settings.catalogSeed).toBe(saved.settings.catalogSeed);
  });

  it("repara o mundo gerado antes de gravá-lo", async () => {
    const catalog = new MemoryCatalog();

    await bootstrapCatalog(catalog, options);

    const world = await catalog.exportWorld();
    expect(world.players.every((player) => world.memories[player.id])).toBe(true);
  });

  it("gera um catálogo novo quando a leitura falha", async () => {
    const imported: unknown[] = [];
    const catalog = stubCatalog({
      loadSettings: vi.fn().mockRejectedValue(new Error("banco indisponível")),
      importWorld: vi.fn().mockImplementation(async (world) => { imported.push(world); }),
    });

    const settings = await bootstrapCatalog(catalog, options);

    expect(settings.catalogSeed).toBe(4321);
    expect(imported).toHaveLength(1);
  });

  it("entrega as configurações mesmo se a gravação inicial falhar", async () => {
    const catalog = stubCatalog({ importWorld: vi.fn().mockRejectedValue(new Error("sem espaço")) });

    await expect(bootstrapCatalog(catalog, options)).resolves.toMatchObject({ catalogSeed: 4321 });
  });
});
