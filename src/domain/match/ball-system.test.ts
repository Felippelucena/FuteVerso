import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { PASS_VARIANTS, choosePass, decideAll } from "./ai";
import { FIELD, PHYSICS } from "./config";
import { createMatchState, stepMatch } from "./index";
import { executeBallAction } from "./systems/ball-system";
import type { GameProfile } from "../roster/model";
import { distance, length } from "../shared/math";

const createTestMatch = (profile: GameProfile = createDefaultProfile(), seed?: number) => createMatchState(buildMatchConfig(profile, seed));

describe("ações e física da bola", () => {
  it("expõe as oito combinações de passe", () => {
    expect(PASS_VARIANTS).toHaveLength(8);
    expect(new Set(PASS_VARIANTS.map((variant) => `${variant.trajectory}-${variant.range}-${variant.targeting}`)).size).toBe(8);
  });

  it("dimensiona a força do toque e a duração do pique pela distância pretendida", () => {
    const performKnockOn = (targetDistance: number) => {
      const state = createTestMatch(createDefaultProfile(), 812);
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

  it("limita o reposicionamento da bola em uma mudanca de 180 graus", () => {
    const state = createTestMatch(createDefaultProfile(), 1245296397);
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
    stepMatch(state, 1 / 120);
    const repositionDistance = distance(initialBallPosition, state.ball.position);

    expect(state.ball.controllerId ?? state.ball.dribbleOwnerId).toBe(holder.profile.id);
    const maximumContinuousTravel = (PHYSICS.controlledBallRepositionSpeed + PHYSICS.maxBallSpeed) / 120;
    expect(repositionDistance).toBeLessThanOrEqual(maximumContinuousTravel + 0.02);
  });

  it("prefere o rasteiro sob pressão moderada e rejeita o aéreo sem vantagem", () => {
    const state = createTestMatch(createDefaultProfile(), 404);
    state.kickoffTimer = 0;
    const passer = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    const receiver = state.players.find((player) => player.team === passer.team && player.profile.position === "forward")!;
    passer.position = { x: 38, y: 30 };
    receiver.position = { x: 59, y: 30 };
    receiver.velocity = { x: 2, y: 0 };
    const opponents = state.players.filter((player) => player.team !== passer.team);
    opponents.forEach((opponent, index) => {
      opponent.position = index === 0 ? { x: 49, y: 34 } : { x: 88 + index * 2, y: 8 + index * 12 };
      opponent.velocity = { x: 0, y: 0 };
    });

    const option = choosePass(passer, [passer, receiver], opponents, state);

    expect(option?.action.trajectory).toBe("ground");
  });

  it("usa o aéreo quando o corredor rasteiro está bloqueado e a queda está livre", () => {
    const state = createTestMatch(createDefaultProfile(), 405);
    state.kickoffTimer = 0;
    const passer = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    const receiver = state.players.find((player) => player.team === passer.team && player.profile.position === "forward")!;
    passer.position = { x: 32, y: 30 };
    receiver.position = { x: 72, y: 30 };
    receiver.velocity = { x: 1, y: 0 };
    const opponents = state.players.filter((player) => player.team !== passer.team);
    opponents.forEach((opponent, index) => {
      opponent.position = index < 2 ? { x: 43 + index * 8, y: 30 } : { x: 88, y: 8 + index * 12 };
      opponent.velocity = { x: 0, y: 0 };
    });

    const option = choosePass(passer, [passer, receiver], opponents, state);

    expect(option?.action.trajectory).toBe("air");
  });

  it("mantem a bola dominada ao conduzir e mudar de direcao", () => {
    const state = createTestMatch(createDefaultProfile(), 8801);
    state.kickoffTimer = 0;
    state.elapsed = 10;
    const holder = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    holder.position = { x: FIELD.width * 0.4, y: FIELD.height / 2 };
    holder.facing = { x: 1, y: 0 };
    state.ball.position = { x: holder.position.x + holder.radius + state.ball.radius + 0.15, y: holder.position.y };
    state.ball.controllerId = holder.profile.id;
    state.ball.controlStartedAt = state.elapsed - 1;

    executeBallAction(state, holder, {
      kind: "dribble",
      style: "carry",
      target: { x: holder.position.x, y: holder.position.y - FIELD.height * 0.25 },
    });

    expect(state.ball.controllerId).toBe(holder.profile.id);
    expect(state.ball.dribbleOwnerId).toBeNull();
    expect(length(state.ball.velocity)).toBe(0);
  });

  it("faz a bola aerea quicar e perder energia ao aterrissar", () => {
    const state = createTestMatch(createDefaultProfile(), 73);
    state.kickoffTimer = 0;
    state.ball.controllerId = null;
    state.ball.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    state.ball.velocity = { x: 20, y: 0 };
    state.ball.height = 0.05;
    state.ball.verticalVelocity = -8;
    state.players.forEach((player) => { player.kickCooldown = 10; });

    stepMatch(state, 1 / 60);

    expect(state.ball.height).toBe(0);
    expect(state.ball.verticalVelocity).toBeCloseTo((8 + PHYSICS.gravity / 60) * PHYSICS.ballBounce, 5);
    expect(state.ball.velocity.x).toBeGreaterThan(0);
    expect(state.ball.velocity.x).toBeLessThan(20 * PHYSICS.landingFriction);
  });

  it("faz uma finalizacao viajar claramente mais rapido que um passe longo", () => {
    const shotState = createTestMatch(createDefaultProfile(), 515);
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

    const passState = createTestMatch(createDefaultProfile(), 515);
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

  it("faz a finta vencedora passar pelo defensor sem permitir resposta imediata", () => {
    const state = createTestMatch(createDefaultProfile(), 2026);
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
      stepMatch(state, 1 / 120);
      expect(state.ball.controllerId).not.toBe(defender.profile.id);
    }
    expect(state.stats.coral.feintsAttempted).toBe(0);
    expect(distance(attacker.position, defender.position)).toBeGreaterThan(initialSeparation + 1.5);
  });

  it("nao permite finta antes de o jogador estabilizar a posse", () => {
    const state = createTestMatch(createDefaultProfile(), 77);
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

});
