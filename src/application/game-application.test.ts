import { beforeEach, describe, expect, it } from "vitest";
import type { PlayerProfile } from "../domain/roster/model";
import { TEAM_SIZE } from "../domain/tactics/model";
import { inspectPlan } from "../domain/tactics/rules";
import { MemoryCatalog } from "../infrastructure/persistence/memory-catalog";
import { createTestWorld } from "./__fixtures__/test-world";
import { GameApplication } from "./game-application";

const createApplication = async (clubCount = 3) => {
  const world = createTestWorld(clubCount);
  const catalog = new MemoryCatalog(world);
  const application = new GameApplication(catalog, { ...world.settings });
  // A partida não nasce com a aplicação: é o fluxo de Jogo Rápido que a põe em campo.
  await application.startMatch((await application.suggestedSetup())!);
  return { application, catalog, world };
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
  let context: Awaited<ReturnType<typeof createApplication>>;

  beforeEach(async () => {
    context = await createApplication();
  });

  it("abre a partida com os dois primeiros clubes por nome", async () => {
    const { application, catalog } = context;
    const { rows } = await catalog.clubs.page({ sort: "name", limit: 2 });

    expect(application.clubOf("blue")!.id).toBe(rows[0].id);
    expect(application.clubOf("coral")!.id).toBe(rows[1].id);
    expect(application.state.players).toHaveLength(TEAM_SIZE * 2);
  });

  it("não tem partida antes de o fluxo de jogo iniciar uma", async () => {
    const world = createTestWorld(3);
    const application = new GameApplication(new MemoryCatalog(world), { ...world.settings });

    expect(application.match).toBeNull();
    expect(application.setup).toBeNull();
    expect(() => application.state).toThrow();

    expect(await application.startMatch((await application.suggestedSetup())!)).toEqual({ ok: true });
    expect(application.match).not.toBeNull();
  });

  it("põe um clube contra ele mesmo, com o visitante em cópias", async () => {
    const { application, catalog, world } = context;
    const only = world.clubs[0];
    expect(await application.selectClubs(only.id, only.id)).toEqual({ ok: true });

    const players = application.state.players;
    expect(players).toHaveLength(TEAM_SIZE * 2);
    // A identidade em campo é única: sem isso o motor não saberia de quem é a bola.
    expect(new Set(players.map(({ profile }) => profile.id)).size).toBe(TEAM_SIZE * 2);
    // E são os mesmos atletas dos dois lados.
    const names = (team: "blue" | "coral") => players
      .filter((player) => player.team === team).map(({ profile }) => profile.name).sort();
    expect(names("coral")).toEqual(names("blue"));

    // O que as cópias aprendem não vira registro novo no catálogo.
    application.persistMatchProgress();
    await Promise.resolve();
    const stored = (await catalog.memories.page({ limit: 0 })).rows;
    const known = new Set((await catalog.players.page({ limit: 0 })).rows.map(({ id }) => id));
    expect(stored.every(({ playerId }) => known.has(playerId))).toBe(true);
  });

  it("aceita o ajuste tático com a bola rolando, mas não a substituição", () => {
    const { application } = context;
    const plan = structuredClone(application.setup!.blue.plan);
    plan.mentality.pressing = 100;
    plan.buildUpStyle = "direct";

    expect(application.adjustPlan("blue", plan)).toEqual({ ok: true });
    const tactics = application.match!.liveState.tactics;
    expect(tactics.blue.directives.mentality.pressing).toBe(100);
    expect(tactics.blue.directives.buildUpStyle).toBe("direct");
    // O outro lado não ouviu ordem nenhuma.
    expect(tactics.coral.directives.buildUpStyle).toBe("auto");
    // O ajuste fica no setup: reiniciar a partida entra com o que o treinador mandou.
    expect(application.setup!.blue.plan.mentality.pressing).toBe(100);

    // Pôr um reserva em campo é substituição, e o motor ainda não a tem.
    const entrando = plan.bench[0];
    const vaga = plan.assignments.find(({ slotId }) => slotId !== "gol")!;
    const substituicao = {
      ...plan,
      assignments: plan.assignments.map((assignment) =>
        assignment === vaga ? { ...assignment, playerId: entrando } : assignment),
      bench: plan.bench.filter((id) => id !== entrando),
    };
    expect(inspectPlan(substituicao, application.squadInPlay("blue"))).toEqual([]);
    expect(application.adjustPlan("blue", substituicao)).toEqual({ ok: false, reason: "lineup-locked" });
  });

  it("congela a partida ao sair, sem descartá-la", () => {
    const { application } = context;
    application.leaveMatch();

    expect(application.match).not.toBeNull();
    expect(application.match!.paused).toBe(true);
  });

  it("troca os clubes em campo e reinicia a partida", async () => {
    const { application, world } = context;
    const third = world.clubs[2];

    const result = await application.selectClubs(third.id, world.clubs[0].id);

    expect(result).toEqual({ ok: true });
    expect(application.clubOf("blue")!.id).toBe(third.id);
    expect(application.state.elapsed).toBe(0);
    const inPlay = new Set(application.state.players.map((player) => player.profile.id));
    const squad = await application.squadOfClub(third.id);
    expect(squad.players.some((player) => inPlay.has(player.id))).toBe(true);
  });

  it("recusa clube inexistente", async () => {
    expect(await context.application.selectClubs("nao-existe", context.world.clubs[1].id))
      .toEqual({ ok: false, reason: "club-not-found" });
  });

  it("cria jogador como agente livre e lhe dá memória inicial", async () => {
    const { application, catalog } = context;
    const before = (await catalog.players.page()).total;

    expect(await application.savePlayer(newPlayer())).toEqual({ ok: true });

    expect((await catalog.players.page()).total).toBe(before + 1);
    const { rows } = await catalog.contracts.page({ filter: { field: "playerId", value: "novo-jogador" } });
    expect(rows).toHaveLength(0);
    expect(await catalog.memories.get("novo-jogador")).not.toBeNull();
  });

  it("rejeita jogador com atributo fora da escala", async () => {
    const invalid = newPlayer();
    invalid.skills.passing = 140;
    expect(await context.application.savePlayer(invalid)).toEqual({ ok: false, reason: "invalid-player" });
  });

  it("preserva a carreira e recalibra a política quando a função muda", async () => {
    const { application, catalog, world } = context;
    const target = world.players.find((player) => player.position === "centerMid")!;
    const memory = (await catalog.memories.get(target.id))!;
    memory.stats.goals = 7;
    await catalog.memories.put([memory]);

    await application.savePlayer({ ...target, role: target.role === "playmaker" ? "defender" : "playmaker" });

    const updated = (await catalog.memories.get(target.id))!;
    expect(updated.stats.goals).toBe(7);
    expect(updated.version).toBe(2);
  });

  it("exclui jogador escalado e recompõe a escalação do clube", async () => {
    const { application, catalog, world } = context;
    const club = world.clubs[0];
    const starter = club.defaultPlan.assignments[3].playerId;

    expect(await application.deletePlayer(starter)).toEqual({ ok: true });

    const updated = (await catalog.clubs.get(club.id))!;
    const squad = await application.squadOfClub(club.id);
    expect(await catalog.players.get(starter)).toBeNull();
    expect((await catalog.contracts.page({ filter: { field: "playerId", value: starter } })).total).toBe(0);
    expect(updated.defaultPlan.assignments).toHaveLength(TEAM_SIZE);
    expect(updated.defaultPlan.assignments.some((assignment) => assignment.playerId === starter)).toBe(false);
    expect(inspectPlan(updated.defaultPlan, squad.players)).toEqual([]);
  });

  /**
   * O ganho da integridade incremental sobre a varredura global: os outros clubes não são
   * sequer tocados. Se um dia alguém reintroduzir um `repairWorld` no caminho da edição, este
   * teste acusa — os planos alheios voltariam a ser reescritos.
   */
  it("não toca nos planos dos outros clubes ao excluir um jogador", async () => {
    const { application, catalog, world } = context;
    const untouched = world.clubs.slice(1);
    const before = untouched.map((club) => JSON.stringify(club.defaultPlan));

    await application.deletePlayer(world.clubs[0].defaultPlan.assignments[3].playerId);

    for (const [index, club] of untouched.entries()) {
      expect(JSON.stringify((await catalog.clubs.get(club.id))!.defaultPlan)).toBe(before[index]);
    }
  });

  it("recusa excluir jogador inexistente", async () => {
    expect(await context.application.deletePlayer("fantasma")).toEqual({ ok: false, reason: "player-not-found" });
  });

  it("excluir clube solta os jogadores como agentes livres, sem apagá-los", async () => {
    const { application, catalog, world } = context;
    const club = world.clubs[2];
    const squad = await application.squadOfClub(club.id);
    expect(squad.players.length).toBeGreaterThan(0);

    expect(await application.deleteClub(club.id)).toEqual({ ok: true });

    expect(await catalog.clubs.get(club.id)).toBeNull();
    expect((await catalog.contracts.page({ filter: { field: "clubId", value: club.id } })).total).toBe(0);
    for (const player of squad.players) expect(await catalog.players.get(player.id)).not.toBeNull();
  });

  it("normaliza a semente e reinicia a partida", () => {
    const { application } = context;
    expect(application.setSeed(-5)).toBe(0);
    expect(application.setSeed(12.9)).toBe(12);
    expect(application.settings.randomSeed).toBe(12);
    expect(application.state.elapsed).toBe(0);
  });

  it("persiste configuração sem tocar no catálogo", async () => {
    const { application, catalog } = context;
    application.setLearningEnabled(false);

    expect((await catalog.loadSettings())?.learningEnabled).toBe(false);
    expect((await catalog.clubs.page()).total).toBe(3);
  });

  it("restaura as memórias iniciais de todos os jogadores", async () => {
    const { application, catalog, world } = context;
    const target = world.players[0].id;
    const memory = (await catalog.memories.get(target))!;
    memory.stats.goals = 4;
    await catalog.memories.put([memory]);

    await application.resetLearning();

    expect((await catalog.memories.get(target))!.stats.goals).toBe(0);
    expect((await catalog.memories.page()).total).toBe(world.players.length);
  });

  it("entrega um estado de partida isolado do catálogo", async () => {
    const { application, catalog } = context;
    const runtime = application.state.players[0];
    const original = (await catalog.players.get(runtime.profile.id))!.name;

    runtime.profile.name = "Mexido";

    expect((await catalog.players.get(runtime.profile.id))!.name).toBe(original);
  });
});
