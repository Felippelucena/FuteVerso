import { FIELD, PHYSICS } from "../config";
import { add, clamp, distance, length, limit, normalize, scale, subtract } from "../../shared/math";
import type { AgentDecision, MatchState, PlayerRuntime } from "../model";
import { playerSkillAcceleration, playerSkillSpeed } from "../runtime/player-metrics";

export const playerSpeedLimit = (player: PlayerRuntime, controlsBall: boolean, running = false): number => {
  const factor = controlsBall
    ? player.sprintTimer > 0 ? PHYSICS.controlledSprintSpeedFactor : PHYSICS.controlledSpeedFactor
    : player.sprintTimer > 0 ? PHYSICS.burstSpeedFactor : running ? PHYSICS.runSpeedFactor : PHYSICS.walkSpeedFactor;
  return playerSkillSpeed(player) * factor;
};

const updatePlayer = (player: PlayerRuntime, decision: AgentDecision, controlsBall: boolean, dt: number): void => {
  player.posture = decision.posture;
  player.intent = decision.intent;
  player.decisionReason = decision.reason;
  player.kickCooldown = Math.max(0, player.kickCooldown - dt);
  player.sprintCooldown = Math.max(0, player.sprintCooldown - dt);
  player.sprintTimer = Math.max(0, player.sprintTimer - dt);
  player.reactionTimer = Math.max(0, player.reactionTimer - dt);
  player.duelCooldown = Math.max(0, player.duelCooldown - dt);
  player.controlCooldown = Math.max(0, player.controlCooldown - dt);
  if (decision.burst && player.sprintCooldown <= 0 && player.energy > 0.48) {
    player.sprintTimer = decision.burstDuration ?? PHYSICS.burstDuration;
    player.sprintCooldown = PHYSICS.burstCooldown;
  }
  const baseSpeed = playerSkillSpeed(player);
  const movementGap = distance(decision.movementTarget, player.position);
  const running = !controlsBall && (
    movementGap > FIELD.width * 0.095
    || decision.intent === "pressing"
    || decision.intent === "sprinting"
    || decision.intent === "knockingOn"
    || decision.intent === "feinting"
  );
  const speedFactor = controlsBall
    ? player.sprintTimer > 0 ? PHYSICS.controlledSprintSpeedFactor : PHYSICS.controlledSpeedFactor
    : player.sprintTimer > 0 ? PHYSICS.burstSpeedFactor : running ? PHYSICS.runSpeedFactor : PHYSICS.walkSpeedFactor;
  player.pace = player.sprintTimer > 0 ? "burst" : controlsBall ? "closeControl" : running ? "run" : "walk";
  const desired = scale(normalize(subtract(decision.movementTarget, player.position)), baseSpeed * speedFactor);
  const steering = subtract(desired, player.velocity);
  const reactionFactor = player.reactionTimer > 0 ? 0.38 : 1;
  const burstAcceleration = player.sprintTimer > 0 ? PHYSICS.burstAccelerationFactor : 1;
  const acceleration = scale(normalize(steering), playerSkillAcceleration(player) * (0.72 + player.energy * 0.28) * reactionFactor * burstAcceleration);
  player.velocity = add(player.velocity, scale(acceleration, dt));
  player.velocity = scale(player.velocity, Math.exp(-PHYSICS.playerDrag * dt));
  player.velocity = limit(player.velocity, baseSpeed * speedFactor * (player.reactionTimer > 0 ? 0.7 : 1));
  player.position = add(player.position, scale(player.velocity, dt));
  const speed = length(player.velocity);
  if (speed > 0.3 && (!controlsBall || decision.ballAction.kind === "dribble")) player.facing = normalize(player.velocity);
  const stamina = player.profile.skills.stamina / 100;
  const effortCost = 0.85 + player.profile.mental.intensity / 200;
  const energyDelta = player.sprintTimer > 0
    ? -(0.14 - stamina * 0.045)
    : running
      ? -(0.026 - stamina * 0.018)
      : 0.032 + stamina * 0.012;
  player.energy = clamp(player.energy + energyDelta * (energyDelta < 0 ? effortCost : 1) * dt, 0.35, 1);
  player.position.x = clamp(player.position.x, player.radius, FIELD.width - player.radius);
  player.position.y = clamp(player.position.y, player.radius, FIELD.height - player.radius);
};

export const updatePlayers = (state: MatchState, decisions: Map<string, AgentDecision>, dt: number): void => {
  for (const player of state.players) {
    const decision = decisions.get(player.profile.id)!;
    updatePlayer(player, decision, state.ball.controllerId === player.profile.id, dt);
    state.stats[player.team].distanceCovered += length(player.velocity) * dt;
  }
};

export const clampPlayersToField = (state: MatchState): void => {
  for (const player of state.players) {
    player.position.x = clamp(player.position.x, player.radius, FIELD.width - player.radius);
    player.position.y = clamp(player.position.y, player.radius, FIELD.height - player.radius);
  }
};
