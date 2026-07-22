import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { createMatchState } from "../../domain/match";
import { createContestMetric, createMatchHeaderViewModel, createMatchSummary } from "./match-view-model";

const createState = () => createMatchState(buildMatchConfig(createDefaultProfile(), 1));

describe("match view model", () => {
  it("representa o placar e a posse inicial", () => {
    expect(createMatchHeaderViewModel(createState())).toEqual({
      blueGoals: "0",
      coralGoals: "0",
      status: "EM CURSO",
      possessionLabel: "Bola em disputa",
      bluePossession: 50,
      coralPossession: 50,
    });
  });

  it("resume uma partida finalizada", () => {
    const state = createState();
    state.finished = true;
    state.stats.blue.goals = 2;
    state.stats.coral.goals = 1;
    state.stats.blue.shots = 4;
    state.stats.coral.shots = 2;

    expect(createMatchSummary(state)).toBe("NILO venceu por 2 a 1. NILO finalizou mais.");
    expect(createContestMetric(state)).toBe("Disputa 0%");
  });
});
