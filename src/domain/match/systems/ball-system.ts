import { formationAnchor } from "../ai";
import { DUEL, FIELD, PHYSICS, STAMINA } from "../config";
import { add, clamp, distance, dot, lerp, length, limit, normalize, rotate, scale, subtract } from "../../shared/math";
import type { AgentDecision, BallAction, DribbleStyle, DribbleTouchRange, MatchState, PlayerRuntime, Team, Vec2 } from "../model";
import {
  adaptPlayerPolicy,
  clearDribbleOwner,
  pressureAt,
  registerControlledTeam,
} from "../runtime/control";
import { emitMatchEvent } from "../runtime/events";
import { emitCognitiveEvent, relevantPlayersNear } from "../runtime/cognitive-events";
import { playerSkillSpeed } from "../runtime/player-metrics";
import { signedMatchNoise } from "../runtime/random";
import { solvePassTrajectory, targetAlongDirection } from "../runtime/pass-trajectory";
import { predictShotPoint, solveShotTrajectory } from "../runtime/shot-trajectory";
import { clearGoalkeeperAttempts, resolveGoalkeeperContact } from "./goalkeeper-system";

const dribbleTravelPlan = (
  player: PlayerRuntime,
  style: DribbleStyle,
  touchRange: DribbleTouchRange | undefined,
  target: Vec2,
  quality: number,
): { launchSpeed: number; chaseDuration: number } => {
  const intendedDistance = distance(player.position, target);
  const controlOffset = player.radius + FIELD.ballRadius + 0.15;
  const ballTravelDistance = Math.max(2.2, intendedDistance - controlOffset);
  const speedFactor = style === "knockOn" || style === "feint"
    ? PHYSICS.burstSpeedFactor
    : PHYSICS.controlledSpeedFactor;
  const expectedPlayerSpeed = playerSkillSpeed(player) * speedFactor * (0.78 + quality * 0.14);
  const minimumDuration = style === "knockOn"
    ? touchRange === "short" ? 0.42 : touchRange === "medium" ? 0.62 : 0.86
    : style === "feint" ? 0.72 : 0.38;
  const maximumDuration = style === "knockOn"
    ? touchRange === "short" ? 0.68 : touchRange === "medium" ? 0.96 : 1.35
    : style === "feint" ? 1.2 : 0.76;
  const chaseDuration = clamp(intendedDistance / Math.max(1, expectedPlayerSpeed) + 0.12, minimumDuration, maximumDuration);
  const ballTravelTime = chaseDuration * (style === "carry" ? 0.82 : 0.72);
  const dragDistanceFactor = 1 - Math.exp(-PHYSICS.ballDrag * ballTravelTime);
  const distanceMatchedSpeed = ballTravelDistance * PHYSICS.ballDrag / Math.max(0.01, dragDistanceFactor);
  const minimumLaunchSpeed = style === "knockOn"
    ? touchRange === "short" ? 18 : touchRange === "medium" ? 24 : 30
    : style === "feint" ? 25 : 17;
  return {
    launchSpeed: clamp(distanceMatchedSpeed, minimumLaunchSpeed, PHYSICS.maxBallSpeed),
    chaseDuration,
  };
};

const releaseBall = (state: MatchState, player: PlayerRuntime, direction: Vec2, speed: number, lift: number): void => {
  state.ball.velocity = limit(scale(direction, speed), PHYSICS.maxBallSpeed);
  state.ball.verticalVelocity = lift;
  state.ball.height = 0;
  state.ball.controllerId = null;
  clearDribbleOwner(state);
  state.ball.controlStartedAt = 0;
  state.ball.lastTouch = player.team;
  state.ball.lastTouchPlayerId = player.profile.id;
  state.ballControlTeam = null;
  state.possessionCandidateSince = state.elapsed;
};

export const executeBallAction = (state: MatchState, player: PlayerRuntime, action: BallAction): void => {
  if (action.kind === "none" || player.kickCooldown > 0 || player.reactionTimer > 0) return;
  const rawPressure = pressureAt(state, player);
  const pressure = rawPressure * (1.16 - player.profile.mental.composure / 190);
  if (action.kind === "dribble") {
    if (action.style === "knockOn" && player.dribbleTouchCooldown > 0) return;
    const controlStartedAt = state.ball.controlStartedAt || state.elapsed;
    const quality = (player.profile.skills.control * 0.75 + player.profile.skills.burst * 0.25) / 100;
    const targetDirection = normalize(subtract(action.target, player.position));
    if (action.style === "carry") {
      // Close control: a bola fica colada no pé, em velocidade baixa. Avançar em pique
      // exige soltar a bola à frente (knockOn), nunca a condução colada.
      state.ball.lastAction = "dribble";
      state.ball.lastShotOnTarget = false;
      state.ball.lastTouch = player.team;
      state.ball.lastTouchPlayerId = player.profile.id;
      state.ball.controlStartedAt = controlStartedAt;
      clearDribbleOwner(state);
      registerControlledTeam(state, player.team);
      return;
    }
    let success = true;
    let errorFactor = 0.32 + pressure * 0.28;
    let speed = 13.5 + quality * 3.5;
    let chosenDirection = targetDirection;
    let dribbleTarget = action.target;
    let defender: PlayerRuntime | null = null;
    if (action.style === "knockOn") {
      errorFactor = 0.58 + pressure * 0.42 + (1 - player.sprintEnergy) * 0.35;
      speed = 25 + quality * 9;
      state.stats[player.team].sprintDribbles += 1;
      const touchRange = action.touchRange ?? "medium";
      // Cadência entre toques: curta o bastante para o avanço ser uma sequência de piques.
      // Na prática o jogador só volta a tocar ao alcançar a bola; isto só evita toque duplo.
      const touchCooldown = touchRange === "short" ? 0.3 : touchRange === "medium" ? 0.42 : 0.55;
      player.dribbleTouchCooldown = Math.max(player.dribbleTouchCooldown, touchCooldown);
      if (touchRange === "short") state.stats[player.team].shortSprintDribbles += 1;
      else if (touchRange === "medium") state.stats[player.team].mediumSprintDribbles += 1;
      else state.stats[player.team].longSprintDribbles += 1;
    } else if (action.style === "feint") {
      defender = [...state.players]
        .filter((candidate) => candidate.team !== player.team
          && candidate.reactionTimer <= 0
          && candidate.duelCooldown <= 0
          // Só finta contra um marcador REAL no raio de colisão (raios quase se tocando).
          && distance(candidate.position, player.position) < player.radius + candidate.radius + DUEL.feintEngageMargin)
        .sort((a, b) => distance(a.position, player.position) - distance(b.position, player.position))[0];
      if (defender) {
        state.stats[player.team].feintsAttempted += 1;
        const attackerScore = (player.profile.skills.control * 0.58 + player.profile.skills.burst * 0.42) / 100;
        const defenderScore = (defender.profile.skills.defending * 0.62 + defender.profile.skills.acceleration * 0.38) / 100;
        success = attackerScore - defenderScore + signedMatchNoise(state) * 0.42 > 0.08;
        if (success) {
          defender.reactionTimer = Math.max(defender.reactionTimer, PHYSICS.feintReactionDuration * (0.8 + quality * 0.4));
          defender.duelCooldown = Math.max(defender.duelCooldown, PHYSICS.feintEvasionDuration + 0.22);
          defender.controlCooldown = Math.max(defender.controlCooldown, PHYSICS.feintEvasionDuration);
        }
      } else {
        success = false;
      }
      if (success) {
        const towardDefender = normalize(subtract(defender!.position, player.position));
        const firstSide = { x: -towardDefender.y, y: towardDefender.x };
        const secondSide = scale(firstSide, -1);
        const escapeSide = dot(firstSide, targetDirection) >= dot(secondSide, targetDirection) ? firstSide : secondSide;
        const goalward = { x: player.team === "blue" ? 1 : -1, y: 0 };
        chosenDirection = normalize(add(add(scale(goalward, 0.72), scale(targetDirection, 0.28)), scale(escapeSide, 0.92)));
        dribbleTarget = {
          x: clamp(defender!.position.x + goalward.x * FIELD.width * 0.07, 4, FIELD.width - 4),
          y: clamp(defender!.position.y + escapeSide.y * FIELD.height * 0.075, 4, FIELD.height - 4),
        };
        defender!.velocity = add(scale(defender!.velocity, 0.25), scale(escapeSide, -6.5));
        state.stats[player.team].feintsCompleted += 1;
        player.memory.stats.dribbles += 1;
        adaptPlayerPolicy(player, "dribble", state.learningEnabled ? 0.0012 : 0);
        player.velocity = add(player.velocity, scale(chosenDirection, 9));
      } else {
        if (defender) chosenDirection = normalize(subtract(defender.position, player.position));
        adaptPlayerPolicy(player, "dribble", state.learningEnabled ? -0.0008 : 0);
      }
      player.duelCooldown = success ? 5.2 : 6.8;
      errorFactor = success ? 0.14 : 0.72;
      speed = success ? 23 + quality * 7 : 11.5;
    }
    // Finta lida pelo marcador: o atacante NÃO perde a posse por tentar o drible. Mantém a bola
    // no pé (close control) e come um cooldown; o eventual desarme fica a cargo do contato real
    // (resolveContact), que dispara quando os raios colidem. (Antes o releaseBall incondicional
    // largava a bola solta sem dono → perda de posse gratuita.)
    if (action.style === "feint" && !success) {
      state.ball.lastAction = "dribble";
      state.ball.lastShotOnTarget = false;
      state.ball.lastTouch = player.team;
      state.ball.lastTouchPlayerId = player.profile.id;
      state.ball.controlStartedAt = controlStartedAt;
      state.feintEvasion = null;
      clearDribbleOwner(state);
      registerControlledTeam(state, player.team);
      player.kickCooldown = 0.42;
      return;
    }
    const travelPlan = dribbleTravelPlan(player, action.style, action.touchRange, dribbleTarget, quality);
    speed = travelPlan.launchSpeed;
    // Quem empurra a bola à frente precisa disparar atrás dela — a não ser exaurido. Não trava o
    // sprintCooldown: a perseguição se sustenta em piques encadeados, limitada pela energia volátil.
    if ((action.style === "knockOn" || action.style === "feint") && player.sprintEnergy > 0.1) {
      player.sprintTimer = Math.max(player.sprintTimer, travelPlan.chaseDuration);
    }
    const direction = rotate(chosenDirection, signedMatchNoise(state) * (1 - quality) * errorFactor);
    releaseBall(state, player, direction, speed, 0);
    state.ball.lastAction = "dribble";
    state.ball.lastShotOnTarget = false;
    if (action.style === "feint") {
      state.feintEvasion = defender
        ? { attackerId: player.profile.id, defenderId: defender.profile.id, expiresAt: state.elapsed + PHYSICS.feintEvasionDuration }
        : null;
    }
    state.ball.dribbleOwnerId = player.profile.id;
    state.ball.dribbleTarget = { ...dribbleTarget };
    state.ball.dribbleStyle = action.style;
    state.ball.dribbleTouchRange = action.style === "knockOn" ? action.touchRange ?? "medium" : null;
    state.ball.dribbleStartedAt = state.elapsed;
    state.ball.controlStartedAt = controlStartedAt;
    registerControlledTeam(state, player.team);
    player.kickCooldown = action.style === "feint" ? 0.32 : action.style === "knockOn" ? 0.3 : 0.16;
    return;
  }
  if (action.kind === "shot") {
    const contactHeight = state.ball.height;
    const technique = action.technique ?? "power";
    const aerialDifficulty = technique === "header" ? 0.1 : technique === "volley" ? 0.14 : technique === "redirect" ? 0.08 : 0;
    const quality = clamp((player.profile.skills.finishing * 0.72 + player.profile.skills.control * 0.28) / 100
      - pressure * 0.22 - aerialDifficulty, 0.2, 0.98);
    const direction = rotate(normalize(subtract(action.target, state.ball.position)), signedMatchNoise(state) * (1 - quality) * (technique === "volley" ? 0.64 : 0.5));
    const skillFactor = 0.78 + player.profile.skills.kickPower / 220;
    const techniqueSpeed = technique === "header" ? 0.76 : technique === "redirect" ? 0.82 : 1;
    const speed = lerp(54, 92, action.power) * skillFactor * techniqueSpeed;
    const executedTarget = targetAlongDirection(state.ball.position, action.target, direction);
    const requestedHeight = clamp(action.targetHeight ?? (technique === "header" ? 2.9 : technique === "volley" ? 2.65 : 0.35), 0.1, FIELD.goalHeight - 0.25);
    const solution = solveShotTrajectory(state.ball.position, executedTarget, contactHeight, requestedHeight, speed);
    releaseBall(state, player, normalize(solution.velocity), length(solution.velocity), solution.verticalVelocity);
    state.ball.height = contactHeight;
    state.ball.lastAction = "shot";
    player.kickCooldown = 0.48;
    player.memory.stats.shots += 1;
    state.stats[player.team].shots += 1;
    if (action.preparedPassId !== undefined) state.stats[player.team].firstTimeShots += 1;
    if (technique === "header") state.stats[player.team].headers += 1;
    if (technique === "volley") state.stats[player.team].volleys += 1;
    if (distance(player.position, action.target) > FIELD.width * 0.29) state.stats[player.team].longShots += 1;
    const goalLineX = player.team === "blue" ? FIELD.width : 0;
    const goalPoint = predictShotPoint(state.ball.position, state.ball.velocity, state.ball.height, state.ball.verticalVelocity, solution.duration);
    state.ball.lastShotOnTarget = solution.duration > 0
      && goalPoint.position.y > FIELD.goalTop && goalPoint.position.y < FIELD.goalBottom
      && goalPoint.height >= 0 && goalPoint.height < FIELD.goalHeight;
    if (state.ball.lastShotOnTarget) state.stats[player.team].shotsOnTarget += 1;
    const shotId = ++state.shotCounter;
    state.activeShot = {
      id: shotId,
      shooterId: player.profile.id,
      team: player.team,
      startedAt: state.elapsed,
      technique,
      target: executedTarget,
      targetHeight: requestedHeight,
      expectedArrivalAt: state.elapsed + solution.duration,
      expectedSpeed: solution.arrivalSpeed,
      goalPoint: { position: { x: goalLineX, y: goalPoint.position.y }, height: goalPoint.height },
      onTarget: state.ball.lastShotOnTarget,
      goalkeeperTouched: false,
    };
    const goalkeeper = state.players.find((candidate) => candidate.team !== player.team && candidate.profile.position === "goalkeeper");
    emitCognitiveEvent(state, "shotCommitted", goalkeeper ? [goalkeeper.profile.id] : null, { shotId });
    emitMatchEvent(state, { type: "shot-taken", team: player.team, playerId: player.profile.id });
    return;
  }
  const baseQuality = (player.profile.skills.passing * 0.68 + player.profile.skills.vision * 0.32) / 100;
  const passDistance = distance(state.ball.position, action.target);
  const distanceDifficulty = action.range === "long" ? clamp(passDistance / FIELD.width, 0.08, 0.34) * 0.42 + 0.015 : 0;
  const difficulty = distanceDifficulty + (action.trajectory === "air" ? 0.07 : action.range === "short" ? 0.12 : 0)
    + pressure * 0.2 + (1 - player.stamina) * 0.12;
  const quality = clamp(baseQuality - difficulty, 0.18, 0.97);
  const angularError = action.range === "long" ? 0.56 : action.trajectory === "air" ? 0.48 : 0.82;
  const direction = rotate(normalize(subtract(action.target, state.ball.position)), signedMatchNoise(state) * (1 - quality) * angularError);
  const distancePower = clamp(passDistance / (action.range === "long" ? 76 : 48), 0, 1);
  const chosenPower = clamp(Math.max(action.power, 0.44 + distancePower * 0.44), 0.42, 1);
  const executedTarget = targetAlongDirection(state.ball.position, action.target, direction);
  const solution = solvePassTrajectory(state.ball.position, executedTarget, action.trajectory, action.range, action.targeting, chosenPower);
  releaseBall(state, player, normalize(solution.velocity), length(solution.velocity), solution.verticalVelocity);
  state.ball.lastAction = "pass";
  state.activeShot = null;
  state.ball.lastShotOnTarget = false;
  player.kickCooldown = 0.4;
  state.stats[player.team].passes += 1;
  if (action.range === "long") state.stats[player.team].longPasses += 1;
  if (action.trajectory === "air") state.stats[player.team].aerialPasses += 1;
  const progress = (player.team === "blue" ? 1 : -1) * (action.target.x - player.position.x);
  if (progress > FIELD.width * 0.15) state.stats[player.team].lineBreaks += 1;
  const crossesCenter = (player.position.y - FIELD.height / 2) * (action.target.y - FIELD.height / 2) < 0;
  if (crossesCenter && Math.abs(action.target.y - player.position.y) > FIELD.height * 0.3) state.stats[player.team].switches += 1;
  const passId = ++state.passCounter;
  const purpose = action.purpose ?? "feet";
  state.pendingPass = {
    id: passId,
    passerId: player.profile.id,
    receiverId: action.receiverId,
    team: player.team,
    startedAt: state.elapsed,
    trajectory: action.trajectory,
    range: action.range,
    targeting: action.targeting,
    purpose,
    selectionReason: action.selectionReason ?? "progressivePass",
    target: executedTarget,
    landingPoint: solution.landingPoint,
    expectedArrivalAt: state.elapsed + solution.duration,
    receiverEta: action.receiverEta ?? solution.duration,
    opponentEta: action.opponentEta ?? solution.duration,
    expectedHeight: action.trajectory === "air" ? 1.2 : 0,
    expectedSpeed: length(solution.velocity) * Math.exp(-(action.trajectory === "air" ? PHYSICS.airBallDrag : PHYSICS.ballDrag) * solution.duration),
  };
  if (purpose === "cross") state.stats[player.team].crosses += 1;
  else if (purpose === "cutback") state.stats[player.team].cutbacks += 1;
  else if (purpose === "throughBall") state.stats[player.team].throughBalls += 1;
  emitCognitiveEvent(state, "passCommitted", [action.receiverId, ...relevantPlayersNear(state, solution.landingPoint)], { passId });
};

const attachControlledBall = (state: MatchState, player: PlayerRuntime, dt: number): void => {
  const facing = length(player.facing) > 0 ? player.facing : { x: player.team === "blue" ? 1 : -1, y: 0 };
  const target = add(player.position, scale(facing, player.radius + state.ball.radius + 0.15));
  const error = subtract(target, state.ball.position);
  const correction = limit(
    scale(error, 1 - Math.exp(-PHYSICS.controlSpring * dt)),
    PHYSICS.controlledBallRepositionSpeed * dt,
  );
  const blend = clamp(1 - Math.exp(-PHYSICS.controlSpring * dt), 0, 1);
  state.ball.position = add(state.ball.position, correction);
  state.ball.velocity = add(scale(state.ball.velocity, 1 - blend), scale(player.velocity, blend));
  state.ball.height = 0;
  state.ball.verticalVelocity = 0;
};

const actionDirection = (player: PlayerRuntime, action: BallAction): Vec2 | null => {
  if (action.kind === "none") return null;
  return normalize(subtract(action.target, player.position));
};

const prepareControlledBall = (player: PlayerRuntime, decision: AgentDecision, dt: number): boolean => {
  const desired = actionDirection(player, decision.ballAction);
  if (!desired || length(desired) < 0.001) return true;
  const current = length(player.facing) > 0.001 ? player.facing : { x: player.team === "blue" ? 1 : -1, y: 0 };
  const remainingAngle = Math.acos(clamp(dot(current, desired), -1, 1));
  const maximumTurn = PHYSICS.ballCarryTurnRate * (decision.ballAction.kind === "dribble" ? 0.45 : 1) * dt;
  if (remainingAngle <= maximumTurn) {
    player.facing = desired;
  } else {
    const cross = current.x * desired.y - current.y * desired.x;
    const turnSign = Math.abs(cross) > 0.0001 ? Math.sign(cross) : player.team === "blue" ? 1 : -1;
    player.facing = rotate(current, maximumTurn * turnSign);
  }
  if (decision.ballAction.kind === "dribble") return true;
  return dot(player.facing, desired) > PHYSICS.ballActionAlignment;
};

export const updateControlledBall = (state: MatchState, decisions: Map<string, AgentDecision>, dt: number): void => {
  const controller = state.players.find((player) => player.profile.id === state.ball.controllerId);
  if (!controller) return;
  const decision = decisions.get(controller.profile.id)!;
  const actionReady = prepareControlledBall(controller, decision, dt);
  attachControlledBall(state, controller, dt);
  const firstTouchSettled = state.elapsed - state.ball.controlStartedAt >= PHYSICS.firstTouchSettleTime;
  if (actionReady && firstTouchSettled) executeBallAction(state, controller, decision.ballAction);
};

const resetPositions = (state: MatchState, kickoffTeam: Team): void => {
  const restartOffset = signedMatchNoise(state) * 5;
  for (const player of state.players) {
    player.position = formationAnchor(player);
    player.position.y = clamp(player.position.y + restartOffset * (player.team === "blue" ? 0.2 : -0.2), 4, FIELD.height - 4);
    player.velocity = { x: 0, y: 0 };
    player.facing = { x: player.team === "blue" ? 1 : -1, y: 0 };
    player.kickCooldown = 0;
    player.sprintTimer = 0;
    player.sprintCooldown = 0;
    player.dribbleTouchCooldown = 0;
    player.reactionTimer = 0;
    player.duelCooldown = 0;
    player.controlCooldown = 0;
    player.plan = null;
    player.objective = null;
    player.objectiveExpiresAt = 0;
    player.goalkeeperAttempt = null;
    player.goalkeeperRecoveryUntil = 0;
    player.nextThinkAt = state.elapsed;
    player.pace = "walk";
    // Bola parada dá fôlego para a volátil; a longa (fôlego de partida) não recupera.
    player.sprintEnergy = Math.min(1, player.sprintEnergy + STAMINA.volatileDeadBallRecovery);
  }
  state.ball.position = { x: kickoffTeam === "blue" ? FIELD.width / 2 - 1.5 : FIELD.width / 2 + 1.5, y: FIELD.height / 2 + restartOffset };
  state.ball.velocity = { x: 0, y: 0 };
  state.ball.height = 0;
  state.ball.verticalVelocity = 0;
  state.ball.lastTouch = null;
  state.ball.lastTouchPlayerId = null;
  state.ball.controllerId = null;
  clearDribbleOwner(state);
  state.ball.controlStartedAt = 0;
  state.ball.lastAction = null;
  state.ball.lastShotOnTarget = false;
  state.ballControlTeam = null;
  state.possessionTeam = null;
  state.possessionCandidateTeam = null;
  state.possessionCandidateSince = state.elapsed;
  if (state.pendingPass) emitCognitiveEvent(state, "passResolved", null, { passId: state.pendingPass.id, outcome: "out" });
  state.pendingPass = null;
  state.activeShot = null;
  clearGoalkeeperAttempts(state);
  state.feintEvasion = null;
  state.kickoffTimer = 1.15;
  state.nextCognitionAt = state.elapsed;
};

const otherTeam = (team: Team): Team => team === "blue" ? "coral" : "blue";
const fieldRestartMargin = (): number => Math.max(8, FIELD.goalAreaDepth * 0.55);

const restartPlay = (
  state: MatchState,
  team: Team,
  kind: "throwIn" | "corner" | "goalKick",
  exitPosition: Vec2,
): void => {
  const eligible = state.players.filter((player) => player.team === team && (kind === "goalKick"
    ? player.profile.position === "goalkeeper"
    : player.profile.position !== "goalkeeper"));
  const restarter = [...eligible].sort((a, b) => distance(a.position, exitPosition) - distance(b.position, exitPosition))[0];
  if (!restarter) return;
  const attacksRight = team === "blue";
  let restartPosition: Vec2;
  let facing: Vec2;
  if (kind === "throwIn") {
    const top = exitPosition.y < FIELD.height / 2;
    restartPosition = { x: clamp(exitPosition.x, fieldRestartMargin(), FIELD.width - fieldRestartMargin()), y: top ? 5 : FIELD.height - 5 };
    facing = normalize({ x: attacksRight ? 0.35 : -0.35, y: top ? 1 : -1 });
  } else if (kind === "corner") {
    const fromLeft = exitPosition.x < FIELD.width / 2;
    const top = exitPosition.y < FIELD.height / 2;
    restartPosition = { x: fromLeft ? 5 : FIELD.width - 5, y: top ? 5 : FIELD.height - 5 };
    facing = normalize({ x: fromLeft ? 1 : -1, y: top ? 1 : -1 });
  } else {
    const ownLeft = team === "blue";
    restartPosition = { x: ownLeft ? FIELD.goalAreaDepth * 0.72 : FIELD.width - FIELD.goalAreaDepth * 0.72, y: FIELD.height / 2 };
    facing = { x: ownLeft ? 1 : -1, y: 0 };
  }
  restarter.position = restartPosition;
  restarter.velocity = { x: 0, y: 0 };
  restarter.facing = facing;
  restarter.kickCooldown = 0;
  const releaseDistance = restarter.radius + state.ball.radius + 0.15;
  state.ball.position = add(restarter.position, scale(facing, releaseDistance));
  state.ball.velocity = { x: 0, y: 0 };
  state.ball.height = 0;
  state.ball.verticalVelocity = 0;
  state.ball.controllerId = restarter.profile.id;
  clearDribbleOwner(state);
  state.ball.controlStartedAt = state.elapsed;
  state.ball.lastTouch = team;
  state.ball.lastTouchPlayerId = restarter.profile.id;
  state.ball.lastAction = null;
  state.ball.lastShotOnTarget = false;
  registerControlledTeam(state, team, true);
  if (state.pendingPass) emitCognitiveEvent(state, "passResolved", null, { passId: state.pendingPass.id, outcome: "out" });
  state.pendingPass = null;
  state.activeShot = null;
  clearGoalkeeperAttempts(state);
  state.feintEvasion = null;
  state.kickoffTimer = 0.72;
  emitMatchEvent(state, { type: "restart-awarded", team, restartKind: kind });
};

const registerGoal = (state: MatchState, scorerTeam: Team): void => {
  const conceding: Team = scorerTeam === "blue" ? "coral" : "blue";
  const activeShooter = state.activeShot?.team === scorerTeam ? state.activeShot.shooterId : null;
  const scorer = state.players.find((player) => player.profile.id === (activeShooter ?? state.ball.lastTouchPlayerId) && player.team === scorerTeam);
  const origin = state.activeShot?.team === scorerTeam ? "shot" : state.ball.lastAction ?? "dribble";
  state.stats[scorerTeam].goals += 1;
  if (origin === "shot") state.stats[scorerTeam].goalsFromShots += 1;
  else if (origin === "pass") state.stats[scorerTeam].goalsFromPasses += 1;
  else state.stats[scorerTeam].goalsFromDribbles += 1;
  state.stats[scorerTeam].reward += 1;
  state.stats[conceding].reward -= 1;
  if (scorer) {
    scorer.memory.stats.goals += 1;
    const learningAmount = state.learningEnabled ? 0.009 : 0;
    adaptPlayerPolicy(scorer, origin === "shot" ? "shoot" : origin === "pass" ? "pass" : "dribble", learningAmount);
  }
  const assist = state.lastAssist && state.lastAssist.team === scorerTeam && state.elapsed - state.lastAssist.time < 8
    ? state.players.find((player) => player.profile.id === state.lastAssist?.playerId)
    : null;
  if (assist && assist.profile.id !== scorer?.profile.id) assist.memory.stats.assists += 1;
  emitMatchEvent(state, { type: "goal-scored", team: scorerTeam, playerId: scorer?.profile.id ?? null, origin });
  state.lastAssist = null;
  resetPositions(state, conceding);
};

export const updateBall = (state: MatchState, dt: number): void => {
  const ball = state.ball;
  const previousPosition = { ...ball.position };
  const previousHeight = ball.height;
  const airborne = ball.height > 0 || ball.verticalVelocity > 0;
  const drag = airborne ? PHYSICS.airBallDrag : PHYSICS.ballDrag;
  ball.velocity = scale(ball.velocity, Math.exp(-drag * dt));
  ball.position = add(ball.position, scale(ball.velocity, dt));
  if (airborne) {
    ball.verticalVelocity -= PHYSICS.gravity * dt;
    ball.height += ball.verticalVelocity * dt;
    if (resolveGoalkeeperContact(state, previousPosition, previousHeight, dt) && ball.controllerId) return;
    if (ball.height <= 0) {
      const impactSpeed = Math.abs(ball.verticalVelocity);
      const reboundSpeed = impactSpeed * PHYSICS.ballBounce;
      ball.height = 0;
      ball.velocity = scale(ball.velocity, PHYSICS.landingFriction);
      ball.verticalVelocity = impactSpeed > 3 && reboundSpeed > 2.2 ? reboundSpeed : 0;
      if (state.pendingPass && impactSpeed > 3) {
        emitCognitiveEvent(state, "ballTrajectoryChanged", relevantPlayersNear(state, ball.position), { passId: state.pendingPass.id });
      }
    }
  } else if (resolveGoalkeeperContact(state, previousPosition, previousHeight, dt) && ball.controllerId) return;
  const crossingAt = (goalX: number): { y: number; height: number } => {
    const travelX = ball.position.x - previousPosition.x;
    const amount = Math.abs(travelX) > 0.0001 ? clamp((goalX - previousPosition.x) / travelX, 0, 1) : 1;
    return {
      y: previousPosition.y + (ball.position.y - previousPosition.y) * amount,
      height: Math.max(0, previousHeight + (ball.height - previousHeight) * amount),
    };
  };
  if (ball.position.x < -ball.radius) {
    const crossing = crossingAt(0);
    const inGoal = crossing.y > FIELD.goalTop && crossing.y < FIELD.goalBottom;
    if (inGoal && crossing.height < FIELD.goalHeight) registerGoal(state, "coral");
    else if (!inGoal) {
      const defendingTeam: Team = "blue";
      const restartTeam = ball.lastTouch === defendingTeam ? otherTeam(defendingTeam) : defendingTeam;
      restartPlay(state, restartTeam, restartTeam === defendingTeam ? "goalKick" : "corner", ball.position);
    } else ball.velocity.x = Math.abs(ball.velocity.x);
    return;
  }
  if (ball.position.x > FIELD.width + ball.radius) {
    const crossing = crossingAt(FIELD.width);
    const inGoal = crossing.y > FIELD.goalTop && crossing.y < FIELD.goalBottom;
    if (inGoal && crossing.height < FIELD.goalHeight) registerGoal(state, "blue");
    else if (!inGoal) {
      const defendingTeam: Team = "coral";
      const restartTeam = ball.lastTouch === defendingTeam ? otherTeam(defendingTeam) : defendingTeam;
      restartPlay(state, restartTeam, restartTeam === defendingTeam ? "goalKick" : "corner", ball.position);
    } else ball.velocity.x = -Math.abs(ball.velocity.x);
    return;
  }
  if (ball.position.y < -ball.radius || ball.position.y > FIELD.height + ball.radius) {
    const restartTeam = ball.lastTouch ? otherTeam(ball.lastTouch) : (ball.position.x < FIELD.width / 2 ? "blue" : "coral");
    restartPlay(state, restartTeam, "throwIn", ball.position);
  }
};
