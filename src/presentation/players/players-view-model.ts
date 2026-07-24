import { clubOfPlayer, shirtNumberOf } from "../../domain/contract/queries";
import type { PlayerProfile } from "../../domain/roster/model";
import { playerOverall } from "../../domain/roster/rating";
import { playerAge } from "../../domain/roster/rules";
import type { World } from "../../domain/world/model";

export interface PlayerRowViewModel {
  id: string;
  name: string;
  shirtNumber: number | null;
  clubName: string;
  clubShortName: string;
  nationality: string;
  age: number;
  overall: number;
  position: PlayerProfile["position"];
  secondaryPositions: PlayerProfile["position"][];
  role: PlayerProfile["role"];
}

export interface PlayersViewModel {
  countLabel: string;
  rows: PlayerRowViewModel[];
}

export const FREE_AGENT_LABEL = "Sem clube";

export const createPlayersViewModel = (world: World): PlayersViewModel => {
  const clubsById = new Map(world.clubs.map((club) => [club.id, club]));
  const rows = world.players.map((player) => {
    const clubId = clubOfPlayer(world.contracts, player.id);
    const club = clubId ? clubsById.get(clubId) : null;
    return {
      id: player.id,
      name: player.name,
      shirtNumber: shirtNumberOf(world.contracts, player.id),
      clubName: club?.name ?? FREE_AGENT_LABEL,
      clubShortName: club?.shortName ?? "—",
      nationality: player.nationality,
      age: playerAge(player, world.settings.currentYear),
      overall: playerOverall(player),
      position: player.position,
      secondaryPositions: player.secondaryPositions,
      role: player.role,
    };
  });
  return {
    countLabel: `${rows.length} jogadores`,
    rows: rows.sort((first, second) => first.clubName.localeCompare(second.clubName)
      || second.overall - first.overall
      || first.name.localeCompare(second.name)),
  };
};
