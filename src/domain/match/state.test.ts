import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { formationAnchor } from "./ai";
import { FIELD } from "./config";
import { createMatchState } from "./index";
import type { GameProfile } from "../roster/model";
import { validateLineups } from "../roster/rules";

const createTestMatch = (profile: GameProfile = createDefaultProfile(), seed?: number) => createMatchState(buildMatchConfig(profile, seed));

describe("estado inicial e escalações", () => {
  it("usa campo e gol escalados", () => {
    expect(FIELD.width).toBeCloseTo(180, 5);
    expect(FIELD.height).toBeCloseTo(108, 5);
    expect(FIELD.goalBottom - FIELD.goalTop).toBeCloseTo(33.6, 5);
    expect(FIELD.goalDepth).toBe(7);
  });

  it("cria oito titulares com um goleiro por time", () => {
    const save = createDefaultProfile();
    const state = createTestMatch(save);
    expect(validateLineups(save.players, save.lineups)).toBe(true);
    expect(state.players).toHaveLength(8);
    for (const team of ["blue", "coral"] as const) {
      expect(state.players.filter((player) => player.team === team && player.profile.position === "goalkeeper")).toHaveLength(1);
    }
  });

  it("recusa um jogador repetido nas duas equipes", () => {
    const save = createDefaultProfile();
    save.lineups.coral.fieldPlayerIds[0] = save.lineups.blue.fieldPlayerIds[0];
    expect(validateLineups(save.players, save.lineups)).toBe(false);
  });

  it("faz posição e função alterarem a âncora", () => {
    const state = createTestMatch(createDefaultProfile());
    const defender = state.players.find((player) => player.profile.position === "centerBack")!;
    const original = formationAnchor(defender);
    defender.profile.role = "finisher";
    expect(formationAnchor(defender).x).not.toBe(original.x);
  });
});
