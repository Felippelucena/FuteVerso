import type { GameProfile } from "../../domain/roster/model";

export interface PlayersViewModel {
  countLabel: string;
  usedPlayerIds: string[];
}

export const createPlayersViewModel = (profile: GameProfile): PlayersViewModel => ({
  countLabel: `${profile.players.length} jogadores`,
  usedPlayerIds: (["blue", "coral"] as const).flatMap((team) => [
    profile.lineups[team].goalkeeperId,
    ...profile.lineups[team].fieldPlayerIds,
  ]),
});
