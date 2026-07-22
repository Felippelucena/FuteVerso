import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { FIELD, FIXED_STEP, MATCH_DURATION } from "./config";
import { createMatchState, stepMatch } from "./index";
import { executeBallAction } from "./systems/ball-system";

const createState = (seed = 123) => createMatchState(buildMatchConfig(createDefaultProfile(), seed));

describe("eventos estruturados do motor", () => {
  it("inicia e encerra a partida com eventos tipados", () => {
    const state = createState();
    expect(state.events[0]).toEqual({ id: 1, time: 0, type: "match-started" });

    state.elapsed = MATCH_DURATION - FIXED_STEP;
    state.kickoffTimer = 1;
    stepMatch(state, FIXED_STEP);

    expect(state.events[0]).toMatchObject({ type: "match-finished", time: MATCH_DURATION });
  });

  it("registra finalização com time e jogador", () => {
    const state = createState();
    const player = state.players.find((candidate) => candidate.profile.id === "nilo-fw")!;
    state.kickoffTimer = 0;
    state.ball.controllerId = player.profile.id;
    state.ball.position = { ...player.position };

    executeBallAction(state, player, { kind: "shot", target: { x: FIELD.width, y: FIELD.height / 2 }, power: 1 });

    expect(state.events[0]).toMatchObject({ type: "shot-taken", team: "blue", playerId: "nilo-fw" });
  });

  it("registra defesa do goleiro", () => {
    const state = createState();
    const goalkeeper = state.players.find((candidate) => candidate.profile.id === "nilo-gk")!;
    state.kickoffTimer = 0;
    state.ball.controllerId = null;
    state.ball.position = { ...goalkeeper.position };
    state.ball.velocity = { x: 0, y: 0 };
    state.ball.lastAction = "shot";
    state.ball.lastTouch = "coral";
    state.ball.lastTouchPlayerId = "maya-fw";

    stepMatch(state, FIXED_STEP);

    expect(state.events[0]).toMatchObject({ type: "save-made", team: "blue", playerId: "nilo-gk" });
  });

  it("registra gol com autor e origem", () => {
    const state = createState();
    state.kickoffTimer = 0;
    state.ball.controllerId = null;
    state.ball.position = { x: FIELD.width + FIELD.ballRadius + 0.1, y: FIELD.height / 2 };
    state.ball.velocity = { x: 0, y: 0 };
    state.ball.lastAction = "shot";
    state.ball.lastTouch = "blue";
    state.ball.lastTouchPlayerId = "nilo-fw";

    stepMatch(state, FIXED_STEP);

    expect(state.events[0]).toMatchObject({ type: "goal-scored", team: "blue", playerId: "nilo-fw", origin: "shot" });
  });
});
