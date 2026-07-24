import { describe, expect, it } from "vitest";
import { createTestWorld, TEST_CURRENT_YEAR } from "../../application/__fixtures__/test-world";
import { clubOfPlayer } from "../../domain/contract/queries";
import { createPlayersViewModel, FREE_AGENT_LABEL } from "./players-view-model";

describe("players view model", () => {
  it("lista todo o catálogo com clube, camisa e idade", () => {
    const world = createTestWorld();
    const viewModel = createPlayersViewModel(world);

    expect(viewModel.countLabel).toBe(`${world.players.length} jogadores`);
    expect(viewModel.rows).toHaveLength(world.players.length);
    for (const row of viewModel.rows) {
      const player = world.players.find(({ id }) => id === row.id)!;
      expect(row.clubName).not.toBe(FREE_AGENT_LABEL);
      expect(row.shirtNumber).toBeGreaterThanOrEqual(1);
      expect(row.age).toBe(TEST_CURRENT_YEAR - player.birthYear);
      expect(row.overall).toBeGreaterThan(0);
    }
  });

  it("marca como sem clube quem não tem contrato ativo", () => {
    const world = createTestWorld();
    const orphan = world.players[0];
    world.contracts = world.contracts.filter(({ playerId }) => playerId !== orphan.id);

    const row = createPlayersViewModel(world).rows.find(({ id }) => id === orphan.id)!;

    expect(clubOfPlayer(world.contracts, orphan.id)).toBeNull();
    expect(row.clubName).toBe(FREE_AGENT_LABEL);
    expect(row.shirtNumber).toBeNull();
  });
});
