import type { ReadonlyCatalog } from "../../application/ports/catalog";
import { activeContractOf } from "../../domain/contract/queries";
import type { PlayerProfile } from "../../domain/roster/model";
import { playerOverall } from "../../domain/roster/rating";
import { playerAge } from "../../domain/roster/rules";

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

export const FREE_AGENT_LABEL = "Sem clube";

/**
 * Resolve uma página de jogadores nas linhas da tabela. O clube vem do contrato, e o banco não
 * cruza índices: a junção acontece aqui, sobre a página — dezenas de registros, nunca o
 * catálogo inteiro.
 */
export const createPlayerRows = async (
  queries: ReadonlyCatalog,
  players: readonly PlayerProfile[],
  currentYear: number,
): Promise<PlayerRowViewModel[]> => {
  const contracts = await Promise.all(players.map(async (player) => {
    const { rows } = await queries.contracts.page({ filter: { field: "playerId", value: player.id } });
    return activeContractOf([...rows], player.id);
  }));
  const clubIds = [...new Set(contracts.flatMap((contract) => contract ? [contract.clubId] : []))];
  const clubsById = new Map((await queries.clubs.getMany(clubIds)).map((club) => [club.id, club]));

  return players.map((player, index) => {
    const contract = contracts[index];
    const club = contract ? clubsById.get(contract.clubId) : null;
    return {
      id: player.id,
      name: player.name,
      shirtNumber: contract?.shirtNumber ?? null,
      clubName: club?.name ?? FREE_AGENT_LABEL,
      clubShortName: club?.shortName ?? "—",
      nationality: player.nationality,
      age: playerAge(player, currentYear),
      overall: playerOverall(player),
      position: player.position,
      secondaryPositions: player.secondaryPositions,
      role: player.role,
    };
  });
};
