import { describe, expect, it } from "vitest";
import { squadOf } from "../../domain/contract/queries";
import { TEAM_SIZE } from "../../domain/tactics/model";
import { GOALKEEPER_SLOT_ID } from "../../domain/tactics/slots";
import { createTestSetup, createTestWorld } from "../__fixtures__/test-world";
import { buildMatchConfig, ENGINE_FIELD_PLAYERS, selectStarters } from "./build-match-config";

describe("buildMatchConfig", () => {
  it("monta os participantes dos dois clubes com goleiro em primeiro", () => {
    const world = createTestWorld();
    const config = buildMatchConfig(world, createTestSetup(world));

    expect(config.participants).toHaveLength((ENGINE_FIELD_PLAYERS + 1) * 2);
    for (const team of ["blue", "coral"] as const) {
      const side = config.participants.filter((participant) => participant.team === team);
      expect(side.map(({ lineupIndex }) => lineupIndex)).toEqual([0, 1, 2, 3, 4]);
      expect(side[0].profile.position).toBe("goalkeeper");
      expect(side.slice(1).every((participant) => participant.profile.position !== "goalkeeper")).toBe(true);
    }
    expect(config.seed).toBe(world.settings.randomSeed);
    expect(config.learningEnabled).toBe(true);
  });

  it("veste cada participante com a camisa do contrato", () => {
    const world = createTestWorld();
    const config = buildMatchConfig(world, createTestSetup(world));

    for (const participant of config.participants) {
      const contract = world.contracts.find(({ playerId }) => playerId === participant.profile.id)!;
      expect(participant.shirtNumber).toBe(contract.shirtNumber);
    }
  });

  it("aceita semente sobrescrita e cria memória ausente", () => {
    const world = createTestWorld();
    const setup = createTestSetup(world);
    const starter = setup.blue.plan.assignments[0].playerId;
    delete world.memories[starter];

    const config = buildMatchConfig(world, setup, 42);

    expect(config.seed).toBe(42);
    expect(config.participants.find(({ profile }) => profile.id === starter)?.memory.playerId).toBe(starter);
  });

  it("produz um snapshot sem referências compartilhadas com o mundo", () => {
    const world = createTestWorld();
    const config = buildMatchConfig(world, createTestSetup(world));
    const participant = config.participants[0];
    const originalName = world.players.find(({ id }) => id === participant.profile.id)!.name;

    participant.profile.name = "Alterado";
    participant.memory.stats.goals = 99;

    expect(world.players.find(({ id }) => id === participant.profile.id)!.name).toBe(originalName);
    expect(world.memories[participant.profile.id].stats.goals).toBe(0);
  });

  it("rejeita plano com jogador que não pertence ao clube", () => {
    const world = createTestWorld();
    const setup = createTestSetup(world);
    const intruder = squadOf(world.players, world.contracts, world.clubs[1].id)[0];
    setup.blue.plan.assignments[1] = { ...setup.blue.plan.assignments[1], playerId: intruder.id };

    expect(() => buildMatchConfig(world, setup)).toThrow("Plano tático inválido");
  });

  it("rejeita clube fora do catálogo", () => {
    const world = createTestWorld();
    const setup = createTestSetup(world);
    setup.coral.clubId = "club-inexistente";

    expect(() => buildMatchConfig(world, setup)).toThrow("não existe no catálogo");
  });
});

describe("selectStarters", () => {
  it("recorta os onze escalados no formato que o motor ainda simula", () => {
    const world = createTestWorld();
    const plan = world.clubs[0].defaultPlan;
    expect(plan.assignments).toHaveLength(TEAM_SIZE);

    const starters = selectStarters(plan);

    expect(starters).toHaveLength(ENGINE_FIELD_PLAYERS + 1);
    expect(starters[0].slot.id).toBe(GOALKEEPER_SLOT_ID);
    expect(new Set(starters.map(({ playerId }) => playerId)).size).toBe(starters.length);
  });

  it("mantém forma de time: um defensor, dois meias e um atacante", () => {
    const world = createTestWorld(4);
    for (const club of world.clubs) {
      const outfield = selectStarters(club.defaultPlan).slice(1);
      const bands = outfield.map(({ slot }) => slot.zone.column <= 2 ? "defesa" : slot.zone.column <= 6 ? "meio" : "ataque");
      expect(bands.filter((band) => band === "defesa")).toHaveLength(1);
      expect(bands.filter((band) => band === "meio")).toHaveLength(2);
      expect(bands.filter((band) => band === "ataque")).toHaveLength(1);
    }
  });

  it("devolve o time inteiro quando o corte não é necessário", () => {
    const world = createTestWorld();
    const starters = selectStarters(world.clubs[0].defaultPlan, TEAM_SIZE - 1);
    expect(starters).toHaveLength(TEAM_SIZE);
  });
});
