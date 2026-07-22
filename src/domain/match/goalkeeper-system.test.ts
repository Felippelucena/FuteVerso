import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { FIELD } from "./config";
import type { GoalkeeperAction, MatchState, PlayerRuntime } from "./model";
import { createMatchState } from "./state";
import { updateBall } from "./systems/ball-system";
import { updateGoalkeeperAnticipation } from "./systems/goalkeeper-system";

const createState = (seed = 55) => {
  const state = createMatchState(buildMatchConfig(createDefaultProfile(), seed));
  state.kickoffTimer = 0;
  state.events = [];
  return state;
};

const goalkeeper = (state: MatchState) => state.players.find((player) => player.team === "blue" && player.profile.position === "goalkeeper")!;

const prepareContact = (
  state: MatchState,
  keeper: PlayerRuntime,
  action: GoalkeeperAction,
  speed: number,
  height: number,
  yOffset = 0,
  source: "shot" | "cross" = "shot",
) => {
  keeper.position = { x: 10, y: FIELD.height / 2 };
  keeper.profile.skills.goalkeeping = 100;
  keeper.profile.skills.control = 100;
  keeper.profile.mental.anticipation = 100;
  keeper.profile.mental.decisionMaking = 100;
  keeper.profile.mental.composure = 100;
  keeper.goalkeeperAttempt = {
    source, sourceId: 1, action, startedAt: 0, reactionReadyAt: 0, contactAt: 0.08, expiresAt: 0.3,
    origin: { ...keeper.position }, target: { ...keeper.position, y: keeper.position.y + yOffset }, targetHeight: height,
    expectedSpeed: speed, requiredReach: Math.abs(yOffset), availableReach: 12,
    outcome: null, contactQuality: null, resolvedAt: null,
  };
  state.activeShot = source === "shot" ? {
    id: 1, shooterId: "maya-fw", team: "coral", startedAt: 0, technique: "power",
    target: { x: 0, y: keeper.position.y + yOffset }, targetHeight: height,
    expectedArrivalAt: 0.2, expectedSpeed: speed,
    goalPoint: { position: { x: 0, y: keeper.position.y + yOffset }, height }, onTarget: true, goalkeeperTouched: false,
  } : null;
  state.ball.position = { x: 14, y: keeper.position.y + yOffset };
  state.ball.velocity = { x: -speed, y: 0 };
  state.ball.height = height;
  state.ball.verticalVelocity = 0;
  state.ball.controllerId = null;
  state.ball.lastAction = source === "shot" ? "shot" : "pass";
  state.ball.lastTouch = "coral";
  state.ball.lastTouchPlayerId = "maya-fw";
  state.elapsed = 0.08;
};

describe("defesas fisicas do goleiro", () => {
  it("encaixa uma bola alta central fisicamente alcancavel", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    prepareContact(state, keeper, "verticalJump", 42, 3.7);

    updateBall(state, 0.08);

    expect(state.ball.controllerId).toBe(keeper.profile.id);
    expect(keeper.goalkeeperAttempt?.outcome).toBe("catch");
    expect(state.stats.blue.catches).toBe(1);
    expect(state.stats.blue.saves).toBe(1);
    expect(state.events.at(-1)).toMatchObject({ type: "save-made", outcome: "catch", shotId: 1 });
  });

  it("rebate um chute forte e desperta a disputa da segunda bola", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    prepareContact(state, keeper, "standingSave", 108, 1.4);

    updateBall(state, 0.05);

    expect(keeper.goalkeeperAttempt?.outcome).toBe("parry");
    expect(state.ball.controllerId).toBeNull();
    expect(state.stats.blue.parries).toBe(1);
    expect(state.cognitiveEvents.some((event) => event.type === "ballTrajectoryChanged" && event.shotId === 1)).toBe(true);
  });

  it("encaixa um cruzamento alto e resolve o passe como interceptado", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    prepareContact(state, keeper, "aerialClaim", 38, 2.1, 0, "cross");
    state.pendingPass = {
      id: 1, passerId: "maya-fw", receiverId: "maya-mf", team: "coral", startedAt: 0,
      trajectory: "air", range: "long", targeting: "space", purpose: "cross", selectionReason: "progressivePass",
      target: { ...state.ball.position }, landingPoint: { ...state.ball.position }, expectedArrivalAt: 0.2,
      receiverEta: 0.3, opponentEta: 0.2, expectedHeight: 2.1, expectedSpeed: 38,
    };

    updateBall(state, 0.08);

    expect(state.ball.controllerId).toBe(keeper.profile.id);
    expect(state.pendingPass).toBeNull();
    expect(state.stats.blue.highBallClaims).toBe(1);
    expect(state.stats.blue.saves).toBe(0);
  });

  it("soca um cruzamento disputado sem adquirir posse", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    prepareContact(state, keeper, "punch", 76, 2.7, 0, "cross");
    state.pendingPass = {
      id: 1, passerId: "maya-fw", receiverId: "maya-mf", team: "coral", startedAt: 0,
      trajectory: "air", range: "long", targeting: "space", purpose: "cross", selectionReason: "progressivePass",
      target: { ...state.ball.position }, landingPoint: { ...state.ball.position }, expectedArrivalAt: 0.2,
      receiverEta: 0.3, opponentEta: 0.2, expectedHeight: 2.7, expectedSpeed: 76,
    };

    updateBall(state, 0.08);

    expect(state.ball.controllerId).toBeNull();
    expect(keeper.goalkeeperAttempt?.outcome).toBe("parry");
    expect(state.stats.blue.punches).toBe(1);
    expect(state.cognitiveEvents.some((event) => event.type === "ballTrajectoryChanged" && event.passId === 1)).toBe(true);
  });

  it("produz raspao na borda sem transformar o contato em defesa", () => {
    const state = createState(9);
    const keeper = goalkeeper(state);
    prepareContact(state, keeper, "highDive", 108, 3.25, 3.15);
    keeper.profile.skills.goalkeeping = 1;
    keeper.profile.skills.control = 1;
    keeper.profile.mental.anticipation = 1;
    keeper.profile.mental.decisionMaking = 1;
    keeper.profile.mental.composure = 1;

    updateBall(state, 0.05);

    expect(keeper.goalkeeperAttempt?.outcome).toBe("glance");
    expect(state.stats.blue.glancingTouches).toBe(1);
    expect(state.stats.blue.saves).toBe(0);
    expect(state.activeShot?.goalkeeperTouched).toBe(true);
  });

  it("nao toca uma bola acima do alcance nem usa as maos fora da area", () => {
    const high = createState();
    const highKeeper = goalkeeper(high);
    prepareContact(high, highKeeper, "verticalJump", 55, FIELD.goalHeight + 0.4);
    updateBall(high, 0.05);
    expect(highKeeper.goalkeeperAttempt?.outcome).toBeNull();
    expect(high.stats.blue.saves).toBe(0);

    const outside = createState();
    const outsideKeeper = goalkeeper(outside);
    prepareContact(outside, outsideKeeper, "standingSave", 55, 1.2);
    outsideKeeper.position.x = FIELD.penaltyDepth + 8;
    outsideKeeper.goalkeeperAttempt!.origin = { ...outsideKeeper.position };
    outside.ball.position.x = outsideKeeper.position.x + 4;
    updateBall(outside, 0.05);
    expect(outside.stats.blue.saves).toBe(0);
  });

  it("nao inicia uma segunda tentativa enquanto se recupera", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    prepareContact(state, keeper, "standingSave", 60, 1.2);
    keeper.goalkeeperAttempt!.outcome = "parry";
    keeper.goalkeeperAttempt!.resolvedAt = state.elapsed;
    keeper.goalkeeperRecoveryUntil = state.elapsed + 0.8;
    const original = keeper.goalkeeperAttempt;

    updateGoalkeeperAnticipation(state);

    expect(keeper.goalkeeperAttempt).toBe(original);
  });
});
