import { FIELD, FIXED_STEP, GOALKEEPING } from "../config";
import { add, clamp, distance, dot, length, normalize, scale, subtract } from "../../shared/math";
import type { AgentDecision, GoalkeeperAction, GoalkeeperAttempt, GoalkeeperSource, MatchState, PlayerRuntime, SaveOutcome, Vec2 } from "../model";
import { clearDribbleOwner, registerControlledTeam, registerLooseBall } from "../runtime/control";
import { emitCognitiveEvent, relevantPlayersNear } from "../runtime/cognitive-events";
import { emitMatchEvent } from "../runtime/events";
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

/** Body radius plus one radius of arm. Everything beyond this has to be covered by moving. */
export const goalkeeperReachRadius = (goalkeeper: PlayerRuntime): number =>
  goalkeeper.radius * (1 + GOALKEEPING.handReachFactor);

/** Impulso máximo que este goleiro consegue imprimir num mergulho (explosão). */
const diveLaunchSpeed = (goalkeeper: PlayerRuntime): number =>
  GOALKEEPING.diveLaunchSpeed * (0.82 + goalkeeper.profile.skills.goalkeeping / 100 * 0.3) * (0.8 + goalkeeper.sprintEnergy * 0.2)
  * GOALKEEPING.maxDiveSpeedFactor;

/** Tempo que um mergulho no impulso máximo leva para o corpo cobrir `bodyGap`, ou Infinity se nem no talo chega. */
const diveTimeToCover = (bodyGap: number, maxSpeed: number): number => {
  if (bodyGap <= 0) return 0;
  const ratio = bodyGap * GOALKEEPING.diveDrag / maxSpeed;
  if (ratio >= 1) return Infinity;
  return -Math.log(1 - ratio) / GOALKEEPING.diveDrag;
};

/**
 * O impulso exato para o corpo pousar sobre o ponto de interceptação em `seconds`: inverte
 * diveDisplacement. É isto que projeta o goleiro na perpendicular à rota da bola em vez de
 * um empurrão fixo — mergulho pleno para bola longe, alcance controlado para bola perto.
 */
const launchSpeedToReach = (bodyGap: number, seconds: number, maxSpeed: number): number => {
  if (bodyGap <= 0) return 0;
  const reachable = 1 - Math.exp(-GOALKEEPING.diveDrag * Math.max(0.02, seconds));
  return Math.min(maxSpeed, bodyGap * GOALKEEPING.diveDrag / Math.max(0.001, reachable));
};

const maximumVertical = (goalkeeper: PlayerRuntime): number =>
  GOALKEEPING.jumpLaunchVertical * (0.84 + goalkeeper.profile.skills.goalkeeping / 100 * 0.3);

/** Height of the keeper's body above the ground, from the vertical impulse he committed to. */
export const goalkeeperJumpHeight = (attempt: GoalkeeperAttempt, elapsed: number): number => {
  if (attempt.launchedAt === null) return 0;
  const t = Math.max(0, elapsed - attempt.launchedAt);
  return Math.max(0, attempt.launchVertical * t - 0.5 * GOALKEEPING.jumpGravity * t * t);
};

export const goalkeeperAirborne = (attempt: GoalkeeperAttempt | null, elapsed: number): boolean =>
  attempt !== null && attempt.launchedAt !== null && elapsed - attempt.launchedAt < attempt.flightTime;

/** The vertical impulse that puts the keeper's hands on `height` after `seconds`. */
const verticalImpulseFor = (height: number, seconds: number): number =>
  (height - GOALKEEPING.standingReach + 0.5 * GOALKEEPING.jumpGravity * seconds * seconds) / Math.max(0.02, seconds);

const describeAction = (
  source: GoalkeeperSource,
  lateral: number,
  vertical: number,
  height: number,
  punch: boolean,
): GoalkeeperAction => {
  if (source === "cross") return punch ? "punch" : "aerialClaim";
  if (lateral < 1.2 && vertical <= 0.15) return "standingSave";
  if (vertical > lateral * 0.55) return "verticalJump";
  return height > 1.55 ? "highDive" : "lowDive";
};

const createAttempt = (
  state: MatchState,
  goalkeeper: PlayerRuntime,
  source: GoalkeeperSource,
  sourceId: number,
): GoalkeeperAttempt => ({
  source,
  sourceId,
  action: "standingSave",
  startedAt: state.elapsed,
  reactionReadyAt: state.elapsed + reactionDelay(goalkeeper),
  expiresAt: state.elapsed + GOALKEEPING.maximumAttemptAge,
  origin: { ...goalkeeper.position },
  approachTarget: { ...goalkeeper.position },
  launchedAt: null,
  launchDirection: null,
  launchSpeed: 0,
  launchVertical: 0,
  flightTime: 0,
  reachRadius: goalkeeperReachRadius(goalkeeper),
  desperate: false,
  outcome: null,
  contactQuality: null,
  resolvedAt: null,
});

const shotAttempt = (state: MatchState, goalkeeper: PlayerRuntime): GoalkeeperAttempt | null => {
  const shot = state.activeShot;
  if (!shot || shot.team === goalkeeper.team || !shot.onTarget) return null;
  return createAttempt(state, goalkeeper, "shot", shot.id);
};

const crossAttempt = (state: MatchState, goalkeeper: PlayerRuntime): GoalkeeperAttempt | null => {
  const pass = state.pendingPass;
  if (!pass?.id || pass.team === goalkeeper.team || pass.purpose !== "cross" || pass.trajectory !== "air") return null;
  if (!ownsPenaltyArea(goalkeeper, pass.landingPoint)) return null;
  if (pass.expectedArrivalAt - state.elapsed <= 0.12) return null;
  return createAttempt(state, goalkeeper, "cross", pass.id);
};

const nearestGap = (players: PlayerRuntime[], point: Vec2): number =>
  players.length === 0 ? Infinity : Math.min(...players.map((player) => distance(player.position, point)));

/**
 * Bola solta e perigosa dentro da própria área, mesmo sem ser um chute a gol: o goleiro sai
 * para recolher/mergulhar, mas só quando é ele quem chega primeiro — senão fica na linha.
 */
const looseAttempt = (state: MatchState, goalkeeper: PlayerRuntime): GoalkeeperAttempt | null => {
  const ball = state.ball;
  if (ball.controllerId !== null) return null;
  if (state.pendingPass?.team === goalkeeper.team) return null;
  if (length(ball.velocity) > GOALKEEPING.looseClaimMaxBallSpeed) return null;
  if (ball.height > GOALKEEPING.mediumHeight) return null;
  const soon = predictShotPoint(ball.position, ball.velocity, ball.height, ball.verticalVelocity, 0.35);
  const inBoxNow = ownsPenaltyArea(goalkeeper, ball.position);
  const target = inBoxNow ? ball.position : soon.position;
  if (!inBoxNow && !ownsPenaltyArea(goalkeeper, soon.position)) return null;
  const keeperGap = distance(goalkeeper.position, target);
  const opponents = state.players.filter((player) => player.team !== goalkeeper.team);
  const threatGap = nearestGap(opponents, target);
  // Só sai quando há um adversário ameaçando a bola e ele chega antes (com uma margem). Bola
  // solta inofensiva, sem adversário por perto, fica para os zagueiros — o goleiro segura a linha.
  if (threatGap > GOALKEEPING.looseClaimThreatRange) return null;
  if (keeperGap > threatGap + GOALKEEPING.looseClaimBeatMargin) return null;
  return createAttempt(state, goalkeeper, "loose", 0);
};

/** How long until the ball is past the point where this keeper could still touch it. */
const windowRemaining = (state: MatchState, goalkeeper: PlayerRuntime, attempt: GoalkeeperAttempt): number => {
  if (attempt.source === "cross") {
    return Math.max(0, (state.pendingPass?.expectedArrivalAt ?? state.elapsed) - state.elapsed);
  }
  if (attempt.source === "loose") {
    // Bola lenta na área: o solver já descarta pontos fora da área/alcance, então basta uma
    // janela curta para ele sair e recolher.
    return Math.min(1.2, GOALKEEPING.maximumAttemptAge - (state.elapsed - attempt.startedAt));
  }
  const behindGoalLine = goalkeeper.team === "blue" ? -FIELD.ballRadius : FIELD.width + FIELD.ballRadius;
  const crossing = timeToX(state.ball.position.x, state.ball.velocity.x, behindGoalLine);
  const fallback = Math.max(0, (state.activeShot?.expectedArrivalAt ?? state.elapsed) - state.elapsed);
  return Math.max(0, crossing ?? fallback);
};

interface LaunchSolution {
  point: Vec2;
  height: number;
  seconds: number;
  gap: number;
  /** Distância que o corpo precisa cobrir além do alcance de braço. */
  bodyGap: number;
  /** Tempo mínimo do mergulho no talo para chegar; usado para decidir o instante do commit. */
  diveTime: number;
  vertical: number;
  punch: boolean;
}

/**
 * Walk the ball's future path and find the contact the keeper could still physically make.
 * Escolhe o ponto de interceptação de menor esforço — a perpendicular entre o goleiro e a
 * rota da bola — entre os que um mergulho no talo ainda alcança. Devolve null quando nada na
 * rota é alcançável nem no impulso máximo.
 */
const solveLaunch = (
  state: MatchState,
  goalkeeper: PlayerRuntime,
  attempt: GoalkeeperAttempt,
  horizon: number,
  maxSpeed: number,
): LaunchSolution | null => {
  const ceiling = maximumVertical(goalkeeper);
  let best: LaunchSolution | null = null;
  for (let seconds = GOALKEEPING.launchSearchStep; seconds <= horizon; seconds += GOALKEEPING.launchSearchStep) {
    const predicted = predictShotPoint(
      state.ball.position,
      state.ball.velocity,
      state.ball.height,
      state.ball.verticalVelocity,
      seconds,
    );
    if (!ownsPenaltyArea(goalkeeper, predicted.position)) continue;
    if (predicted.height > FIELD.goalHeight + 0.4) continue;
    const gap = distance(goalkeeper.position, predicted.position);
    const bodyGap = Math.max(0, gap - attempt.reachRadius);
    const diveTime = diveTimeToCover(bodyGap, maxSpeed);
    // Precisa dar tempo do corpo chegar antes da bola cruzar este ponto.
    if (diveTime > seconds) continue;
    const vertical = verticalImpulseFor(predicted.height, seconds);
    if (vertical > ceiling) continue;
    const nearbyOpponent = attempt.source === "cross" && state.players.some((player) => player.team !== goalkeeper.team
      && distance(player.position, predicted.position) < goalkeeper.radius * 2.5);
    const solution: LaunchSolution = {
      point: predicted.position,
      height: predicted.height,
      seconds,
      gap,
      bodyGap,
      diveTime,
      vertical: Math.max(0, vertical),
      punch: nearbyOpponent || predicted.speed > 52 || predicted.height > 3.8,
    };
    // O ponto de menor esforço (menor mergulho) é o alvo: a perpendicular à rota da bola.
    if (!best || solution.bodyGap < best.bodyGap) best = solution;
  }
  return best;
};

const launch = (
  state: MatchState,
  goalkeeper: PlayerRuntime,
  attempt: GoalkeeperAttempt,
  towards: Vec2,
  height: number,
  vertical: number,
  launchSpeed: number,
  punch: boolean,
  desperate: boolean,
): void => {
  const offset = subtract(towards, goalkeeper.position);
  const lateral = length(offset);
  attempt.launchedAt = state.elapsed;
  attempt.launchDirection = lateral < 0.001 ? { x: 0, y: 0 } : normalize(offset);
  attempt.launchSpeed = launchSpeed;
  attempt.launchVertical = vertical;
  attempt.flightTime = vertical <= 0.05 ? GOALKEEPING.groundedDiveTime : 2 * vertical / GOALKEEPING.jumpGravity;
  attempt.desperate = desperate;
  attempt.action = describeAction(attempt.source, lateral, vertical, height, punch);
  goalkeeper.velocity = scale(attempt.launchDirection, launchSpeed);
};

/**
 * Decide, a cada tick, entre ajustar os pés no chão ou se comprometer com o mergulho.
 * O goleiro escolhe o ponto de interceptação de menor esforço (a perpendicular à rota da bola)
 * e faz a corridinha de ajuste enquanto sobra folga; assim que faltar apenas o tempo de voo do
 * mergulho mais uma margem de segurança, ele decola com o impulso dimensionado para pousar
 * exatamente sobre esse ponto. Isso produz um mergulho pleno que chega a tempo, em vez de um
 * lance curto e tardio. Uma bola inalcançável mesmo no talo termina num mergulho que cai curto.
 */
const updateLaunchDecision = (state: MatchState, goalkeeper: PlayerRuntime, attempt: GoalkeeperAttempt, _dt: number): void => {
  if (attempt.launchedAt !== null || state.elapsed < attempt.reactionReadyAt) return;
  const horizon = windowRemaining(state, goalkeeper, attempt);
  if (horizon <= 0) return;
  const maxSpeed = diveLaunchSpeed(goalkeeper);
  const solution = solveLaunch(state, goalkeeper, attempt, horizon, maxSpeed);

  if (!solution) {
    // Nem no impulso máximo se alcança. Encosta na rota e re-avalia; se a bola está prestes a
    // passar, joga o corpo assim mesmo (mergulho de desespero, que cai curto).
    const predicted = predictShotPoint(
      state.ball.position, state.ball.velocity, state.ball.height, state.ball.verticalVelocity,
      Math.max(GOALKEEPING.launchSearchStep, horizon * 0.5),
    );
    attempt.approachTarget = { ...predicted.position };
    if (horizon <= GOALKEEPING.desperationLead) {
      const vertical = clamp(verticalImpulseFor(predicted.height, Math.max(0.06, horizon)), 0, maximumVertical(goalkeeper));
      launch(state, goalkeeper, attempt, predicted.position, predicted.height, vertical, maxSpeed, false, true);
    }
    return;
  }

  attempt.approachTarget = { ...solution.point };
  // Faz a corridinha de ajuste enquanto sobra folga; compromete-se assim que faltar apenas o
  // tempo do mergulho mais a margem de segurança. Isso dá voo pleno ao corpo (mergulho que
  // chega ao ponto) e impede a bola de passar enquanto ele ainda "se prepara".
  if (solution.seconds > solution.diveTime + GOALKEEPING.commitLead) return;
  // Dimensiona o impulso para o corpo pousar exatamente sobre o ponto de interceptação — a
  // perpendicular entre o goleiro e a rota da bola.
  const launchSpeed = launchSpeedToReach(solution.bodyGap, solution.seconds, maxSpeed);
  launch(state, goalkeeper, attempt, solution.point, solution.height, solution.vertical, launchSpeed, solution.punch, false);
};

const finishMiss = (state: MatchState, goalkeeper: PlayerRuntime, attempt: GoalkeeperAttempt): void => {
  attempt.outcome = "miss";
  attempt.contactQuality = 0;
  attempt.resolvedAt = state.elapsed;
  goalkeeper.goalkeeperRecoveryUntil = state.elapsed + (attempt.launchedAt === null ? 0.18 : GOALKEEPING.diveRecovery * 0.75);
  emitCognitiveEvent(state, "saveResolved", [goalkeeper.profile.id], {
    shotId: attempt.source === "shot" ? attempt.sourceId : undefined,
    passId: attempt.source === "cross" ? attempt.sourceId : undefined,
    saveOutcome: "miss",
  });
};

export const updateGoalkeeperAnticipation = (state: MatchState, dt: number = FIXED_STEP): void => {
  if (state.activeShot && state.elapsed > state.activeShot.expectedArrivalAt + 1.2) {
    state.activeShot = null;
  }
  for (const goalkeeper of state.players.filter((player) => player.profile.position === "goalkeeper")) {
    const attempt = goalkeeper.goalkeeperAttempt;
    if (attempt && attempt.outcome === null) {
      const landed = attempt.launchedAt !== null && !goalkeeperAirborne(attempt, state.elapsed);
      if (state.elapsed > attempt.expiresAt || (landed && windowRemaining(state, goalkeeper, attempt) <= 0)) {
        finishMiss(state, goalkeeper, attempt);
      } else {
        updateLaunchDecision(state, goalkeeper, attempt, dt);
        continue;
      }
    }
    if (goalkeeper.goalkeeperRecoveryUntil > state.elapsed) continue;
    if (attempt?.resolvedAt) {
      const sameShot = attempt.source === "shot" && state.activeShot?.id === attempt.sourceId;
      const sameCross = attempt.source === "cross" && state.pendingPass?.id === attempt.sourceId;
      if (sameShot || sameCross) continue;
    }
    goalkeeper.goalkeeperAttempt = shotAttempt(state, goalkeeper) ?? crossAttempt(state, goalkeeper) ?? looseAttempt(state, goalkeeper);
    if (goalkeeper.goalkeeperAttempt) {
      if (goalkeeper.goalkeeperAttempt.source === "shot") state.stats[goalkeeper.team].saveAttempts += 1;
      updateLaunchDecision(state, goalkeeper, goalkeeper.goalkeeperAttempt, dt);
    }
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
  const reason = attempt.source === "cross" ? "attackCross" : attempt.source === "loose" ? "smotherLoose" : "reactToShot";
  if (state.elapsed < attempt.reactionReadyAt) {
    return {
      movementTarget: { ...attempt.origin }, burst: false, posture: "outOfPossession",
      intent: "preparingSave", reason, ballAction: { kind: "none" },
    };
  }
  if (attempt.launchedAt === null) {
    // Feet still on the ground: a short, ordinary shuffle across the line. No burst, no magic.
    return {
      movementTarget: { ...attempt.approachTarget }, burst: false, posture: "outOfPossession",
      intent: "preparingSave", reason, ballAction: { kind: "none" },
    };
  }
  const intent = attempt.action === "verticalJump" ? "jumping"
    : attempt.action === "aerialClaim" || attempt.action === "punch" ? "claimingHighBall"
      : attempt.action === "standingSave" ? "preparingSave" : "diving";
  return {
    // Committed. The movement system ignores this target while airborne; it is kept
    // only so the intent reads coherently for observers.
    movementTarget: { ...goalkeeper.position }, burst: false, posture: "outOfPossession",
    intent, reason, ballAction: { kind: "none" },
  };
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
  const grounded = attempt.launchedAt === null;
  goalkeeper.goalkeeperRecoveryUntil = state.elapsed + (outcome === "catch"
    ? (grounded ? GOALKEEPING.catchRecovery * 0.5 : GOALKEEPING.catchRecovery) + (1 - goalkeeperQuality(goalkeeper)) * 0.14
    : (grounded ? GOALKEEPING.diveRecovery * 0.45 : GOALKEEPING.diveRecovery) + (1 - goalkeeperQuality(goalkeeper)) * 0.28);
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
  // Bola nas mãos: segura a posse (imune a desarme) e espera o time subir antes de distribuir.
  goalkeeper.goalkeeperHoldUntil = state.elapsed + GOALKEEPING.catchRecovery + GOALKEEPING.secureHoldSeconds;
  goalkeeper.goalkeeperAlertUntil = 0;
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
  // Rebateu: a bola segue viva. Levanta mais rápido do que numa defesa segura e entra em
  // alerta para caçar a sobra e se reposicionar em velocidade.
  goalkeeper.goalkeeperRecoveryUntil = Math.min(
    goalkeeper.goalkeeperRecoveryUntil,
    state.elapsed + (attempt.launchedAt === null ? 0.16 : GOALKEEPING.diveRecovery * 0.55),
  );
  goalkeeper.goalkeeperAlertUntil = state.elapsed + GOALKEEPING.alertSeconds;
  emitCognitiveEvent(state, "ballTrajectoryChanged", relevantPlayersNear(state, contact), {
    shotId: attempt.source === "shot" ? attempt.sourceId : undefined,
    passId: attempt.source === "cross" ? attempt.sourceId : undefined,
  });
};

/**
 * Pure collision: the ball's swept segment against the sphere the keeper's body and arms
 * occupy right now. No predicted target, no arrival contract — if the body is not there,
 * nothing happens.
 */
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

    const planarGap = distance(point, goalkeeper.position);
    if (planarGap > attempt.reachRadius) continue;

    const height = Math.max(0, previousHeight + (state.ball.height - previousHeight) * amount);
    const body = goalkeeperJumpHeight(attempt, contactTime);
    const lowest = Math.max(0, body - 0.4);
    const highest = body + GOALKEEPING.standingReach;
    if (height < lowest || height > highest) continue;

    const planarMargin = clamp(1 - planarGap / attempt.reachRadius, 0, 1);
    const verticalCenter = (lowest + highest) / 2;
    const verticalMargin = clamp(1 - Math.abs(height - verticalCenter) / Math.max(0.5, (highest - lowest) / 2), 0, 1);
    // A keeper who had to fling himself has worse hands than one who was already set.
    const settled = clamp(1 - length(goalkeeper.velocity) / Math.max(1, GOALKEEPING.diveLaunchSpeed), 0, 1);
    const composure = attempt.desperate ? settled * 0.35 : settled;
    const speed = length(state.ball.velocity);
    const speedPenalty = clamp((speed - 52) / 220, 0, 0.22);
    const verticalSpeedPenalty = clamp(Math.abs(state.ball.verticalVelocity) / 105, 0, 0.08);
    const quality = clamp(goalkeeperQuality(goalkeeper) * 0.62 * (0.84 + planarMargin * 0.16)
      + planarMargin * 0.42 + verticalMargin * 0.07 + composure * 0.24
      - speedPenalty * (1 - planarMargin * 0.55) - verticalSpeedPenalty
      - (1 - goalkeeper.stamina) * 0.08 + signedMatchNoise(state) * 0.055, 0, 1);
    const catchSpeed = 79 + goalkeeper.profile.skills.goalkeeping * 0.25;
    const catchingShapeBonus = planarMargin * 0.25 + composure * 0.12;
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
    goalkeeper.goalkeeperHoldUntil = 0;
    goalkeeper.goalkeeperAlertUntil = 0;
  }
};
