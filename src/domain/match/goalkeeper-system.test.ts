import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { FIELD, FIXED_STEP, GOALKEEPING } from "./config";
import { stepMatch } from "./engine";
import type { GoalkeeperAttempt, MatchState, PlayerRuntime, Vec2 } from "./model";
import { createMatchState } from "./state";
import { updateBall } from "./systems/ball-system";
import { goalkeeperReachRadius, updateGoalkeeperAnticipation } from "./systems/goalkeeper-system";

const createState = (seed = 55) => {
  const state = createMatchState(buildMatchConfig(createDefaultProfile(), seed));
  state.kickoffTimer = 0;
  state.events = [];
  return state;
};

const goalkeeper = (state: MatchState) => state.players.find((player) => player.team === "blue" && player.profile.position === "goalkeeper")!;

const makeElite = (keeper: PlayerRuntime) => {
  keeper.profile.skills.goalkeeping = 100;
  keeper.profile.skills.control = 100;
  keeper.profile.mental.anticipation = 100;
  keeper.profile.mental.decisionMaking = 100;
  keeper.profile.mental.composure = 100;
};

/** Puts the keeper in flight with the ball already inside his reach, ready to collide. */
const armLaunchedAttempt = (
  state: MatchState,
  keeper: PlayerRuntime,
  speed: number,
  height: number,
  options: { yOffset?: number; source?: "shot" | "cross"; vertical?: number; desperate?: boolean } = {},
) => {
  const { yOffset = 0, source = "shot", vertical = 0, desperate = false } = options;
  keeper.position = { x: 10, y: FIELD.height / 2 };
  const direction: Vec2 = yOffset === 0 ? { x: 1, y: 0 } : { x: 0, y: Math.sign(yOffset) };
  const attempt: GoalkeeperAttempt = {
    source, sourceId: 1, action: source === "cross" ? "aerialClaim" : vertical > 0 ? "verticalJump" : "lowDive",
    startedAt: 0, reactionReadyAt: 0, expiresAt: 3,
    origin: { ...keeper.position }, approachTarget: { ...keeper.position },
    launchedAt: 0, launchDirection: direction, launchSpeed: 0, launchVertical: vertical,
    flightTime: vertical > 0 ? 2 * vertical / GOALKEEPING.jumpGravity : GOALKEEPING.groundedDiveTime,
    reachRadius: goalkeeperReachRadius(keeper), desperate,
    outcome: null, contactQuality: null, resolvedAt: null,
  };
  keeper.goalkeeperAttempt = attempt;
  keeper.velocity = { x: 0, y: 0 };
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
  return attempt;
};

/** Fires a shot at the blue goal from `range`, leaving the real engine to drive the keeper. */
const fireShotAtGoal = (state: MatchState, aimY: number, speed: number, height: number, range = 34) => {
  const keeper = goalkeeper(state);
  keeper.position = { x: 8, y: FIELD.height / 2 };
  keeper.velocity = { x: 0, y: 0 };
  state.ball.position = { x: range, y: FIELD.height / 2 };
  state.ball.height = height;
  state.ball.verticalVelocity = 0;
  state.ball.controllerId = null;
  state.ball.lastAction = "shot";
  state.ball.lastShotOnTarget = true;
  state.ball.lastTouch = "coral";
  state.ball.lastTouchPlayerId = "maya-fw";
  const flight = (range - 2) / speed;
  state.ball.velocity = { x: -speed, y: (aimY - FIELD.height / 2) / flight };
  state.activeShot = {
    id: 1, shooterId: "maya-fw", team: "coral", startedAt: state.elapsed, technique: "power",
    target: { x: 0, y: aimY }, targetHeight: height,
    expectedArrivalAt: state.elapsed + flight, expectedSpeed: speed,
    goalPoint: { position: { x: 0, y: aimY }, height }, onTarget: true, goalkeeperTouched: false,
  };
  return keeper;
};

interface SaveTrace {
  groundedFrames: number;
  groundedTravel: number;
  launchDirection: Vec2 | null;
  launchedAtFrame: number | null;
  desperate: boolean;
  outcome: string | null;
}

/** Runs the real engine and records how the keeper's save unfolded. */
const traceSave = (state: MatchState, keeper: PlayerRuntime, frames: number, onFrame?: (frame: number) => void): SaveTrace => {
  const trace: SaveTrace = {
    groundedFrames: 0, groundedTravel: 0, launchDirection: null,
    launchedAtFrame: null, desperate: false, outcome: null,
  };
  let previousY = keeper.position.y;
  for (let frame = 0; frame < frames; frame += 1) {
    onFrame?.(frame);
    stepMatch(state, FIXED_STEP);
    const attempt = keeper.goalkeeperAttempt;
    if (!attempt) continue;
    if (attempt.launchedAt === null) {
      trace.groundedFrames += 1;
      trace.groundedTravel += Math.abs(keeper.position.y - previousY);
    } else if (trace.launchedAtFrame === null) {
      trace.launchedAtFrame = frame;
      trace.launchDirection = attempt.launchDirection ? { ...attempt.launchDirection } : null;
      trace.desperate = attempt.desperate;
    }
    if (attempt.outcome) trace.outcome = attempt.outcome;
    previousY = keeper.position.y;
  }
  return trace;
};

describe("alcance fisico do goleiro", () => {
  it("alcanca apenas o proprio corpo mais um raio de braco", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    expect(goalkeeperReachRadius(keeper)).toBeCloseTo(keeper.radius * 2, 5);
    // Um goleiro parado no meio nao pode cobrir o gol inteiro so com alcance.
    expect(goalkeeperReachRadius(keeper)).toBeLessThan((FIELD.goalBottom - FIELD.goalTop) / 4);
  });
});

describe("decisao de saltar", () => {
  it("nao salta antes de terminar o tempo de reacao", () => {
    const state = createState();
    const keeper = fireShotAtGoal(state, FIELD.height / 2 + 8, 60, 1.2);
    makeElite(keeper);

    updateGoalkeeperAnticipation(state, FIXED_STEP);

    expect(keeper.goalkeeperAttempt).not.toBeNull();
    expect(keeper.goalkeeperAttempt?.launchedAt).toBeNull();
  });

  it("ajusta a posicao no chao antes de se comprometer com o salto", () => {
    const state = createState();
    // Chute lento e de longe: sobra tempo para a corridinha antes do salto.
    const keeper = fireShotAtGoal(state, FIELD.height / 2 + 9, 40, 1.1, 52);
    makeElite(keeper);

    const trace = traceSave(state, keeper, 240);

    expect(trace.groundedFrames).toBeGreaterThan(10);
    expect(trace.groundedTravel).toBeGreaterThan(0.5);
    expect(trace.launchedAtFrame).not.toBeNull();
    expect(trace.launchedAtFrame!).toBeGreaterThan(trace.groundedFrames - 1);
  });

  it("congela a direcao no salto e nao a corrige depois", () => {
    const state = createState();
    const keeper = fireShotAtGoal(state, FIELD.height / 2 + 10, 58, 1.3);
    makeElite(keeper);

    // Depois que ele decolar, a bola inverte a rota. O corpo nao acompanha.
    let flipped = false;
    const trace = traceSave(state, keeper, 240, () => {
      const attempt = keeper.goalkeeperAttempt;
      if (!flipped && attempt?.launchedAt !== null && attempt?.launchDirection) {
        state.ball.velocity = { x: state.ball.velocity.x, y: -state.ball.velocity.y };
        flipped = true;
      }
    });

    expect(trace.launchDirection).not.toBeNull();
    expect(flipped).toBe(true);
    const finalDirection = keeper.goalkeeperAttempt?.launchDirection;
    if (finalDirection) expect(finalDirection).toEqual(trace.launchDirection);
  });

  it("mergulha em desespero e nao alcanca um chute impossivel", () => {
    const state = createState();
    // Chute rasteiro no canto, disparado de perto: nao ha tempo de corpo para chegar la.
    const keeper = fireShotAtGoal(state, FIELD.goalTop + 1.5, 104, 0.4, 20);
    makeElite(keeper);

    const trace = traceSave(state, keeper, 120);

    expect(trace.launchedAtFrame).not.toBeNull();
    expect(trace.outcome).not.toBe("catch");
    expect(state.stats.blue.saves).toBe(0);
  });
});

describe("resolucao do contato", () => {
  it("encaixa uma bola central dentro do alcance", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    armLaunchedAttempt(state, keeper, 42, 1.4);

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
    makeElite(keeper);
    armLaunchedAttempt(state, keeper, 108, 1.4);

    updateBall(state, 0.05);

    expect(keeper.goalkeeperAttempt?.outcome).toBe("parry");
    expect(state.ball.controllerId).toBeNull();
    expect(state.stats.blue.parries).toBe(1);
    expect(state.cognitiveEvents.some((event) => event.type === "ballTrajectoryChanged" && event.shotId === 1)).toBe(true);
  });

  it("encaixa um cruzamento alto e resolve o passe como interceptado", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    armLaunchedAttempt(state, keeper, 38, 2.1, { source: "cross" });
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
    makeElite(keeper);
    const attempt = armLaunchedAttempt(state, keeper, 76, 2.7, { source: "cross" });
    attempt.action = "punch";
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

  it("produz raspao na borda do alcance sem virar defesa", () => {
    const state = createState(9);
    const keeper = goalkeeper(state);
    keeper.profile.skills.goalkeeping = 1;
    keeper.profile.skills.control = 1;
    keeper.profile.mental.anticipation = 1;
    keeper.profile.mental.decisionMaking = 1;
    keeper.profile.mental.composure = 1;
    const keeperReach = goalkeeperReachRadius(keeper);
    armLaunchedAttempt(state, keeper, 108, 1.2, { yOffset: keeperReach * 0.94 });

    updateBall(state, 0.05);

    expect(keeper.goalkeeperAttempt?.outcome).toBe("glance");
    expect(state.stats.blue.glancingTouches).toBe(1);
    expect(state.stats.blue.saves).toBe(0);
    expect(state.activeShot?.goalkeeperTouched).toBe(true);
  });

  it("nao toca a bola fora do alcance do corpo", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    armLaunchedAttempt(state, keeper, 55, 1.2, { yOffset: goalkeeperReachRadius(keeper) + 2.5 });

    updateBall(state, 0.05);

    expect(keeper.goalkeeperAttempt?.outcome).toBeNull();
    expect(state.stats.blue.saves).toBe(0);
  });

  it("nao alcanca uma bola acima do salto nem usa as maos fora da area", () => {
    const high = createState();
    const highKeeper = goalkeeper(high);
    makeElite(highKeeper);
    // Sem impulso vertical, o alcance para no standingReach.
    armLaunchedAttempt(high, highKeeper, 55, GOALKEEPING.standingReach + 1.4);
    updateBall(high, 0.05);
    expect(highKeeper.goalkeeperAttempt?.outcome).toBeNull();
    expect(high.stats.blue.saves).toBe(0);

    const outside = createState();
    const outsideKeeper = goalkeeper(outside);
    makeElite(outsideKeeper);
    armLaunchedAttempt(outside, outsideKeeper, 55, 1.2);
    outsideKeeper.position.x = FIELD.penaltyDepth + 8;
    outside.ball.position.x = outsideKeeper.position.x + 4;
    updateBall(outside, 0.05);
    expect(outside.stats.blue.saves).toBe(0);
  });

  it("alcanca a bola alta quando o salto foi carregado com impulso vertical", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    const vertical = 4.2;
    const apex = vertical * vertical / (2 * GOALKEEPING.jumpGravity);
    const height = GOALKEEPING.standingReach + apex * 0.8;
    armLaunchedAttempt(state, keeper, 44, height, { vertical });
    // No apice do salto o corpo ja subiu o suficiente para cobrir essa altura.
    state.elapsed = vertical / GOALKEEPING.jumpGravity;

    updateBall(state, 0.05);

    expect(keeper.goalkeeperAttempt?.outcome).not.toBeNull();
    expect(keeper.goalkeeperAttempt?.outcome).not.toBe("miss");
  });
});

describe("ciclo de vida da tentativa", () => {
  it("nao inicia uma segunda tentativa enquanto se recupera", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    armLaunchedAttempt(state, keeper, 60, 1.2);
    keeper.goalkeeperAttempt!.outcome = "parry";
    keeper.goalkeeperAttempt!.resolvedAt = state.elapsed;
    keeper.goalkeeperRecoveryUntil = state.elapsed + 0.8;
    const original = keeper.goalkeeperAttempt;

    updateGoalkeeperAnticipation(state);

    expect(keeper.goalkeeperAttempt).toBe(original);
  });
});
