import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "../profile/create-default-profile";
import { buildMatchConfig } from "./build-match-config";

describe("buildMatchConfig", () => {
  it("monta os oito participantes na ordem das escalações", () => {
    const profile = createDefaultProfile();
    const config = buildMatchConfig(profile);

    expect(config.participants.map(({ team, lineupIndex, profile: player }) => [team, lineupIndex, player.id])).toEqual([
      ["blue", 0, "nilo-gk"], ["blue", 1, "nilo-cb"], ["blue", 2, "nilo-mid"], ["blue", 3, "nilo-fw"],
      ["coral", 0, "maya-gk"], ["coral", 1, "maya-cb"], ["coral", 2, "maya-mid"], ["coral", 3, "maya-fw"],
    ]);
    expect(config.seed).toBe(profile.settings.randomSeed);
    expect(config.learningEnabled).toBe(true);
  });

  it("aceita seed sobrescrita e cria memória ausente", () => {
    const profile = createDefaultProfile();
    delete profile.memories["nilo-fw"];

    const config = buildMatchConfig(profile, 42);

    expect(config.seed).toBe(42);
    expect(config.participants.find(({ profile: player }) => player.id === "nilo-fw")?.memory.playerId).toBe("nilo-fw");
  });

  it("produz um snapshot sem referências compartilhadas", () => {
    const profile = createDefaultProfile();
    const config = buildMatchConfig(profile);
    const participant = config.participants[0];

    participant.profile.name = "Alterado";
    participant.memory.stats.goals = 99;

    expect(profile.players[0].name).toBe("Caio");
    expect(profile.memories["nilo-gk"].stats.goals).toBe(0);
  });

  it("rejeita escalações inválidas", () => {
    const profile = createDefaultProfile();
    profile.lineups.coral.fieldPlayerIds[0] = profile.lineups.blue.fieldPlayerIds[0];

    expect(() => buildMatchConfig(profile)).toThrow("Escalações inválidas");
  });
});
