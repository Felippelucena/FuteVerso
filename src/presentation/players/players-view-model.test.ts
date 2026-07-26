import { describe, expect, it } from "vitest";
import { createTestWorld, TEST_CURRENT_YEAR } from "../../application/__fixtures__/test-world";
import { clubOfPlayer } from "../../domain/contract/queries";
import type { World } from "../../domain/world/model";
import { MemoryCatalog } from "../../infrastructure/persistence/memory-catalog";
import { createPlayerRows, FREE_AGENT_LABEL } from "./players-view-model";

const rowsOf = async (world: World) => {
  const catalog = new MemoryCatalog(world);
  const { rows } = await catalog.players.page({ sort: "name" });
  return createPlayerRows(catalog, rows, TEST_CURRENT_YEAR);
};

describe("linhas da tabela de jogadores", () => {
  it("junta clube, camisa e idade a cada jogador da página", async () => {
    const world = createTestWorld();

    const rows = await rowsOf(world);

    expect(rows).toHaveLength(world.players.length);
    for (const row of rows) {
      const player = world.players.find(({ id }) => id === row.id)!;
      expect(row.clubName).not.toBe(FREE_AGENT_LABEL);
      expect(row.shirtNumber).toBeGreaterThanOrEqual(1);
      expect(row.age).toBe(TEST_CURRENT_YEAR - player.birthYear);
      expect(row.overall).toBeGreaterThan(0);
    }
  });

  it("marca como sem clube quem não tem contrato ativo", async () => {
    const world = createTestWorld();
    const orphan = world.players[0];
    world.contracts = world.contracts.filter(({ playerId }) => playerId !== orphan.id);

    const row = (await rowsOf(world)).find(({ id }) => id === orphan.id)!;

    expect(clubOfPlayer(world.contracts, orphan.id)).toBeNull();
    expect(row.clubName).toBe(FREE_AGENT_LABEL);
    expect(row.shirtNumber).toBeNull();
  });
});
