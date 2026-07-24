import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "../../domain/match/__fixtures__/reference-match";
import { createMatchState } from "../../domain/match";
import type { TeamNames } from "../app/labels";
import { createContestMetric, createMatchHeaderViewModel, createMatchSummary } from "./match-view-model";

const TEAM_NAMES: TeamNames = { blue: "NIL", coral: "MAY" };

const createState = () => createMatchState(referenceMatchConfig(1));

describe("match view model", () => {
  it("representa o placar e a posse inicial", () => {
    expect(createMatchHeaderViewModel(createState(), TEAM_NAMES)).toEqual({
      blueGoals: "0",
      coralGoals: "0",
      status: "EM CURSO",
      possessionLabel: "Bola em disputa",
      bluePossession: 50,
      coralPossession: 50,
    });
  });

  it("nomeia quem está com a bola pelo clube em campo", () => {
    const state = createState();
    state.ballControlTeam = "coral";

    expect(createMatchHeaderViewModel(state, TEAM_NAMES).possessionLabel).toBe("MAY com a bola");
  });

  it("resume uma partida finalizada", () => {
    const state = createState();
    state.finished = true;
    state.stats.blue.goals = 2;
    state.stats.coral.goals = 1;
    state.stats.blue.shots = 4;
    state.stats.coral.shots = 2;

    expect(createMatchSummary(state, TEAM_NAMES)).toBe("NIL venceu por 2 a 1. NIL finalizou mais.");
    expect(createContestMetric(state)).toBe("Disputa 0%");
  });
});
