import { describe, expect, it } from "vitest";
import { createTestWorld } from "../../application/__fixtures__/test-world";
import { contractsOfClub, squadOf } from "../contract/queries";
import { TEAM_SIZE } from "../tactics/model";
import { inspectPlan } from "../tactics/rules";
import type { World } from "./model";
import { inspectWorld, repairPlan, repairWorld } from "./rules";

const freshWorld = (): World => createTestWorld(2);

describe("repairWorld", () => {
  it("não encontra problema no mundo recém-gerado", () => {
    expect(inspectWorld(freshWorld())).toEqual([]);
  });

  it("descarta contrato que aponta para jogador ou clube inexistente", () => {
    const world = freshWorld();
    world.contracts.push({
      id: "orfao", playerId: "ninguem", clubId: world.clubs[0].id,
      shirtNumber: 77, startYear: 2026, endYear: 2027, wage: 1, status: "active",
    });

    expect(inspectWorld(world).map(({ kind }) => kind)).toContain("orphan-contract");
    expect(repairWorld(world).contracts.some(({ id }) => id === "orfao")).toBe(false);
  });

  it("mantém um único vínculo ativo por jogador", () => {
    const world = freshWorld();
    const target = world.contracts[0];
    world.contracts.push({ ...target, id: `${target.id}-dup`, clubId: world.clubs[1].id, shirtNumber: 44 });

    expect(inspectWorld(world).map(({ kind }) => kind)).toContain("duplicate-contract");

    const repaired = repairWorld(world);
    const active = repaired.contracts.filter((contract) => contract.playerId === target.playerId && contract.status !== "expired");
    expect(active).toHaveLength(1);
  });

  it("resolve camisa repetida dentro do mesmo clube", () => {
    const world = freshWorld();
    const club = world.clubs[0];
    const [first, second] = contractsOfClub(world.contracts, club.id);
    second.shirtNumber = first.shirtNumber;

    expect(inspectWorld(world).map(({ kind }) => kind)).toContain("duplicate-shirt");

    const repaired = repairWorld(world);
    const shirts = contractsOfClub(repaired.contracts, club.id).map(({ shirtNumber }) => shirtNumber);
    expect(new Set(shirts).size).toBe(shirts.length);
  });

  it("recria memória ausente e descarta memória órfã", () => {
    const world = freshWorld();
    const target = world.players[0].id;
    delete world.memories[target];
    world.memories["fantasma"] = { playerId: "fantasma", version: 1, policy: { shoot: 0.5, pass: 0.5, dribble: 0.5, press: 0.5, mark: 0.5, cover: 0.5 }, stats: { matches: 0, goals: 0, assists: 0, completedPasses: 0, failedPasses: 0, interceptions: 0, dribbles: 0, shots: 0 } };

    expect(inspectWorld(world).map(({ kind }) => kind)).toContain("missing-memory");

    const repaired = repairWorld(world);
    expect(repaired.memories[target]).toBeDefined();
    expect(repaired.memories["fantasma"]).toBeUndefined();
  });

  it("recompõe a escalação do clube quando um titular sai do elenco", () => {
    const world = freshWorld();
    const club = world.clubs[0];
    const starter = club.defaultPlan.assignments[5].playerId;
    world.players = world.players.filter(({ id }) => id !== starter);
    world.contracts = world.contracts.filter((contract) => contract.playerId !== starter);

    const repaired = repairWorld(world);
    const repairedClub = repaired.clubs.find(({ id }) => id === club.id)!;
    const squad = squadOf(repaired.players, repaired.contracts, club.id);

    expect(repairedClub.defaultPlan.assignments).toHaveLength(TEAM_SIZE);
    expect(inspectPlan(repairedClub.defaultPlan, squad)).toEqual([]);
  });

  it("não é destrutivo: rodar duas vezes dá o mesmo mundo", () => {
    const world = freshWorld();
    expect(repairWorld(repairWorld(world))).toEqual(repairWorld(world));
  });
});

describe("repairPlan", () => {
  it("preserva os titulares que continuam válidos", () => {
    const world = freshWorld();
    const club = world.clubs[0];
    const squad = squadOf(world.players, world.contracts, club.id);
    const removed = club.defaultPlan.assignments[7].playerId;
    const survivors = squad.filter(({ id }) => id !== removed);

    const repaired = repairPlan(club.defaultPlan, survivors);

    const kept = club.defaultPlan.assignments.filter((assignment) => assignment.playerId !== removed);
    for (const assignment of kept) {
      expect(repaired.assignments).toContainEqual(assignment);
    }
    expect(repaired.assignments).toHaveLength(TEAM_SIZE);
  });

  it("limpa o banco de quem não está mais no elenco", () => {
    const world = freshWorld();
    const club = world.clubs[0];
    const squad = squadOf(world.players, world.contracts, club.id);
    const benched = club.defaultPlan.bench[0];

    const repaired = repairPlan(club.defaultPlan, squad.filter(({ id }) => id !== benched));

    expect(repaired.bench).not.toContain(benched);
  });
});
