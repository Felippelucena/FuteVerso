import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { decideAll } from "./ai";
import { FIELD, PHYSICS } from "./config";
import { createMatchState, stepMatch } from "./index";
import { playerSpeedLimit } from "./systems/movement-system";
import type { GameProfile } from "../roster/model";

const createTestMatch = (profile: GameProfile = createDefaultProfile(), seed?: number) => createMatchState(buildMatchConfig(profile, seed));

describe("movimento dos jogadores", () => {
  it("diferencia condução, pique com bola e explosão sem a bola", () => {
    const player = createTestMatch(createDefaultProfile()).players[3];
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

  it("faz o defensor sustentar a explosão numa disputa por um toque longo", () => {
    const state = createTestMatch(createDefaultProfile(), 913);
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
    stepMatch(state, 1 / 120);
    expect(defender.sprintTimer).toBeGreaterThan(PHYSICS.burstDuration);
    expect(defender.pace).toBe("burst");
  });

  it("evita tirar o goleiro do gol para pressionar longe da area", () => {
    const state = createTestMatch(createDefaultProfile());
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

});
