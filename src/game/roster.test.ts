import { describe, expect, it } from "vitest";
import { PASS_VARIANTS, decideAll, formationAnchor } from "./ai";
import { FIELD, PHYSICS } from "./config";
import { createGameState, playerSpeedLimit, stepGame } from "./engine";
import { distance } from "./math";
import { createDefaultSave, validateLineups } from "./roster";

describe("escalações 4 x 4", () => {
  it("usa campo e gol escalados", () => {
    expect(FIELD.width).toBeCloseTo(230, 5);
    expect(FIELD.height).toBeCloseTo(138, 5);
    expect(FIELD.goalBottom - FIELD.goalTop).toBeCloseTo(38.4, 5);
    expect(FIELD.goalDepth).toBe(8);
  });

  it("cria oito titulares com um goleiro por time", () => {
    const save = createDefaultSave();
    const state = createGameState(save);
    expect(validateLineups(save.players, save.lineups)).toBe(true);
    expect(state.players).toHaveLength(8);
    for (const team of ["blue", "coral"] as const) {
      expect(state.players.filter((player) => player.team === team && player.profile.position === "goalkeeper")).toHaveLength(1);
    }
  });

  it("recusa um jogador repetido nas duas equipes", () => {
    const save = createDefaultSave();
    save.lineups.coral.fieldPlayerIds[0] = save.lineups.blue.fieldPlayerIds[0];
    expect(validateLineups(save.players, save.lineups)).toBe(false);
  });

  it("faz posição e função alterarem a âncora", () => {
    const state = createGameState(createDefaultSave());
    const defender = state.players.find((player) => player.profile.position === "centerBack")!;
    const original = formationAnchor(defender);
    defender.profile.role = "finisher";
    expect(formationAnchor(defender).x).not.toBe(original.x);
  });
});

describe("ações e física", () => {
  it("expõe as oito combinações de passe", () => {
    expect(PASS_VARIANTS).toHaveLength(8);
    expect(new Set(PASS_VARIANTS.map((variant) => `${variant.trajectory}-${variant.range}-${variant.targeting}`)).size).toBe(8);
  });

  it("diferencia condução, pique com bola e explosão sem a bola", () => {
    const player = createGameState(createDefaultSave()).players[3];
    const walk = playerSpeedLimit(player, false);
    const run = playerSpeedLimit(player, false, true);
    const controlled = playerSpeedLimit(player, true);
    player.sprintTimer = 0.2;
    const controlledSprint = playerSpeedLimit(player, true);
    const burst = playerSpeedLimit(player, false);
    expect(controlled / walk).toBeCloseTo(0.78, 5);
    expect(controlledSprint / walk).toBeCloseTo(0.94, 5);
    expect(run / walk).toBeCloseTo(1.48, 5);
    expect(burst / walk).toBeCloseTo(1.85, 5);
  });

  it("evita tirar o goleiro do gol para pressionar longe da area", () => {
    const state = createGameState(createDefaultSave());
    state.kickoffTimer = 0;
    state.ball.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    const goalkeeper = state.players.find((player) => player.team === "blue" && player.profile.position === "goalkeeper")!;
    const defender = state.players.find((player) => player.team === "blue" && player.profile.position === "centerBack")!;
    goalkeeper.position = { x: FIELD.width / 2 - 2, y: FIELD.height / 2 };
    defender.position = { x: FIELD.width / 2 + 11, y: FIELD.height / 2 };
    const decisions = decideAll(state);
    expect(decisions.get(goalkeeper.profile.id)?.intent).toBe("goalkeeping");
    expect(decisions.get(defender.profile.id)?.intent).toBe("pressing");
  });

  it("usa defesa e controle para decidir uma bola dividida", () => {
    const state = createGameState(createDefaultSave());
    state.kickoffTimer = 0;
    state.ball.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    state.ball.velocity = { x: 0, y: 0 };
    state.ball.controllerId = null;
    const blue = state.players.find((player) => player.team === "blue" && player.profile.position === "centerBack")!;
    const coral = state.players.find((player) => player.team === "coral" && player.profile.position === "centerBack")!;
    blue.position = { x: state.ball.position.x - 3.1, y: state.ball.position.y };
    coral.position = { x: state.ball.position.x + 3.1, y: state.ball.position.y };
    blue.profile.skills.defending = 25;
    blue.profile.skills.control = 25;
    coral.profile.skills.defending = 95;
    coral.profile.skills.control = 95;
    stepGame(state, 1 / 120);
    expect(state.ball.controllerId ?? state.ball.dribbleOwnerId).toBe(coral.profile.id);
  });

  it("encerra contato prolongado com uma tentativa real de desarme", () => {
    const state = createGameState(createDefaultSave(), 42);
    state.kickoffTimer = 0;
    const holder = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    const challenger = state.players.find((player) => player.team === "coral" && player.profile.position === "centerBack")!;
    holder.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    challenger.position = { x: holder.position.x + 4.8, y: holder.position.y };
    holder.profile.skills.control = 1;
    holder.profile.skills.burst = 1;
    challenger.profile.skills.defending = 100;
    challenger.profile.skills.acceleration = 100;
    state.ball.position = { x: holder.position.x + 3.4, y: holder.position.y };
    state.ball.controllerId = holder.profile.id;
    state.ball.lastTouch = holder.team;
    state.ball.lastTouchPlayerId = holder.profile.id;

    stepGame(state, 1 / 120);

    expect(state.ball.controllerId).not.toBe(holder.profile.id);
    expect(state.stats.coral.tacklesAttempted).toBe(1);
    expect(state.stats.coral.tacklesWon).toBe(1);
  });

  it("limita o reposicionamento da bola em uma mudanca de 180 graus", () => {
    const state = createGameState(createDefaultSave(), 1245296397);
    state.kickoffTimer = 0;
    const holder = state.players.find((player) => player.team === "coral" && player.profile.position === "centerBack")!;
    holder.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    holder.velocity = { x: 0, y: 0 };
    holder.facing = { x: 1, y: 0 };
    state.players.forEach((player, index) => {
      if (player !== holder) player.position = { x: 12 + index * 16, y: 12 };
      player.kickCooldown = 1;
    });
    holder.kickCooldown = 0;
    const carryDistance = holder.radius + state.ball.radius + 0.15;
    state.ball.position = { x: holder.position.x - carryDistance, y: holder.position.y };
    state.ball.velocity = { x: 0, y: 0 };
    state.ball.controllerId = holder.profile.id;
    state.ball.controlStartedAt = state.elapsed - 1;
    state.ball.lastTouch = holder.team;
    state.ball.lastTouchPlayerId = holder.profile.id;

    const initialBallPosition = { ...state.ball.position };
    stepGame(state, 1 / 120);
    const repositionDistance = distance(initialBallPosition, state.ball.position);

    expect(state.ball.controllerId ?? state.ball.dribbleOwnerId).toBe(holder.profile.id);
    const maximumContinuousTravel = (PHYSICS.controlledBallRepositionSpeed + PHYSICS.maxBallSpeed) / 120;
    expect(repositionDistance).toBeLessThanOrEqual(maximumContinuousTravel + 0.02);
  });

  it("faz a bola aerea quicar e perder energia ao aterrissar", () => {
    const state = createGameState(createDefaultSave(), 73);
    state.kickoffTimer = 0;
    state.ball.controllerId = null;
    state.ball.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    state.ball.velocity = { x: 20, y: 0 };
    state.ball.height = 0.05;
    state.ball.verticalVelocity = -8;
    state.players.forEach((player) => { player.kickCooldown = 10; });

    stepGame(state, 1 / 60);

    expect(state.ball.height).toBe(0);
    expect(state.ball.verticalVelocity).toBeCloseTo((8 + PHYSICS.gravity / 60) * PHYSICS.ballBounce, 5);
    expect(state.ball.velocity.x).toBeGreaterThan(0);
    expect(state.ball.velocity.x).toBeLessThan(20 * PHYSICS.landingFriction);
  });

  it("reflete a bola que encontra um jogador de frente", () => {
    const state = createGameState(createDefaultSave(), 91);
    state.kickoffTimer = 0;
    state.ball.controllerId = null;
    const target = state.players[0];
    target.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    target.velocity = { x: 0, y: 0 };
    state.players.forEach((player, index) => {
      player.kickCooldown = 10;
      if (player !== target) player.position = { x: 8 + index * 7, y: 10 };
    });
    state.ball.position = {
      x: target.position.x + target.radius + state.ball.radius + 0.05,
      y: target.position.y,
    };
    state.ball.velocity = { x: -30, y: 0 };

    stepGame(state, 1 / 60);

    expect(state.ball.velocity.x).toBeGreaterThan(target.velocity.x);
    expect(state.ball.lastTouchPlayerId).toBe(target.profile.id);
    expect(state.ball.position.x).toBeGreaterThan(target.position.x);
  });

  it("reproduz a partida quando a semente é igual", () => {
    const save = createDefaultSave();
    const first = createGameState(save, 12345);
    const second = createGameState(save, 12345);
    for (let tick = 0; tick < 2400; tick += 1) {
      stepGame(first, 1 / 120);
      stepGame(second, 1 / 120);
    }
    expect(second).toEqual(first);
  });

  it("produz trajetorias diferentes quando a semente muda", () => {
    const save = createDefaultSave();
    const first = createGameState(save, 12_345);
    const second = createGameState(save, 54_321);
    for (let tick = 0; tick < 2400; tick += 1) {
      stepGame(first, 1 / 120);
      stepGame(second, 1 / 120);
    }
    expect(second.players.map((player) => player.position))
      .not.toEqual(first.players.map((player) => player.position));
  });

  it("simula dez minutos sem valores inválidos ou atletas fora do campo", () => {
    const state = createGameState(createDefaultSave(), 98765);
    for (let tick = 0; tick < 72_000; tick += 1) stepGame(state, 1 / 120);
    for (const player of state.players) {
      expect(Number.isFinite(player.position.x) && Number.isFinite(player.position.y)).toBe(true);
      expect(player.position.x).toBeGreaterThanOrEqual(player.radius);
      expect(player.position.x).toBeLessThanOrEqual(FIELD.width - player.radius);
      expect(player.position.y).toBeGreaterThanOrEqual(player.radius);
      expect(player.position.y).toBeLessThanOrEqual(FIELD.height - player.radius);
    }
    expect(Number.isFinite(state.ball.position.x) && Number.isFinite(state.ball.position.y)).toBe(true);
  }, 15_000);
});
