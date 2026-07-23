import { FIELD, PHYSICS } from "../config";
import type { DribbleRangeReason, DribbleTouchRange, MatchState, PlayerRuntime, Vec2 } from "../model";
import { clamp, distance } from "../../shared/math";
import { predictPlayerAlongPlan } from "./prediction";
import { playerSkillSpeed } from "./player-metrics";

export interface ForwardRunway {
  direction: Vec2;
  distance: number;
  fieldDistance: number;
  blockerId: string | null;
}

export interface DribbleTouchChoice {
  range: DribbleTouchRange | null;
  target: Vec2;
  touchDistance: number;
  runway: number;
  carrierEta: number;
  opponentEta: number;
  reason: DribbleRangeReason;
}

// Gates de energia leem a barra volátil (piques). Avançar em espaço = knock-on por padrão,
// então os limiares de corredor/energia são baixos; a bola colada (carry) fica de reserva
// para apertado/pressão/finta.
const RANGE_RULES = [
  { range: "long", runway: 40, minimum: 25, maximum: 38, energy: 0.5, raceMargin: 0.55, fraction: 0.72 },
  { range: "medium", runway: 26, minimum: 16, maximum: 24, energy: 0.4, raceMargin: 0.3, fraction: 0.68 },
  { range: "short", runway: 10, minimum: 8, maximum: 13, energy: 0.26, raceMargin: 0, fraction: 0.62 },
] as const;

const opponentEtaAt = (state: MatchState, player: PlayerRuntime, target: Vec2): number => Math.min(
  ...state.players.filter((candidate) => candidate.team !== player.team).map((opponent) =>
    distance(opponent.position, target) / Math.max(1, playerSkillSpeed(opponent) * PHYSICS.runSpeedFactor)),
);

export const evaluateForwardRunway = (state: MatchState, player: PlayerRuntime): ForwardRunway => {
  const direction = { x: player.team === "blue" ? 1 : -1, y: 0 };
  const fieldDistance = direction.x > 0 ? FIELD.width - 5 - player.position.x : player.position.x - 5;
  const maximumDistance = Math.max(0, Math.min(45, fieldDistance));
  let blockerId: string | null = null;
  let blockerDistance = maximumDistance;
  for (const opponent of state.players.filter((candidate) => candidate.team !== player.team)) {
    const currentForward = (opponent.position.x - player.position.x) * direction.x;
    if (currentForward <= 0 || currentForward >= blockerDistance + opponent.radius) continue;
    const carrierEta = currentForward / Math.max(1, playerSkillSpeed(player) * PHYSICS.burstSpeedFactor);
    const future = predictPlayerAlongPlan(state, opponent, clamp(carrierEta, 0.12, 1.8));
    const futureForward = (future.x - player.position.x) * direction.x;
    const corridorHalfWidth = player.radius + opponent.radius + FIELD.ballRadius + 1.25;
    if (futureForward <= 0 || Math.abs(future.y - player.position.y) > corridorHalfWidth) continue;
    blockerDistance = Math.max(0, Math.min(currentForward, futureForward) - opponent.radius - FIELD.ballRadius);
    blockerId = opponent.profile.id;
  }
  return { direction, distance: Math.min(maximumDistance, blockerDistance), fieldDistance, blockerId };
};

export const chooseDribbleTouch = (
  state: MatchState,
  player: PlayerRuntime,
  runway = evaluateForwardRunway(state, player),
): DribbleTouchChoice => {
  let reductionReason: DribbleRangeReason | null = null;
  for (const rule of RANGE_RULES) {
    if (runway.distance < rule.runway) continue;
    if (player.dribbleTouchCooldown > 0) {
      reductionReason ??= "touchCooldown";
      continue;
    }
    // A energia volátil é o limitador do avanço em piques — não um cooldown fixo.
    if (player.sprintEnergy <= rule.energy) {
      reductionReason ??= "reducedForEnergy";
      continue;
    }
    const touchDistance = clamp(runway.distance * rule.fraction, rule.minimum, Math.min(rule.maximum, runway.fieldDistance));
    const target = {
      x: clamp(player.position.x + runway.direction.x * touchDistance, 5, FIELD.width - 5),
      y: player.position.y,
    };
    const carrierEta = touchDistance / Math.max(1, playerSkillSpeed(player) * PHYSICS.burstSpeedFactor);
    const opponentEta = opponentEtaAt(state, player, target);
    if (opponentEta <= carrierEta + rule.raceMargin) {
      reductionReason ??= "reducedForRace";
      continue;
    }
    return {
      range: rule.range,
      target,
      touchDistance,
      runway: runway.distance,
      carrierEta,
      opponentEta,
      reason: reductionReason ?? "clearRunway",
    };
  }
  const fallbackDistance = Math.min(9, runway.distance, runway.fieldDistance);
  const fallbackTarget = {
    x: clamp(player.position.x + runway.direction.x * Math.max(0, fallbackDistance), 5, FIELD.width - 5),
    y: player.position.y,
  };
  const carrierEta = fallbackDistance / Math.max(1, playerSkillSpeed(player) * PHYSICS.runSpeedFactor);
  return {
    range: null,
    target: fallbackTarget,
    touchDistance: fallbackDistance,
    runway: runway.distance,
    carrierEta,
    opponentEta: opponentEtaAt(state, player, fallbackTarget),
    reason: reductionReason ?? "insufficientRunway",
  };
};
