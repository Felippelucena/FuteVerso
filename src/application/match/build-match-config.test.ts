import { describe, expect, it } from "vitest";
import { squadOf } from "../../domain/contract/queries";
import { TEAM_SIZE } from "../../domain/tactics/model";
import { DEFAULT_INSTRUCTION, instructionFor } from "../../domain/tactics/model";
import { positionFit } from "../../domain/tactics/position-fit";
import { findSlot, GOALKEEPER_SLOT_ID } from "../../domain/tactics/slots";
import { createTestSetup, createTestWorld } from "../__fixtures__/test-world";
import { buildMatchConfig } from "./build-match-config";

describe("buildMatchConfig", () => {
  it("monta os participantes dos dois clubes com goleiro em primeiro", () => {
    const world = createTestWorld();
    const config = buildMatchConfig(world, createTestSetup(world));

    expect(config.participants).toHaveLength(TEAM_SIZE * 2);
    for (const team of ["blue", "coral"] as const) {
      const side = config.participants.filter((participant) => participant.team === team);
      expect(side.map(({ lineupIndex }) => lineupIndex)).toEqual([...Array(TEAM_SIZE).keys()]);
      expect(side[0].slotId).toBe(GOALKEEPER_SLOT_ID);
      expect(side[0].profile.position).toBe("goalkeeper");
      expect(side.slice(1).every((participant) => participant.profile.position !== "goalkeeper")).toBe(true);
      // Do gol ao ataque: a coluna do slot nunca anda para trás.
      const columns = side.map(({ slotId }) => findSlot(slotId)!.zone.column);
      expect(columns).toEqual([...columns].sort((first, second) => first - second));
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

describe("plano tático que viaja com o participante", () => {
  it("leva slot, encaixe e instrução de cada titular", () => {
    const world = createTestWorld();
    const setup = createTestSetup(world);
    const config = buildMatchConfig(world, setup);

    for (const team of ["blue", "coral"] as const) {
      const squad = squadOf(world.players, world.contracts, setup[team].clubId);
      for (const participant of config.participants.filter((entry) => entry.team === team)) {
        const assignment = setup[team].plan.assignments
          .find(({ playerId }) => playerId === participant.profile.id)!;
        const profile = squad.find(({ id }) => id === participant.profile.id)!;
        expect(participant.slotId).toBe(assignment.slotId);
        expect(participant.positionFit).toBe(positionFit(profile, findSlot(assignment.slotId)!).rating);
        expect(participant.instruction).toEqual(instructionFor(setup[team].plan, assignment.slotId));
      }
    }
  });

  it("usa a instrução padrão para slot sem ajuste do treinador", () => {
    const world = createTestWorld();
    const setup = createTestSetup(world);
    setup.blue.plan.instructions = {};

    const config = buildMatchConfig(world, setup);

    expect(config.participants.filter(({ team }) => team === "blue")
      .every(({ instruction }) => instruction.support === DEFAULT_INSTRUCTION.support)).toBe(true);
  });

  it("entrega instrução isolada do plano", () => {
    const world = createTestWorld();
    const setup = createTestSetup(world);
    const config = buildMatchConfig(world, setup);
    const participant = config.participants[0];

    participant.instruction.support = "attack";

    expect(instructionFor(setup.blue.plan, participant.slotId).support).toBe(DEFAULT_INSTRUCTION.support);
  });
});
