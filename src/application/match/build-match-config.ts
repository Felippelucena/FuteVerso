import type { MatchConfig, MatchParticipant } from "../../domain/match/model";
import type { GameProfile } from "../../domain/roster/model";
import { createMemory, validateLineups } from "../../domain/roster/rules";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const buildMatchConfig = (profile: GameProfile, seedOverride?: number): MatchConfig => {
  if (!validateLineups(profile.players, profile.lineups)) throw new Error("Escalações inválidas para a partida.");
  const playersById = new Map(profile.players.map((player) => [player.id, player]));
  const participants: MatchParticipant[] = (["blue", "coral"] as const).flatMap((team) => {
    const lineup = profile.lineups[team];
    return [lineup.goalkeeperId, ...lineup.fieldPlayerIds].map((playerId, lineupIndex) => {
      const player = playersById.get(playerId)!;
      return {
        team,
        lineupIndex,
        profile: clone(player),
        memory: clone(profile.memories[playerId] ?? createMemory(player)),
      };
    });
  });
  return {
    seed: seedOverride ?? profile.settings.randomSeed,
    learningEnabled: profile.settings.learningEnabled,
    participants,
  };
};
