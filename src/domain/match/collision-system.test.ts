import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { FIELD, PHYSICS } from "./config";
import { createMatchState, stepMatch } from "./index";
import type { GameProfile } from "../roster/model";

const createTestMatch = (profile: GameProfile = createDefaultProfile(), seed?: number) => createMatchState(buildMatchConfig(profile, seed));

describe("colisões", () => {
  it("reflete a bola que encontra um jogador de frente", () => {
    const state = createTestMatch(createDefaultProfile(), 91);
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

    stepMatch(state, 1 / 60);

    expect(state.ball.velocity.x).toBeGreaterThan(target.velocity.x);
    expect(state.ball.lastTouchPlayerId).toBe(target.profile.id);
    expect(state.ball.position.x).toBeGreaterThan(target.position.x);
  });

  it("nao usa todo o raio visual do jogador como uma parede", () => {
    const state = createTestMatch(createDefaultProfile(), 913);
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

    stepMatch(state, 1 / 120);

    expect(state.ball.lastTouchPlayerId).toBeNull();
  });

});
