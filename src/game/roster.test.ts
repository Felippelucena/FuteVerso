import { describe, expect, it } from "vitest";
import { PASS_VARIANTS, decideAll, formationAnchor } from "./ai";
import { FIELD, PHYSICS } from "./config";
import { createGameState, executeBallAction, playerSpeedLimit, stepGame } from "./engine";
import { distance, length } from "./math";
import { createDefaultSave, validateLineups } from "./roster";

describe("escalações 4 x 4", () => {
  it("usa campo e gol escalados", () => {
    expect(FIELD.width).toBeCloseTo(180, 5);
    expect(FIELD.height).toBeCloseTo(108, 5);
    expect(FIELD.goalBottom - FIELD.goalTop).toBeCloseTo(33.6, 5);
    expect(FIELD.goalDepth).toBe(7);
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
    expect(controlled / walk).toBeCloseTo(PHYSICS.controlledSpeedFactor / PHYSICS.walkSpeedFactor, 5);
    expect(controlledSprint / controlled).toBeCloseTo(PHYSICS.controlledSprintSpeedFactor / PHYSICS.controlledSpeedFactor, 5);
    expect(run / walk).toBeCloseTo(PHYSICS.runSpeedFactor / PHYSICS.walkSpeedFactor, 5);
    expect(burst / run).toBeCloseTo(PHYSICS.burstSpeedFactor / PHYSICS.runSpeedFactor, 5);
    expect(controlledSprint / controlled).toBeGreaterThan(1.5);
    expect(burst / run).toBeGreaterThan(1.5);
  });

  it("dimensiona a força do toque e a duração do pique pela distância pretendida", () => {
    const performKnockOn = (targetDistance: number) => {
      const state = createGameState(createDefaultSave(), 812);
      state.kickoffTimer = 0;
      const attacker = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
      attacker.position = { x: FIELD.width * 0.35, y: FIELD.height / 2 };
      attacker.velocity = { x: 0, y: 0 };
      attacker.profile.skills.control = 88;
      attacker.profile.skills.burst = 88;
      state.players.forEach((player, index) => {
        if (player !== attacker) player.position = { x: FIELD.width * 0.75 + index, y: 8 + index * 10 };
      });
      state.ball.position = { x: attacker.position.x + attacker.radius + state.ball.radius + 0.15, y: attacker.position.y };
      state.ball.controllerId = attacker.profile.id;
      state.ball.controlStartedAt = state.elapsed - 1;

      executeBallAction(state, attacker, {
        kind: "dribble",
        style: "knockOn",
        target: { x: attacker.position.x + targetDistance, y: attacker.position.y },
      });

      return { ballSpeed: length(state.ball.velocity), sprintTimer: attacker.sprintTimer };
    };

    const shortTouch = performKnockOn(18);
    const longTouch = performKnockOn(31);

    expect(longTouch.ballSpeed).toBeGreaterThan(shortTouch.ballSpeed * 1.15);
    expect(longTouch.sprintTimer).toBeGreaterThan(shortTouch.sprintTimer);
    expect(shortTouch.sprintTimer).toBeGreaterThan(PHYSICS.burstDuration);
  });

  it("faz o defensor sustentar a explosão numa disputa por um toque longo", () => {
    const state = createGameState(createDefaultSave(), 913);
    state.kickoffTimer = 0;
    const attacker = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    const defender = state.players.find((player) => player.team === "coral" && player.profile.position === "centerBack")!;
    state.ball.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    state.ball.velocity = { x: 30, y: 0 };
    state.ball.controllerId = null;
    state.ball.dribbleOwnerId = attacker.profile.id;
    state.ball.dribbleStyle = "knockOn";
    state.ball.dribbleStartedAt = state.elapsed;
    attacker.position = { x: state.ball.position.x - 5, y: state.ball.position.y };
    defender.position = { x: state.ball.position.x - 24, y: state.ball.position.y };
    state.players.forEach((player, index) => {
      if (player.team === "coral" && player !== defender) player.position = { x: FIELD.width - 8, y: 8 + index * 14 };
    });

    const decision = decideAll(state).get(defender.profile.id)!;

    expect(decision.burst).toBe(true);
    expect(decision.burstDuration).toBeGreaterThan(PHYSICS.burstDuration);
    stepGame(state, 1 / 120);
    expect(defender.sprintTimer).toBeGreaterThan(PHYSICS.burstDuration);
    expect(defender.pace).toBe("burst");
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

  it("faz uma finalizacao viajar claramente mais rapido que um passe longo", () => {
    const shotState = createGameState(createDefaultSave(), 515);
    shotState.kickoffTimer = 0;
    const shooter = shotState.players.find((player) => player.team === "blue" && player.profile.role === "finisher")!;
    shooter.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    shooter.profile.skills.kickPower = 75;
    shotState.players.forEach((player, index) => {
      if (player !== shooter) player.position = { x: 10 + index * 8, y: 10 };
    });
    shotState.ball.position = { ...shooter.position };
    executeBallAction(shotState, shooter, {
      kind: "shot",
      target: { x: FIELD.width, y: FIELD.height / 2 },
      power: 0.8,
    });
    const shotSpeed = length(shotState.ball.velocity);

    const passState = createGameState(createDefaultSave(), 515);
    passState.kickoffTimer = 0;
    const passer = passState.players.find((player) => player.profile.id === shooter.profile.id)!;
    const receiver = passState.players.find((player) => player.team === passer.team && player !== passer)!;
    passer.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    passer.profile.skills.kickPower = 75;
    passState.players.forEach((player, index) => {
      if (player !== passer) player.position = { x: 10 + index * 8, y: 10 };
    });
    passState.ball.position = { ...passer.position };
    executeBallAction(passState, passer, {
      kind: "pass",
      receiverId: receiver.profile.id,
      target: { x: FIELD.width * 0.82, y: FIELD.height / 2 },
      trajectory: "ground",
      range: "long",
      targeting: "space",
      power: 1,
    });
    const passSpeed = length(passState.ball.velocity);

    expect(shotSpeed).toBeGreaterThan(85);
    expect(shotSpeed).toBeGreaterThan(passSpeed * 1.3);
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
      x: target.position.x + target.radius * PHYSICS.passiveCollisionRadiusFactor + state.ball.radius + 0.05,
      y: target.position.y,
    };
    state.ball.velocity = { x: -30, y: 0 };

    stepGame(state, 1 / 60);

    expect(state.ball.velocity.x).toBeGreaterThan(target.velocity.x);
    expect(state.ball.lastTouchPlayerId).toBe(target.profile.id);
    expect(state.ball.position.x).toBeGreaterThan(target.position.x);
  });

  it("deixa uma bola forte escapar de um jogador sem controle para domina-la", () => {
    const state = createGameState(createDefaultSave(), 812);
    state.kickoffTimer = 0;
    const receiver = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    receiver.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    receiver.velocity = { x: 0, y: 0 };
    receiver.facing = { x: 1, y: 0 };
    receiver.profile.skills.control = 1;
    receiver.profile.skills.defending = 1;
    receiver.profile.skills.acceleration = 1;
    state.players.forEach((player, index) => {
      if (player !== receiver) player.position = { x: 8 + index * 8, y: 9 };
      player.kickCooldown = player === receiver ? 0 : 10;
    });
    state.ball.position = { x: receiver.position.x - 3.1, y: receiver.position.y };
    state.ball.velocity = { x: 60, y: 0 };
    state.ball.controllerId = null;

    stepGame(state, 1 / 120);

    expect(state.ball.controllerId).not.toBe(receiver.profile.id);
    expect(receiver.controlCooldown).toBeGreaterThan(0);
  });

  it("transforma um passe dificil em toque pesado em vez de controle magnetico", () => {
    const state = createGameState(createDefaultSave(), 42);
    state.kickoffTimer = 0;
    const receiver = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    const passer = state.players.find((player) => player.team === "blue" && player !== receiver)!;
    receiver.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    receiver.velocity = { x: 0, y: 0 };
    receiver.facing = { x: 1, y: 0 };
    state.players.forEach((player, index) => {
      if (player !== receiver) player.position = { x: 8 + index * 8, y: 9 };
      player.kickCooldown = player === receiver ? 0 : 10;
    });
    state.ball.position = { x: receiver.position.x - 3.1, y: receiver.position.y };
    state.ball.velocity = { x: 40, y: 0 };
    state.ball.controllerId = null;
    state.ball.lastAction = "pass";
    state.ball.lastTouch = passer.team;
    state.ball.lastTouchPlayerId = passer.profile.id;
    state.pendingPass = {
      passerId: passer.profile.id,
      receiverId: receiver.profile.id,
      team: receiver.team,
      startedAt: 0,
      trajectory: "ground",
      range: "short",
    };

    stepGame(state, 1 / 120);

    expect(state.ball.controllerId).toBeNull();
    expect(state.ball.lastTouchPlayerId).toBe(receiver.profile.id);
    expect(state.ball.velocity.x).toBeGreaterThan(0);
    expect(state.ball.velocity.x).toBeLessThan(40);
    expect(receiver.controlCooldown).toBeGreaterThan(PHYSICS.controlAttemptCooldown);
  });

  it("nao usa todo o raio visual do jogador como uma parede", () => {
    const state = createGameState(createDefaultSave(), 913);
    state.kickoffTimer = 0;
    const target = state.players[0];
    target.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    target.velocity = { x: 0, y: 0 };
    state.players.forEach((player, index) => {
      player.kickCooldown = 10;
      player.reactionTimer = 10;
      if (player !== target) player.position = { x: 8 + index * 7, y: 10 };
    });
    state.ball.position = {
      x: target.position.x,
      y: target.position.y + target.radius * PHYSICS.passiveCollisionRadiusFactor + state.ball.radius + 0.08,
    };
    state.ball.velocity = { x: 0, y: 0 };
    state.ball.lastTouch = null;
    state.ball.lastTouchPlayerId = null;

    stepGame(state, 1 / 120);

    expect(state.ball.lastTouchPlayerId).toBeNull();
  });

  it("faz a finta vencedora passar pelo defensor sem permitir resposta imediata", () => {
    const state = createGameState(createDefaultSave(), 2026);
    state.kickoffTimer = 0;
    state.elapsed = 20;
    const attacker = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    const defender = state.players.find((player) => player.team === "coral" && player.profile.position === "centerBack")!;
    attacker.position = { x: FIELD.width * 0.42, y: FIELD.height / 2 };
    attacker.velocity = { x: 2, y: 0 };
    attacker.facing = { x: 1, y: 0 };
    attacker.profile.skills.control = 100;
    attacker.profile.skills.burst = 100;
    defender.position = { x: attacker.position.x + 5, y: attacker.position.y };
    defender.velocity = { x: -2, y: 0 };
    defender.profile.skills.defending = 1;
    defender.profile.skills.acceleration = 1;
    state.players.forEach((player, index) => {
      if (player !== attacker && player !== defender) player.position = { x: 10 + index * 12, y: 10 };
    });
    state.ball.position = { x: attacker.position.x + attacker.radius + state.ball.radius + 0.15, y: attacker.position.y };
    state.ball.controllerId = attacker.profile.id;
    state.ball.controlStartedAt = state.elapsed - 1;
    state.ball.lastTouch = attacker.team;
    state.ball.lastTouchPlayerId = attacker.profile.id;
    const initialSeparation = distance(attacker.position, defender.position);

    executeBallAction(state, attacker, {
      kind: "dribble",
      style: "feint",
      target: { x: attacker.position.x + 14, y: attacker.position.y + 2 },
    });

    expect(state.stats.blue.feintsCompleted).toBe(1);
    expect(state.feintEvasion).toMatchObject({ attackerId: attacker.profile.id, defenderId: defender.profile.id });
    expect(state.ball.dribbleOwnerId).toBe(attacker.profile.id);
    expect(state.ball.velocity.x).toBeGreaterThan(0);
    expect(defender.reactionTimer).toBeGreaterThan(0);
    expect(defender.controlCooldown).toBeGreaterThan(0);

    for (let tick = 0; tick < 60; tick += 1) {
      stepGame(state, 1 / 120);
      expect(state.ball.controllerId).not.toBe(defender.profile.id);
    }
    expect(state.stats.coral.feintsAttempted).toBe(0);
    expect(distance(attacker.position, defender.position)).toBeGreaterThan(initialSeparation + 2);
  });

  it("nao permite finta antes de o jogador estabilizar a posse", () => {
    const state = createGameState(createDefaultSave(), 77);
    state.kickoffTimer = 0;
    state.elapsed = 12;
    const attacker = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    const defender = state.players.find((player) => player.team === "coral" && player.profile.position === "centerBack")!;
    attacker.position = { x: FIELD.width * 0.4, y: FIELD.height / 2 };
    attacker.profile.skills.control = 100;
    attacker.profile.skills.burst = 100;
    defender.position = { x: attacker.position.x + 4, y: attacker.position.y };
    defender.velocity = { x: -4, y: 0 };
    state.ball.position = { x: attacker.position.x + 3, y: attacker.position.y };
    state.ball.controllerId = attacker.profile.id;
    state.ball.controlStartedAt = state.elapsed - PHYSICS.feintControlSettleTime / 2;

    const decision = decideAll(state).get(attacker.profile.id)!;

    expect(decision.ballAction.kind === "dribble" && decision.ballAction.style === "feint").toBe(false);
  });

  it("antecipa o corte quando um defensor se aproxima em velocidade", () => {
    const state = createGameState(createDefaultSave(), 78);
    state.kickoffTimer = 0;
    state.elapsed = 12;
    const attacker = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    const defender = state.players.find((player) => player.team === "coral" && player.profile.position === "centerBack")!;
    attacker.position = { x: FIELD.width * 0.4, y: FIELD.height / 2 };
    attacker.velocity = { x: 1, y: 0 };
    attacker.facing = { x: 1, y: 0 };
    attacker.profile.skills.control = 100;
    attacker.profile.skills.burst = 100;
    attacker.memory.policy.dribble = 0.9;
    attacker.memory.policy.pass = 0.28;
    attacker.memory.policy.shoot = 0.28;
    defender.position = { x: attacker.position.x + 10, y: attacker.position.y };
    defender.velocity = { x: -8, y: 0 };
    state.players.forEach((player, index) => {
      if (player.team === attacker.team && player !== attacker) player.position = { x: 10 + index * 6, y: 12 + index * 8 };
      if (player.team === defender.team && player !== defender) player.position = { x: FIELD.width - 12, y: 12 + index * 12 };
    });
    state.ball.position = { x: attacker.position.x + 3, y: attacker.position.y };
    state.ball.controllerId = attacker.profile.id;
    state.ball.controlStartedAt = state.elapsed - 1;

    const decision = decideAll(state).get(attacker.profile.id)!;

    expect(decision.ballAction).toMatchObject({ kind: "dribble", style: "feint" });
    expect(decision.burst).toBe(true);
  });

  it("resolve a chegada simultanea na bola antes de liberar qualquer finta", () => {
    const state = createGameState(createDefaultSave(), 144);
    state.kickoffTimer = 0;
    state.elapsed = 10;
    const blue = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    const coral = state.players.find((player) => player.team === "coral" && player.profile.position === "midfielder")!;
    const center = { x: FIELD.width / 2, y: FIELD.height / 2 };
    blue.position = { x: center.x - 3.1, y: center.y };
    blue.velocity = { x: 4, y: 0 };
    blue.facing = { x: 1, y: 0 };
    coral.position = { x: center.x + 3.1, y: center.y };
    coral.velocity = { x: -4, y: 0 };
    coral.facing = { x: -1, y: 0 };
    for (const player of [blue, coral]) {
      player.profile.skills.control = 100;
      player.profile.skills.burst = 100;
      player.memory.policy.dribble = 0.9;
    }
    state.players.forEach((player, index) => {
      if (player !== blue && player !== coral) {
        player.position = { x: 8 + index * 8, y: 9 };
        player.kickCooldown = 10;
      }
    });
    state.ball.position = center;
    state.ball.velocity = { x: 0, y: 0 };
    state.ball.controllerId = null;

    for (let tick = 0; tick < 24; tick += 1) stepGame(state, 1 / 120);

    expect(state.stats.blue.feintsAttempted + state.stats.coral.feintsAttempted).toBe(0);
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
