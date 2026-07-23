import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { createPlayersViewModel } from "./players-view-model";

describe("players view model", () => {
  it("informa a quantidade e os dez atletas escalados", () => {
    const viewModel = createPlayersViewModel(createDefaultProfile());

    expect(viewModel.countLabel).toBe("10 jogadores");
    expect(viewModel.usedPlayerIds).toHaveLength(10);
    expect(new Set(viewModel.usedPlayerIds).size).toBe(10);
  });
});
