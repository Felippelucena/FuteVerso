import { DEFAULT_LINEUPS, DEFAULT_PLAYERS } from "../../content/builtin/default-roster";
import { DEFAULT_MATCH_SEED } from "../../domain/match/config";
import type { GameProfile } from "../../domain/roster/model";
import { createMemory } from "../../domain/roster/rules";

export const createDefaultProfile = (): GameProfile => ({
  players: DEFAULT_PLAYERS.map((player) => ({ ...player, skills: { ...player.skills }, mental: { ...player.mental } })),
  lineups: {
    blue: { ...DEFAULT_LINEUPS.blue, fieldPlayerIds: [...DEFAULT_LINEUPS.blue.fieldPlayerIds] },
    coral: { ...DEFAULT_LINEUPS.coral, fieldPlayerIds: [...DEFAULT_LINEUPS.coral.fieldPlayerIds] },
  },
  memories: Object.fromEntries(DEFAULT_PLAYERS.map((player) => [player.id, createMemory(player)])),
  settings: { learningEnabled: true, randomSeed: DEFAULT_MATCH_SEED },
});
