import { describe, expect, it } from "vitest";
import type { PlayerProfile } from "../roster/model";
import type { Contract } from "./model";
import {
  activeContractOf,
  clubOfPlayer,
  contractsOfClub,
  isFreeAgent,
  isShirtNumberTaken,
  nextFreeShirtNumber,
  shirtNumberOf,
  squadOf,
} from "./queries";

const player = (id: string): PlayerProfile => ({
  id,
  name: id,
  nationality: "BR",
  birthYear: 2000,
  position: "centerMid",
  secondaryPositions: [],
  role: "playmaker",
  skills: {
    acceleration: 60, sprintSpeed: 60, burst: 60, stamina: 60, control: 60,
    passing: 60, vision: 60, finishing: 60, defending: 60, kickPower: 60, goalkeeping: 20,
  },
  mental: {
    decisionMaking: 60, anticipation: 60, composure: 60, aggression: 60,
    teamwork: 60, creativity: 60, intensity: 60, adaptability: 60,
  },
});

const contract = (overrides: Partial<Contract> & Pick<Contract, "id" | "playerId" | "clubId">): Contract => ({
  shirtNumber: 10,
  startYear: 2026,
  endYear: 2028,
  wage: 1000,
  status: "active",
  ...overrides,
});

const players = [player("a"), player("b"), player("c"), player("d")];
const contracts: Contract[] = [
  contract({ id: "1", playerId: "a", clubId: "casa", shirtNumber: 1 }),
  contract({ id: "2", playerId: "b", clubId: "casa", shirtNumber: 7 }),
  contract({ id: "3", playerId: "c", clubId: "casa", shirtNumber: 9, status: "loan", parentClubId: "fora" }),
  contract({ id: "4", playerId: "d", clubId: "casa", shirtNumber: 4, status: "expired" }),
];

describe("consultas de contrato", () => {
  it("monta o elenco a partir dos vínculos que colocam em campo", () => {
    expect(squadOf(players, contracts, "casa").map(({ id }) => id)).toEqual(["a", "b", "c"]);
  });

  it("conta o emprestado como parte do elenco atual", () => {
    expect(contractsOfClub(contracts, "casa").map(({ id }) => id)).toEqual(["1", "2", "3"]);
    expect(clubOfPlayer(contracts, "c")).toBe("casa");
  });

  it("trata contrato encerrado como agente livre", () => {
    expect(isFreeAgent(contracts, "d")).toBe(true);
    expect(activeContractOf(contracts, "d")).toBeNull();
    expect(shirtNumberOf(contracts, "d")).toBeNull();
  });

  it("devolve a camisa do vínculo ativo", () => {
    expect(shirtNumberOf(contracts, "b")).toBe(7);
  });

  it("detecta camisa ocupada, ignorando o próprio contrato", () => {
    expect(isShirtNumberTaken(contracts, "casa", 7)).toBe(true);
    expect(isShirtNumberTaken(contracts, "casa", 7, "2")).toBe(false);
    // A camisa 4 pertence a um contrato encerrado, logo está livre.
    expect(isShirtNumberTaken(contracts, "casa", 4)).toBe(false);
  });

  it("sugere a primeira camisa livre do clube", () => {
    expect(nextFreeShirtNumber(contracts, "casa")).toBe(2);
    expect(nextFreeShirtNumber(contracts, "vazio")).toBe(1);
  });
});
