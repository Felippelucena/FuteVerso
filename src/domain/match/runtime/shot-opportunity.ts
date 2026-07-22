import { FIELD } from "../config";
import { add, clamp, distance, dot, normalize, scale, subtract } from "../../shared/math";
import type { BallAction, MatchState, PlayerRuntime, ShotTechnique, Vec2 } from "../model";
import { predictPlayerPosition } from "./prediction";
import { pressureAt } from "./control";

export interface ShotOpportunity {
  action: Extract<BallAction, { kind: "shot" }>;
  utility: number;
  distance: number;
  angle: number;
  blocked: boolean;
  goalkeeperGap: number;
  isLong: boolean;
}

const fieldX = (value: number): number => value * FIELD.width / 100;

const distanceToSegment = (point: Vec2, start: Vec2, end: Vec2): number => {
  const segment = subtract(end, start);
  const squared = dot(segment, segment);
  if (squared < 0.001) return distance(point, start);
  const amount = clamp(dot(subtract(point, start), segment) / squared, 0, 1);
  return distance(point, add(start, scale(segment, amount)));
};

export const evaluateShotOpportunity = (
  player: PlayerRuntime,
  opponents: PlayerRuntime[],
  state: MatchState,
  prepared = false,
  preparedTechnique?: ShotTechnique,
): ShotOpportunity | null => {
  const direction = player.team === "blue" ? 1 : -1;
  const goalX = direction > 0 ? FIELD.width : 0;
  const goalkeeper = opponents.find((opponent) => opponent.profile.position === "goalkeeper") ?? null;
  const keeperFuture = goalkeeper ? predictPlayerPosition(goalkeeper, prepared ? 0.12 : 0.32) : { x: goalX, y: FIELD.height / 2 };
  const aimCandidates = [FIELD.goalTop + 2.2, FIELD.height / 2, FIELD.goalBottom - 2.2];
  const aimY = [...aimCandidates].sort((a, b) => Math.abs(b - keeperFuture.y) - Math.abs(a - keeperFuture.y))[0];
  const target = { x: goalX, y: aimY };
  const goalDistance = distance(player.position, target);
  const maximumRange = fieldX(22 + player.profile.skills.kickPower * 0.16);
  if (goalDistance > maximumRange * (prepared ? 1.04 : 1)) return null;
  const defenders = opponents.filter((opponent) => opponent !== goalkeeper);
  const closingHorizon = clamp(goalDistance / 80, 0.16, 0.48);
  const blockers = defenders.filter((opponent) => distanceToSegment(predictPlayerPosition(opponent, closingHorizon), player.position, target) < 3.2);
  const blocked = blockers.length > 0;
  const goalkeeperGap = Math.abs(aimY - keeperFuture.y);
  const facing = normalize(player.facing);
  const shotDirection = normalize(subtract(target, player.position));
  const alignment = clamp((dot(facing, shotDirection) + 1) / 2, 0, 1);
  const visibleAngle = clamp((FIELD.goalBottom - FIELD.goalTop) / Math.max(fieldX(10), goalDistance), 0, 1);
  const rangeCloseness = 1 - goalDistance / maximumRange;
  const pressure = pressureAt(state, player);
  const technique = preparedTechnique ?? (goalDistance > fieldX(25) ? "power" : goalkeeperGap > 7 ? "placed" : "power");
  const isLong = goalDistance > fieldX(29);
  const utility = 0.72 + rangeCloseness * 1.28 + visibleAngle * 0.48
    + player.memory.policy.shoot * 0.38
    + player.profile.skills.finishing / 100 * 0.28
    + player.profile.skills.kickPower / 100 * (isLong ? 0.32 : 0.12)
    + goalkeeperGap / Math.max(1, FIELD.goalBottom - FIELD.goalTop) * 0.38
    + alignment * (prepared ? 0.08 : 0.16)
    + (prepared ? 0.24 : 0)
    - blockers.length * 0.68
    - pressure * (prepared ? 0.2 : 0.28)
    - (isLong ? 0.72 : 0);
  return {
    action: {
      kind: "shot",
      target,
      power: clamp(0.58 + goalDistance / fieldX(72) + (technique === "power" ? 0.08 : 0), 0.62, 1),
      technique,
      utility,
      blocked,
      goalkeeperGap,
    },
    utility,
    distance: goalDistance,
    angle: visibleAngle,
    blocked,
    goalkeeperGap,
    isLong,
  };
};
