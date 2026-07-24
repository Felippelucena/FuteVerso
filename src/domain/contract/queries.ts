import type { PlayerProfile } from "../roster/model";
import { PLAYING_STATUSES, type Contract } from "./model";

const isPlaying = (contract: Contract): boolean => PLAYING_STATUSES.includes(contract.status);

/** Contratos que colocam jogadores em campo por este clube. */
export const contractsOfClub = (contracts: Contract[], clubId: string): Contract[] =>
  contracts.filter((contract) => contract.clubId === clubId && isPlaying(contract));

export const activeContractOf = (contracts: Contract[], playerId: string): Contract | null =>
  contracts.find((contract) => contract.playerId === playerId && isPlaying(contract)) ?? null;

export const clubOfPlayer = (contracts: Contract[], playerId: string): string | null =>
  activeContractOf(contracts, playerId)?.clubId ?? null;

export const isFreeAgent = (contracts: Contract[], playerId: string): boolean =>
  activeContractOf(contracts, playerId) === null;

/** Elenco do clube, na ordem em que os jogadores foram registrados. */
export const squadOf = (players: PlayerProfile[], contracts: Contract[], clubId: string): PlayerProfile[] => {
  const squadIds = new Set(contractsOfClub(contracts, clubId).map((contract) => contract.playerId));
  return players.filter((player) => squadIds.has(player.id));
};

export const shirtNumberOf = (contracts: Contract[], playerId: string): number | null =>
  activeContractOf(contracts, playerId)?.shirtNumber ?? null;

export const isShirtNumberTaken = (
  contracts: Contract[],
  clubId: string,
  shirtNumber: number,
  exceptContractId?: string,
): boolean => contractsOfClub(contracts, clubId)
  .some((contract) => contract.shirtNumber === shirtNumber && contract.id !== exceptContractId);

export const nextFreeShirtNumber = (contracts: Contract[], clubId: string): number => {
  const taken = new Set(contractsOfClub(contracts, clubId).map((contract) => contract.shirtNumber));
  for (let number = 1; number <= 99; number += 1) if (!taken.has(number)) return number;
  return 99;
};
