import { beforeEach, describe, expect, it } from "vitest";
import { squadOf } from "../domain/contract/queries";
import type { PlayerProfile } from "../domain/roster/model";
import { TEAM_SIZE } from "../domain/tactics/model";
import { inspectPlan } from "../domain/tactics/rules";
import { MemoryWorldRepository } from "../infrastructure/persistence/memory-world-repository";
import { createTestWorld } from "./__fixtures__/test-world";
import { GameApplication } from "./game-application";

const createApplication = (clubCount = 3) => {
  const world = createTestWorld(clubCount);
  const repository = new MemoryWorldRepository(world);
  return { application: new GameApplication(world, repository), repository };
};

const newPlayer = (overrides: Partial<PlayerProfile> = {}): PlayerProfile => ({
  id: "novo-jogador",
  name: "Testinho",
  nationality: "BR",
  birthYear: 2002,
  position: "centerMid",
  secondaryPositions: [],
  role: "playmaker",
  skills: {
    acceleration: 70, sprintSpeed: 70, burst: 70, stamina: 70, control: 70,
    passing: 70, vision: 70, finishing: 60, defending: 60, kickPower: 70, goalkeeping: 20,
  },
  mental: {
    decisionMaking: 70, anticipation: 70, composure: 70, aggression: 60,
    teamwork: 70, creativity: 65, intensity: 70, adaptability: 70,
  },
  ...overrides,
});

describe("GameApplication", () => {
  let context: ReturnType<typeof createApplication>;

  beforeEach(() => {
    context = createApplication();
  });

  it("abre a partida com os dois primeiros clubes do catálogo", () => {
    const { application } = context;
    expect(application.clubOf("blue").id).toBe(application.world.clubs[0].id);
    expect(application.clubOf("coral").id).toBe(application.world.clubs[1].id);
    expect(application.state.players).toHaveLength(10);
  });

  it("troca os clubes em campo e reinicia a partida", () => {
    const { application } = context;
    const third = application.world.clubs[2];

    const result = application.selectClubs(third.id, application.world.clubs[0].id);

    expect(result).toEqual({ ok: true });
    expect(application.clubOf("blue").id).toBe(third.id);
    expect(application.state.elapsed).toBe(0);
    const inPlay = new Set(application.state.players.map((player) => player.profile.id));
    expect(squadOf(application.world.players, application.world.contracts, third.id)
      .some((player) => inPlay.has(player.id))).toBe(true);
  });

  it("recusa clube inexistente", () => {
    expect(context.application.selectClubs("nao-existe", context.application.world.clubs[1].id))
      .toEqual({ ok: false, reason: "club-not-found" });
  });

  it("cria jogador como agente livre e mantém as escalações válidas", () => {
    const { application } = context;
    const before = application.world.players.length;

    expect(application.upsertPlayer(newPlayer())).toEqual({ ok: true });

    expect(application.world.players).toHaveLength(before + 1);
    expect(application.world.contracts.some(({ playerId }) => playerId === "novo-jogador")).toBe(false);
    expect(application.world.memories["novo-jogador"]).toBeDefined();
  });

  it("rejeita jogador com atributo fora da escala", () => {
    const invalid = newPlayer();
    invalid.skills.passing = 140;
    expect(context.application.upsertPlayer(invalid)).toEqual({ ok: false, reason: "invalid-player" });
  });

  it("preserva a carreira e recalibra a política quando a função muda", () => {
    const { application } = context;
    const target = application.world.players.find((player) => player.position === "centerMid")!;
    application.world.memories[target.id].stats.goals = 7;

    application.upsertPlayer({ ...target, role: target.role === "playmaker" ? "defender" : "playmaker" });

    const memory = application.world.memories[target.id];
    expect(memory.stats.goals).toBe(7);
    expect(memory.version).toBe(2);
  });

  it("exclui jogador escalado e recompõe a escalação do clube", () => {
    const { application } = context;
    const club = application.world.clubs[0];
    const starter = club.defaultPlan.assignments[3].playerId;

    expect(application.deletePlayer(starter)).toEqual({ ok: true });

    const updated = application.world.clubs.find(({ id }) => id === club.id)!;
    expect(application.world.players.some(({ id }) => id === starter)).toBe(false);
    expect(application.world.contracts.some(({ playerId }) => playerId === starter)).toBe(false);
    expect(updated.defaultPlan.assignments).toHaveLength(TEAM_SIZE);
    expect(updated.defaultPlan.assignments.some((assignment) => assignment.playerId === starter)).toBe(false);
    expect(inspectPlan(updated.defaultPlan, squadOf(application.world.players, application.world.contracts, club.id))).toEqual([]);
  });

  it("recusa excluir jogador inexistente", () => {
    expect(context.application.deletePlayer("fantasma")).toEqual({ ok: false, reason: "player-not-found" });
  });

  it("normaliza a semente e reinicia a partida", () => {
    const { application } = context;
    expect(application.setSeed(-5)).toBe(0);
    expect(application.setSeed(12.9)).toBe(12);
    expect(application.world.settings.randomSeed).toBe(12);
    expect(application.state.elapsed).toBe(0);
  });

  it("persiste configuração sem perder o catálogo", async () => {
    const { application, repository } = context;
    application.setLearningEnabled(false);

    const stored = await repository.load();
    expect(stored?.settings.learningEnabled).toBe(false);
    expect(stored?.clubs).toHaveLength(3);
  });

  it("restaura as memórias iniciais de todos os jogadores", () => {
    const { application } = context;
    const target = application.world.players[0].id;
    application.world.memories[target].stats.goals = 4;

    application.resetLearning();

    expect(application.world.memories[target].stats.goals).toBe(0);
    expect(Object.keys(application.world.memories)).toHaveLength(application.world.players.length);
  });

  it("entrega um estado de partida isolado do catálogo", () => {
    const { application } = context;
    const runtime = application.state.players[0];
    const original = application.world.players.find(({ id }) => id === runtime.profile.id)!.name;

    runtime.profile.name = "Mexido";

    expect(application.world.players.find(({ id }) => id === runtime.profile.id)!.name).toBe(original);
  });
});
