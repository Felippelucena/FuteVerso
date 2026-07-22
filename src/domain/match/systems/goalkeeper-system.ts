import { FIELD, GOALKEEPING } from "../config";
import { add, clamp, distance, dot, length, normalize, scale, subtract } from "../../shared/math";
import type { AgentDecision, GoalkeeperAction, GoalkeeperAttempt, MatchState, PlayerRuntime, SaveOutcome, Vec2 } from "../model";
import { clearDribbleOwner, registerControlledTeam, registerLooseBall } from "../runtime/control";
import { emitCognitiveEvent, relevantPlayersNear } from "../runtime/cognitive-events";
import { emitMatchEvent } from "../runtime/events";
import { playerSkillSpeed } from "../runtime/player-metrics";
import { signedMatchNoise } from "../runtime/random";
import { predictShotPoint, timeToX } from "../runtime/shot-trajectory";

const ownsPenaltyArea = (goalkeeper: PlayerRuntime, point: Vec2): boolean => {
  const insideDepth = goalkeeper.team === "blue" ? point.x <= FIELD.penaltyDepth : point.x >= FIELD.width - FIELD.penaltyDepth;
  const top = (FIELD.height - FIELD.penaltyWidth) / 2;
  return insideDepth && point.y >= top && point.y <= top + FIELD.penaltyWidth;
};

const goalkeeperQuality = (goalkeeper: PlayerRuntime): number => (
  goalkeeper.profile.skills.goalkeeping * 0.55
  + goalkeeper.profile.mental.anticipation * 0.17
  + goalkeeper.profile.mental.decisionMaking * 0.13
  + goalkeeper.profile.mental.composure * 0.1
  + goalkeeper.profile.skills.control * 0.05
) / 100;

const reactionDelay = (goalkeeper: PlayerRuntime): number => {
  const quality = clamp((goalkeeper.profile.skills.goalkeeping * 0.45
    + goalkeeper.profile.mental.anticipation * 0.35
    + goalkeeper.profile.mental.decisionMaking * 0.2) / 100, 0, 1);
  return GOALKEEPING.maximumReaction + (GOALKEEPING.minimumReaction - GOALKEEPING.maximumReaction) * quality;
};

const chooseAction = (height: number, lateralReach: number, source: "shot" | "cross", punch: boolean): GoalkeeperAction => {
  if (source === "cross") return punch ? "punch" : "aerialClaim";
  if (height > 2.55 && lateralReach < 3.4) return "verticalJump";
  if (height > 1.55) return "highDive";
  if (lateralReach > 2.8) return "lowDive";
  return "standingSave";
};

const preparedHandFactor = (action: GoalkeeperAction, preparation: number): number => (
  action === "standingSave" ? 0.8 : clamp(0.15 + clamp(preparation, 0, 1) * 2, 0.15, 1.1)
);

const createAttempt = (
  state: MatchState,
  goalkeeper: PlayerRuntime,
  source: "shot" | "cross",
  sourceId: number,
  target: Vec2,
  targetHeight: number,
  arrivalIn: number,
  expectedSpeed: number,
  punch = false,
): GoalkeeperAttempt => {
  const reaction = reactionDelay(goalkeeper);
  const requiredReach = distance(goalkeeper.position, target);
  const movementTime = Math.max(0, arrivalIn - reaction);
  const action = chooseAction(targetHeight, Math.abs(target.y - goalkeeper.position.y), source, punch);
  const preparation = clamp(movementTime / 0.75, 0, 1);
  const preparedHandReach = GOALKEEPING.handReach * preparedHandFactor(action, preparation);
  const availableReach = goalkeeper.radius * 0.72 + preparedHandReach
    + playerSkillSpeed(goalkeeper) * GOALKEEPING.diveSpeedFactor * movementTime * 0.58;
  return {
    source,
    sourceId,
    action,
    startedAt: state.elapsed,
    reactionReadyAt: state.elapsed + reaction,
    contactAt: state.elapsed + arrivalIn,
    expiresAt: state.elapsed + Math.min(GOALKEEPING.maximumAttemptAge, Math.max(arrivalIn + 0.28, 0.5)),
    origin: { ...goalkeeper.position },
    target: { ...target },
    targetHeight,
    expectedSpeed,
    requiredReach,
    availableReach,
    outcome: null,
    contactQuality: null,
    resolvedAt: null,
  };
};

const shotAttempt = (state: MatchState, goalkeeper: PlayerRuntime): GoalkeeperAttempt | null => {
  const shot = state.activeShot;
  if (!shot || shot.team === goalkeeper.team || !shot.onTarget) return null;
  const goalTime = Math.max(0.02, shot.expectedArrivalAt - state.elapsed);
  // Intercept on the keeper's current depth: the dive should cover the shot line,
  // not first drag the keeper backwards to an arbitrary plane near the goal.
  const areaMargin = goalkeeper.radius * 0.7;
  const planeX = goalkeeper.team === "blue"
    ? clamp(goalkeeper.position.x, FIELD.goalAreaDepth * 0.55, FIELD.penaltyDepth - areaMargin)
    : clamp(goalkeeper.position.x, FIELD.width - FIELD.penaltyDepth + areaMargin, FIELD.width - FIELD.goalAreaDepth * 0.55);
  const planeTime = timeToX(state.ball.position.x, state.ball.velocity.x, planeX);
  const arrivalIn = clamp(planeTime ?? goalTime, 0.02, goalTime);
  const predicted = predictShotPoint(
    state.ball.position,
    state.ball.velocity,
    state.ball.height,
    state.ball.verticalVelocity,
    arrivalIn,
  );
  return createAttempt(state, goalkeeper, "shot", shot.id, predicted.position, predicted.height, arrivalIn, predicted.speed);
};

const crossAttempt = (state: MatchState, goalkeeper: PlayerRuntime): GoalkeeperAttempt | null => {
  const pass = state.pendingPass;
  if (!pass?.id || pass.team === goalkeeper.team || pass.purpose !== "cross" || pass.trajectory !== "air") return null;
  if (!ownsPenaltyArea(goalkeeper, pass.landingPoint)) return null;
  const remaining = pass.expectedArrivalAt - state.elapsed;
  if (remaining <= 0.12) return null;
  let best: { point: ReturnType<typeof predictShotPoint>; time: number; cost: number } | null = null;
  for (let sample = 0.16; sample <= remaining; sample += 0.08) {
    const point = predictShotPoint(state.ball.position, state.ball.velocity, state.ball.height, state.ball.verticalVelocity, sample);
    if (!ownsPenaltyArea(goalkeeper, point.position) || point.height < 0.65 || point.height > FIELD.goalHeight - 0.1) continue;
    const cost = distance(goalkeeper.position, point.position) / Math.max(0.12, sample) + Math.abs(point.height - 2.35) * 0.65;
    if (!best || cost < best.cost) best = { point, time: sample, cost };
  }
  if (!best) return null;
  const nearbyOpponent = state.players.some((player) => player.team !== goalkeeper.team
    && distance(player.position, best!.point.position) < goalkeeper.radius * 2.5);
  const punch = nearbyOpponent || best.point.speed > 52 || best.point.height > 3.8;
  return createAttempt(state, goalkeeper, "cross", pass.id, best.point.position, best.point.height, best.time, best.point.speed, punch);
};

const finishMiss = (state: MatchState, goalkeeper: PlayerRuntime, attempt: GoalkeeperAttempt): void => {
  attempt.outcome = "miss";
  attempt.contactQuality = 0;
  attempt.resolvedAt = state.elapsed;
  goalkeeper.goalkeeperRecoveryUntil = state.elapsed + 0.38;
  emitCognitiveEvent(state, "saveResolved", [goalkeeper.profile.id], {
    shotId: attempt.source === "shot" ? attempt.sourceId : undefined,
    passId: attempt.source === "cross" ? attempt.sourceId : undefined,
    saveOutcome: "miss",
  });
};

export const updateGoalkeeperAnticipation = (state: MatchState): void => {
  if (state.activeShot && state.elapsed > state.activeShot.expectedArrivalAt + 1.2) {
    state.activeShot = null;
  }
  for (const goalkeeper of state.players.filter((player) => player.profile.position === "goalkeeper")) {
    const attempt = goalkeeper.goalkeeperAttempt;
    if (attempt && attempt.outcome === null && state.elapsed > attempt.expiresAt) finishMiss(state, goalkeeper, attempt);
    if (goalkeeper.goalkeeperRecoveryUntil > state.elapsed) continue;
    if (attempt && attempt.outcome === null) continue;
    if (attempt?.resolvedAt) {
      const sameShot = attempt.source === "shot" && state.activeShot?.id === attempt.sourceId;
      const sameCross = attempt.source === "cross" && state.pendingPass?.id === attempt.sourceId;
      if (sameShot || sameCross) continue;
    }
    goalkeeper.goalkeeperAttempt = shotAttempt(state, goalkeeper) ?? crossAttempt(state, goalkeeper);
    if (goalkeeper.goalkeeperAttempt?.source === "shot") state.stats[goalkeeper.team].saveAttempts += 1;
  }
};

export const goalkeeperDecision = (goalkeeper: PlayerRuntime, state: MatchState): AgentDecision | null => {
  if (goalkeeper.goalkeeperRecoveryUntil > state.elapsed) {
    return {
      movementTarget: { ...goalkeeper.position }, burst: false, posture: "outOfPossession",
      intent: "recoveringSave", reason: "recoverFromSave", ballAction: { kind: "none" },
    };
  }
  const attempt = goalkeeper.goalkeeperAttempt;
  if (!attempt || attempt.outcome !== null) return null;
  if (state.elapsed < attempt.reactionReadyAt) {
    return {
      movementTarget: { ...attempt.origin }, burst: false, posture: "outOfPossession",
      intent: "preparingSave", reason: attempt.source === "cross" ? "attackCross" : "reactToShot", ballAction: { kind: "none" },
    };
  }
  const intent = attempt.action === "verticalJump" ? "jumping"
    : attempt.action === "aerialClaim" || attempt.action === "punch" ? "claimingHighBall"
      : attempt.action === "standingSave" ? "preparingSave" : "diving";
  return {
    movementTarget: { ...attempt.target },
    burst: attempt.action !== "standingSave",
    burstDuration: Math.max(0.12, attempt.contactAt - state.elapsed + 0.08),
    posture: "outOfPossession",
    intent,
    reason: attempt.source === "cross" ? "attackCross" : "reactToShot",
    ballAction: { kind: "none" },
  };
};

const verticalWindow = (goalkeeper: PlayerRuntime, attempt: GoalkeeperAttempt): { minimum: number; maximum: number } => {
  const skill = goalkeeper.profile.skills.goalkeeping / 100;
  const lateralRatio = clamp(distance(attempt.origin, attempt.target) / Math.max(1, attempt.availableReach), 0, 1);
  const maximumHigh = (3.55 + skill * 1.05) * (1 - lateralRatio * 0.2);
  if (attempt.action === "lowDive") return { minimum: 0, maximum: 1.65 };
  if (attempt.action === "standingSave") return { minimum: 0, maximum: 2.65 + skill * 0.3 };
  if (attempt.action === "verticalJump") return { minimum: 1.05, maximum: 3.65 + skill * 1.05 };
  return { minimum: 0.65, maximum: maximumHigh };
};

const closestSegmentPoint = (start: Vec2, end: Vec2, point: Vec2): { point: Vec2; amount: number } => {
  const segment = subtract(end, start);
  const squared = dot(segment, segment);
  const amount = squared < 0.0001 ? 1 : clamp(dot(subtract(point, start), segment) / squared, 0, 1);
  return { point: add(start, scale(segment, amount)), amount };
};

const setAttemptResult = (
  state: MatchState,
  goalkeeper: PlayerRuntime,
  attempt: GoalkeeperAttempt,
  outcome: SaveOutcome,
  quality: number,
): void => {
  attempt.outcome = outcome;
  attempt.contactQuality = quality;
  attempt.resolvedAt = state.elapsed;
  goalkeeper.goalkeeperRecoveryUntil = state.elapsed + (outcome === "catch"
    ? GOALKEEPING.catchRecovery + (1 - goalkeeperQuality(goalkeeper)) * 0.14
    : GOALKEEPING.diveRecovery + (1 - goalkeeperQuality(goalkeeper)) * 0.28);
  emitCognitiveEvent(state, "saveResolved", [goalkeeper.profile.id, ...relevantPlayersNear(state, state.ball.position)], {
    shotId: attempt.source === "shot" ? attempt.sourceId : undefined,
    passId: attempt.source === "cross" ? attempt.sourceId : undefined,
    saveOutcome: outcome,
  });
};

const safeParryDirection = (state: MatchState, goalkeeper: PlayerRuntime, contact: Vec2, quality: number): Vec2 => {
  const awayFromGoal = { x: goalkeeper.team === "blue" ? 1 : -1, y: 0 };
  const side = contact.y < FIELD.height / 2 ? -1 : 1;
  const safe = normalize({ x: awayFromGoal.x, y: side * (0.55 + quality * 0.85) });
  const normal = normalize(subtract(contact, goalkeeper.position));
  const incoming = normalize(state.ball.velocity);
  const reflected = normalize(subtract(incoming, scale(normal, 2 * dot(incoming, normal))));
  return normalize(add(scale(reflected, 0.72 - quality * 0.28), scale(safe, 0.28 + quality * 0.72)));
};

const resolveCatch = (state: MatchState, goalkeeper: PlayerRuntime, attempt: GoalkeeperAttempt, quality: number, height: number): void => {
  if (state.pendingPass) {
    const pass = state.pendingPass;
    const passer = state.players.find((player) => player.profile.id === pass.passerId);
    if (passer) passer.memory.stats.failedPasses += 1;
    goalkeeper.memory.stats.interceptions += 1;
    emitCognitiveEvent(state, "passResolved", [goalkeeper.profile.id, pass.receiverId, ...relevantPlayersNear(state, goalkeeper.position)], {
      passId: pass.id,
      controllerId: goalkeeper.profile.id,
      outcome: "intercepted",
    });
    state.pendingPass = null;
  }
  state.ball.controllerId = goalkeeper.profile.id;
  state.ball.position = { ...goalkeeper.position };
  state.ball.velocity = { x: 0, y: 0 };
  state.ball.height = 0;
  state.ball.verticalVelocity = 0;
  state.ball.lastTouch = goalkeeper.team;
  state.ball.lastTouchPlayerId = goalkeeper.profile.id;
  state.ball.lastAction = null;
  state.ball.lastShotOnTarget = false;
  clearDribbleOwner(state);
  registerControlledTeam(state, goalkeeper.team, true);
  state.stats[goalkeeper.team].catches += 1;
  if (attempt.source === "cross") state.stats[goalkeeper.team].highBallClaims += 1;
  if (attempt.source === "shot") {
    state.stats[goalkeeper.team].saves += 1;
    emitMatchEvent(state, { type: "save-made", team: goalkeeper.team, playerId: goalkeeper.profile.id, outcome: "catch", height, shotId: attempt.sourceId });
  }
  state.activeShot = null;
  setAttemptResult(state, goalkeeper, attempt, "catch", quality);
  emitCognitiveEvent(state, "controlClaimed", null, { controllerId: goalkeeper.profile.id });
};

const resolveLooseContact = (
  state: MatchState,
  goalkeeper: PlayerRuntime,
  attempt: GoalkeeperAttempt,
  outcome: "parry" | "glance",
  quality: number,
  contact: Vec2,
  height: number,
): void => {
  const incomingSpeed = length(state.ball.velocity);
  const direction = safeParryDirection(state, goalkeeper, contact, quality);
  if (outcome === "parry") {
    state.ball.velocity = scale(direction, incomingSpeed * (0.42 + (1 - quality) * 0.18));
    state.ball.verticalVelocity = Math.max(-2, state.ball.verticalVelocity * 0.24 + (attempt.action === "punch" ? 5 : 1.5));
    state.stats[goalkeeper.team].parries += 1;
    if (attempt.source === "cross") state.stats[goalkeeper.team].punches += 1;
    if (attempt.source === "shot") {
      state.stats[goalkeeper.team].saves += 1;
      emitMatchEvent(state, { type: "save-made", team: goalkeeper.team, playerId: goalkeeper.profile.id, outcome: "parry", height, shotId: attempt.sourceId });
    }
    state.activeShot = null;
    state.ball.lastAction = null;
    state.ball.lastShotOnTarget = false;
  } else {
    state.ball.velocity = add(scale(state.ball.velocity, 0.82), scale(direction, incomingSpeed * 0.16));
    state.ball.verticalVelocity *= 0.82;
    state.stats[goalkeeper.team].glancingTouches += 1;
    if (state.activeShot) state.activeShot.goalkeeperTouched = true;
  }
  state.ball.position = { ...contact };
  state.ball.height = Math.max(0, height);
  state.ball.controllerId = null;
  state.ball.lastTouch = goalkeeper.team;
  state.ball.lastTouchPlayerId = goalkeeper.profile.id;
  clearDribbleOwner(state);
  registerLooseBall(state);
  if (state.pendingPass) {
    const pass = state.pendingPass;
    emitCognitiveEvent(state, "passResolved", relevantPlayersNear(state, contact), { passId: pass.id, outcome: "intercepted" });
    state.pendingPass = null;
  }
  setAttemptResult(state, goalkeeper, attempt, outcome, quality);
  emitCognitiveEvent(state, "ballTrajectoryChanged", relevantPlayersNear(state, contact), {
    shotId: attempt.source === "shot" ? attempt.sourceId : undefined,
    passId: attempt.source === "cross" ? attempt.sourceId : undefined,
  });
};

export const resolveGoalkeeperContact = (
  state: MatchState,
  previousPosition: Vec2,
  previousHeight: number,
  dt: number,
): boolean => {
  if (state.ball.controllerId) return false;
  for (const goalkeeper of state.players.filter((player) => player.profile.position === "goalkeeper")) {
    const attempt = goalkeeper.goalkeeperAttempt;
    if (!attempt || attempt.outcome !== null) continue;
    const { point, amount } = closestSegmentPoint(previousPosition, state.ball.position, goalkeeper.position);
    const contactTime = state.elapsed - dt + amount * dt;
    if (contactTime + 0.0001 < attempt.reactionReadyAt || !ownsPenaltyArea(goalkeeper, point)) continue;
    const height = Math.max(0, previousHeight + (state.ball.height - previousHeight) * amount);
    const vertical = verticalWindow(goalkeeper, attempt);
    const preparation = clamp((attempt.contactAt - attempt.reactionReadyAt) / 0.75, 0, 1);
    const handFactor = preparedHandFactor(attempt.action, preparation);
    const lateralRadius = goalkeeper.radius * 0.82 + GOALKEEPING.handReach * handFactor + state.ball.radius * 0.35;
    const planarGap = distance(point, goalkeeper.position);
    if (planarGap > lateralRadius || height < vertical.minimum || height > vertical.maximum) continue;
    const planarMargin = clamp(1 - planarGap / lateralRadius, 0, 1);
    const verticalCenter = (vertical.minimum + vertical.maximum) / 2;
    const verticalMargin = clamp(1 - Math.abs(height - verticalCenter) / Math.max(0.5, (vertical.maximum - vertical.minimum) / 2), 0, 1);
    const readiness = clamp((contactTime - attempt.reactionReadyAt) / Math.max(0.08, attempt.contactAt - attempt.reactionReadyAt), 0, 1);
    const speed = length(state.ball.velocity);
    const speedPenalty = clamp((speed - 52) / 220, 0, 0.22);
    const verticalSpeedPenalty = clamp(Math.abs(state.ball.verticalVelocity) / 105, 0, 0.08);
    const quality = clamp(goalkeeperQuality(goalkeeper) * 0.62 * (0.84 + planarMargin * 0.16)
      + planarMargin * 0.42 + verticalMargin * 0.07 + readiness * 0.07 + preparation * 0.5
      - speedPenalty * (1 - planarMargin * 0.55) - verticalSpeedPenalty
      - (1 - goalkeeper.energy) * 0.08 + signedMatchNoise(state) * 0.055, 0, 1);
    const catchSpeed = 79 + goalkeeper.profile.skills.goalkeeping * 0.25;
    const catchingShapeBonus = planarMargin * 0.25
      + (attempt.action === "standingSave" || attempt.action === "verticalJump" ? 0.1 : 0);
    const outcome: SaveOutcome = attempt.action !== "punch"
      && quality + catchingShapeBonus >= GOALKEEPING.catchThreshold && speed <= catchSpeed ? "catch"
      : quality >= GOALKEEPING.parryThreshold ? "parry" : "glance";
    if (outcome === "catch") resolveCatch(state, goalkeeper, attempt, quality, height);
    else resolveLooseContact(state, goalkeeper, attempt, outcome, quality, point, height);
    return true;
  }
  return false;
};

export const clearGoalkeeperAttempts = (state: MatchState): void => {
  for (const goalkeeper of state.players.filter((player) => player.profile.position === "goalkeeper")) {
    goalkeeper.goalkeeperAttempt = null;
    goalkeeper.goalkeeperRecoveryUntil = 0;
  }
};
