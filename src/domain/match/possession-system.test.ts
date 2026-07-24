import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { decideAll } from "./ai";
import { FIELD, PHYSICS } from "./config";
import { createMatchState, stepMatch } from "./index";

const createTestMatch = (seed?: number) => createMatchState(referenceMatchConfig(seed));

describe("posse e domínio", () => {
  it("usa defesa e controle para decidir uma bola dividida", () => {
    const state = createTestMatch();
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
    stepMatch(state, 1 / 120);
    expect(state.ball.controllerId ?? state.ball.dribbleOwnerId).toBe(coral.profile.id);
  });

  it("encerra contato prolongado com uma tentativa real de desarme", () => {
    const state = createTestMatch(42);
    state.kickoffTimer = 0;
    const holder = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
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

    stepMatch(state, 1 / 120);

    expect(state.ball.controllerId).not.toBe(holder.profile.id);
    expect(state.stats.coral.tacklesAttempted).toBe(1);
    expect(state.stats.coral.tacklesWon).toBe(1);
  });

  it("deixa uma bola forte escapar de um jogador sem controle para domina-la", () => {
    const state = createTestMatch(812);
    state.kickoffTimer = 0;
    const receiver = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
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

    stepMatch(state, 1 / 120);

    expect(state.ball.controllerId).not.toBe(receiver.profile.id);
    expect(receiver.controlCooldown).toBeGreaterThan(0);
  });

  it("transforma um passe dificil em toque pesado em vez de controle magnetico", () => {
    const state = createTestMatch(42);
    state.kickoffTimer = 0;
    const receiver = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
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
      targeting: "feet",
      selectionReason: "progressivePass",
      target: { ...state.ball.position },
      landingPoint: { ...state.ball.position },
      expectedArrivalAt: state.elapsed + 0.4,
      receiverEta: 0.4,
      opponentEta: 0.8,
    };

    stepMatch(state, 1 / 120);

    expect(state.ball.controllerId).toBeNull();
    expect(state.ball.lastTouchPlayerId).toBe(receiver.profile.id);
    expect(state.ball.velocity.x).toBeGreaterThan(0);
    expect(state.ball.velocity.x).toBeLessThan(40);
    expect(receiver.controlCooldown).toBeGreaterThan(PHYSICS.controlAttemptCooldown);
  });

  it("antecipa o corte quando um defensor se aproxima em velocidade", () => {
    const state = createTestMatch(78);
    state.kickoffTimer = 0;
    state.elapsed = 12;
    const attacker = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
    const defender = state.players.find((player) => player.team === "coral" && player.profile.position === "centerBack")!;
    attacker.position = { x: FIELD.width * 0.4, y: FIELD.height / 2 };
    attacker.velocity = { x: 1, y: 0 };
    attacker.facing = { x: 1, y: 0 };
    attacker.profile.skills.control = 100;
    attacker.profile.skills.burst = 100;
    attacker.memory.policy.dribble = 0.9;
    attacker.memory.policy.pass = 0.28;
    attacker.memory.policy.shoot = 0.28;
    defender.position = { x: attacker.position.x + 5, y: attacker.position.y };
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
    const state = createTestMatch(144);
    state.kickoffTimer = 0;
    state.elapsed = 10;
    const blue = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
    const coral = state.players.find((player) => player.team === "coral" && player.profile.position === "centerMid")!;
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

    for (let tick = 0; tick < 24; tick += 1) stepMatch(state, 1 / 120);

    expect(state.stats.blue.feintsAttempted + state.stats.coral.feintsAttempted).toBe(0);
  });

});
