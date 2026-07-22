import { FIELD, GOALKEEPING, PHYSICS } from "../config";
import { add, clamp, distance, length, limit, normalize, scale, subtract } from "../../shared/math";
import type { AgentDecision, MatchState, PlayerRuntime } from "../model";
import { playerSkillAcceleration, playerSkillSpeed } from "../runtime/player-metrics";

export const playerSpeedLimit = (player: PlayerRuntime, controlsBall: boolean, running = false): number => {
  const factor = controlsBall
    ? player.sprintTimer > 0 ? PHYSICS.controlledSprintSpeedFactor : PHYSICS.controlledSpeedFactor
    : player.sprintTimer > 0 ? PHYSICS.burstSpeedFactor : running ? PHYSICS.runSpeedFactor : PHYSICS.walkSpeedFactor;
  return playerSkillSpeed(player) * factor;
};

const updatePlayer = (state: MatchState, player: PlayerRuntime, decision: AgentDecision, controlsBall: boolean, dt: number): void => {
  player.posture = decision.posture;
  player.intent = decision.intent;
  player.decisionReason = decision.reason;
  player.kickCooldown = Math.max(0, player.kickCooldown - dt);
  player.sprintCooldown = Math.max(0, player.sprintCooldown - dt);
  player.dribbleTouchCooldown = Math.max(0, player.dribbleTouchCooldown - dt);
  player.sprintTimer = Math.max(0, player.sprintTimer - dt);
  player.reactionTimer = Math.max(0, player.reactionTimer - dt);
  player.duelCooldown = Math.max(0, player.duelCooldown - dt);
  player.controlCooldown = Math.max(0, player.controlCooldown - dt);
  if (decision.burst && player.sprintCooldown <= 0 && player.energy > 0.52) {
    player.sprintTimer = decision.burstDuration ?? PHYSICS.burstDuration;
    player.sprintCooldown = PHYSICS.burstCooldown;
  }
  const baseSpeed = playerSkillSpeed(player);
  const goalkeeperSaving = decision.intent === "diving" || decision.intent === "jumping" || decision.intent === "claimingHighBall";
  const movementGap = distance(decision.movementTarget, player.position);
  const running = !controlsBall && (
    movementGap > FIELD.width * 0.095
    || decision.intent === "pressing"
    || decision.intent === "receiving"
    || decision.intent === "sprinting"
    || decision.intent === "knockingOn"
    || decision.intent === "feinting"
    || goalkeeperSaving
  );
  const speedFactor = controlsBall
    ? player.sprintTimer > 0 ? PHYSICS.controlledSprintSpeedFactor : PHYSICS.controlledSpeedFactor
    : goalkeeperSaving ? GOALKEEPING.diveSpeedFactor
      : player.sprintTimer > 0 ? PHYSICS.burstSpeedFactor : running ? PHYSICS.runSpeedFactor : PHYSICS.walkSpeedFactor;
  player.pace = goalkeeperSaving || player.sprintTimer > 0 ? "burst" : controlsBall ? "closeControl" : running ? "run" : "walk";
  const maximumSpeed = baseSpeed * speedFactor;
  const remainingSaveTime = goalkeeperSaving && player.goalkeeperAttempt
    ? Math.max(dt, player.goalkeeperAttempt.contactAt - state.elapsed)
    : null;
  const desiredSpeed = remainingSaveTime === null
    ? maximumSpeed
    : Math.min(maximumSpeed, movementGap / remainingSaveTime * 2);
  const desired = scale(normalize(subtract(decision.movementTarget, player.position)), desiredSpeed);
  const steering = subtract(desired, player.velocity);
  const reactionFactor = player.reactionTimer > 0 ? 0.38 : 1;
  const burstAcceleration = goalkeeperSaving ? GOALKEEPING.diveAccelerationFactor : player.sprintTimer > 0 ? PHYSICS.burstAccelerationFactor : 1;
  const acceleration = scale(normalize(steering), playerSkillAcceleration(player) * (0.72 + player.energy * 0.28) * reactionFactor * burstAcceleration);
  player.velocity = add(player.velocity, scale(acceleration, dt));
  player.velocity = scale(player.velocity, Math.exp(-PHYSICS.playerDrag * dt));
  player.velocity = limit(player.velocity, maximumSpeed * (player.reactionTimer > 0 ? 0.7 : 1));
  player.position = add(player.position, scale(player.velocity, dt));
  const speed = length(player.velocity);
  if (speed > 0.3 && (!controlsBall || decision.ballAction.kind === "dribble")) player.facing = normalize(player.velocity);
  const stamina = player.profile.skills.stamina / 100;
  const effortCost = 0.85 + player.profile.mental.intensity / 200;
  const recovery = 0.022 + stamina * 0.01 + clamp((0.72 - player.energy) * 0.45, 0, 0.125);
  const energyDelta = player.sprintTimer > 0
    ? -(0.035 - stamina * 0.0137)
    : running
      ? -(0.0042 - stamina * 0.0024)
      : recovery;
  player.energy = clamp(player.energy + energyDelta * (energyDelta < 0 ? effortCost : 1) * dt, 0.35, 1);
  player.position.x = clamp(player.position.x, player.radius, FIELD.width - player.radius);
  player.position.y = clamp(player.position.y, player.radius, FIELD.height - player.radius);
};

export const updatePlayers = (state: MatchState, decisions: Map<string, AgentDecision>, dt: number): void => {
  for (const player of state.players) {
    const decision = decisions.get(player.profile.id)!;
    updatePlayer(state, player, decision, state.ball.controllerId === player.profile.id, dt);
    state.stats[player.team].distanceCovered += length(player.velocity) * dt;
  }
};

export const clampPlayersToField = (state: MatchState): void => {
  for (const player of state.players) {
    player.position.x = clamp(player.position.x, player.radius, FIELD.width - player.radius);
    player.position.y = clamp(player.position.y, player.radius, FIELD.height - player.radius);
  }
};
