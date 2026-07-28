import { PHYSICS, TACTICS } from "../config";
import type { MatchState, PlayerRuntime, Vec2 } from "../model";
import { add, clamp, closestPointOnSegment, distance, length, scale } from "../../shared/math";
import { playerSkillAcceleration, playerSkillSpeed } from "./player-metrics";
import { clampToField } from "./pitch";

export const predictionHorizon = (player: PlayerRuntime, urgency = 0.5): number => {
  const anticipation = player.profile.mental.anticipation / 100;
  const decision = player.profile.mental.decisionMaking / 100;
  return clamp(
    TACTICS.predictionMinSeconds + anticipation * 0.72 + decision * 0.28 - urgency * 0.22,
    TACTICS.predictionMinSeconds,
    TACTICS.predictionMaxSeconds,
  );
};

export const predictPlayerPosition = (player: PlayerRuntime, seconds: number): Vec2 => {
  const travelFactor = PHYSICS.playerDrag > 0
    ? (1 - Math.exp(-PHYSICS.playerDrag * seconds)) / PHYSICS.playerDrag
    : seconds;
  return clampToField(add(player.position, scale(player.velocity, travelFactor)), player.radius);
};

const planTargetPosition = (state: MatchState, player: PlayerRuntime): Vec2 | null => {
  const target = player.plan?.target;
  if (!target) return null;
  if (target.kind === "point") return target.position;
  if (target.kind === "ball") return add(state.ball.position, target.offset);
  if (target.kind === "player") {
    const targetPlayer = state.players.find((candidate) => candidate.profile.id === target.playerId);
    return targetPlayer ? add(targetPlayer.position, target.offset) : null;
  }
  return null;
};

export const predictPlayerAlongPlan = (state: MatchState, player: PlayerRuntime, seconds: number): Vec2 => {
  const target = planTargetPosition(state, player);
  if (!target || seconds <= 0) return predictPlayerPosition(player, seconds);
  const steps = 6;
  const dt = seconds / steps;
  let position = { ...player.position };
  let velocity = { ...player.velocity };
  const burst = player.sprintTimer > 0 || player.plan?.burst;
  const speedFactor = burst ? PHYSICS.burstSpeedFactor : PHYSICS.runSpeedFactor;
  const maximumSpeed = playerSkillSpeed(player) * speedFactor;
  const acceleration = playerSkillAcceleration(player) * (burst ? PHYSICS.burstAccelerationFactor : 1);
  for (let step = 0; step < steps; step += 1) {
    const delta = { x: target.x - position.x, y: target.y - position.y };
    const gap = length(delta);
    if (gap < player.radius) break;
    const desired = scale(delta, maximumSpeed / Math.max(0.001, gap));
    const steering = { x: desired.x - velocity.x, y: desired.y - velocity.y };
    const steeringLength = length(steering);
    if (steeringLength > 0.001) velocity = add(velocity, scale(steering, acceleration * dt / steeringLength));
    velocity = scale(velocity, Math.exp(-PHYSICS.playerDrag * dt));
    const speed = length(velocity);
    if (speed > maximumSpeed) velocity = scale(velocity, maximumSpeed / speed);
    position = add(position, scale(velocity, dt));
  }
  return clampToField(position, player.radius);
};

export const predictBallPosition = (state: MatchState, seconds: number): Vec2 => {
  const controller = state.players.find((player) => player.profile.id === state.ball.controllerId);
  if (controller) {
    const playerPosition = predictPlayerPosition(controller, seconds);
    return clampToField(add(playerPosition, scale(controller.facing, controller.radius + state.ball.radius + 0.15)), state.ball.radius);
  }
  const drag = state.ball.height > 0 || state.ball.verticalVelocity > 0 ? PHYSICS.airBallDrag : PHYSICS.ballDrag;
  const travelFactor = drag > 0 ? (1 - Math.exp(-drag * seconds)) / drag : seconds;
  return clampToField(add(state.ball.position, scale(state.ball.velocity, travelFactor)), state.ball.radius);
};

export const estimateBallTravelTime = (distanceToTarget: number, aerial = false): number =>
  clamp(distanceToTarget / (aerial ? 38 : 32), 0.18, TACTICS.predictionMaxSeconds);

export const predictedSpaceAt = (
  position: Vec2,
  opponents: PlayerRuntime[],
  seconds: number,
): number => Math.min(...opponents.map((opponent) => distance(position, predictPlayerPosition(opponent, seconds))));

/**
 * Risco que UM adversário oferece à rota: quanto ele chega perto dela, e onde. Por adversário e
 * não em bloco porque a bola erguida passa por cima de quem está no meio do caminho e não de quem
 * está nas pontas — quem soma precisa poder olhar a altura da bola sobre cada corpo.
 */
export const interceptionRisk = (
  start: Vec2,
  end: Vec2,
  opponent: PlayerRuntime,
  travelSeconds: number,
): { risk: number; atFraction: number } => {
  const future = predictPlayerPosition(opponent, travelSeconds * 0.62);
  const closest = closestPointOnSegment(start, end, future);
  const reach = opponent.radius + 1.2 + length(opponent.velocity) * travelSeconds * 0.22
    + opponent.profile.skills.acceleration / 100 * travelSeconds * 3.4;
  return {
    risk: clamp(1 - distance(future, closest.point) / Math.max(1, reach), 0, 1),
    atFraction: closest.amount,
  };
};

export const interceptionThreat = (
  start: Vec2,
  end: Vec2,
  opponents: PlayerRuntime[],
  travelSeconds: number,
): number => {
  // Rota degenerada não tem o que interceptar — e o guarda também poupa a projeção de todo mundo.
  const segment = { x: end.x - start.x, y: end.y - start.y };
  if (segment.x * segment.x + segment.y * segment.y < 0.001) return 0;
  return opponents.reduce((risk, opponent) =>
    risk + interceptionRisk(start, end, opponent, travelSeconds).risk, 0);
};
