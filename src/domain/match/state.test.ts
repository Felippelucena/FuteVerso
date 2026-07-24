import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { formationAnchor } from "./ai";
import { FIELD } from "./config";
import { createMatchState } from "./index";

const createTestMatch = (seed?: number) => createMatchState(referenceMatchConfig(seed));

describe("estado inicial e escalações", () => {
  it("usa campo e gol escalados", () => {
    expect(FIELD.width).toBeCloseTo(180, 5);
    expect(FIELD.height).toBeCloseTo(108, 5);
    expect(FIELD.goalBottom - FIELD.goalTop).toBeCloseTo(33.6, 5);
    expect(FIELD.goalDepth).toBe(7);
  });

  it("cria dez titulares com um goleiro por time", () => {
    const state = createTestMatch();
    expect(state.players).toHaveLength(10);
    for (const team of ["blue", "coral"] as const) {
      expect(state.players.filter((player) => player.team === team && player.profile.position === "goalkeeper")).toHaveLength(1);
      expect(state.players.filter((player) => player.team === team && player.profile.position !== "goalkeeper")).toHaveLength(4);
    }
  });

  it("veste cada titular com a camisa vinda do participante", () => {
    const config = referenceMatchConfig();
    const state = createMatchState(config);
    for (const participant of config.participants) {
      const runtime = state.players.find((player) => player.profile.id === participant.profile.id)!;
      expect(runtime.shirtNumber).toBe(participant.shirtNumber);
    }
  });

  it("faz posição e função alterarem a âncora", () => {
    const state = createTestMatch();
    const defender = state.players.find((player) => player.profile.position === "centerBack")!;
    const teammates = state.players.filter((player) => player.team === defender.team);
    const original = formationAnchor(defender, teammates);
    defender.profile.role = "finisher";
    expect(formationAnchor(defender, teammates).x).not.toBe(original.x);
  });
});
