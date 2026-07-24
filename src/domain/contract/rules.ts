import type { Contract, ContractStatus } from "./model";

const STATUSES: readonly ContractStatus[] = ["active", "expired", "loan"];

export const isValidContract = (value: unknown): value is Contract => {
  if (!value || typeof value !== "object") return false;
  const contract = value as Contract;
  return typeof contract.id === "string"
    && contract.id.length > 0
    && typeof contract.playerId === "string"
    && contract.playerId.length > 0
    && typeof contract.clubId === "string"
    && contract.clubId.length > 0
    && Number.isInteger(contract.shirtNumber)
    && contract.shirtNumber >= 1
    && contract.shirtNumber <= 99
    && Number.isInteger(contract.startYear)
    && Number.isInteger(contract.endYear)
    && contract.endYear >= contract.startYear
    && Number.isFinite(contract.wage)
    && contract.wage >= 0
    && STATUSES.includes(contract.status)
    && (contract.parentClubId === undefined || typeof contract.parentClubId === "string")
    // Empréstimo sem clube de origem seria indistinguível de um contrato comum.
    && (contract.status !== "loan" || typeof contract.parentClubId === "string");
};
