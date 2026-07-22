import { FIELD, PHYSICS } from "../config";
import type { PassRange, PassTargeting, PassTrajectory, Vec2 } from "../model";
import { add, clamp, distance, normalize, scale, subtract } from "../../shared/math";

export interface PassTrajectorySolution {
  velocity: Vec2;
  verticalVelocity: number;
  duration: number;
  landingPoint: Vec2;
}

const dragMatchedSpeed = (travelDistance: number, duration: number, drag: number): number => {
  if (drag <= 0) return travelDistance / Math.max(0.01, duration);
  return travelDistance * drag / Math.max(0.01, 1 - Math.exp(-drag * duration));
};

export const estimatePassDuration = (
  travelDistance: number,
  trajectory: PassTrajectory,
  range: PassRange,
  targeting: PassTargeting,
  power = 0.7,
): number => {
  const pace = trajectory === "air"
    ? range === "long" ? 34 : 28
    : range === "long" ? 36 : targeting === "space" ? 34 : 28;
  const poweredPace = pace * (0.88 + clamp(power, 0, 1) * 0.22);
  if (trajectory === "air") {
    return range === "long"
      ? clamp(travelDistance / poweredPace, 1.05, 2.05)
      : clamp(travelDistance / poweredPace, 0.62, 1.2);
  }
  return range === "long"
    ? clamp(travelDistance / poweredPace, 0.72, 2.05)
    : clamp(travelDistance / poweredPace, 0.28, 1.25);
};

export const solvePassTrajectory = (
  origin: Vec2,
  target: Vec2,
  trajectory: PassTrajectory,
  range: PassRange,
  targeting: PassTargeting,
  power = 0.7,
): PassTrajectorySolution => {
  const travelDistance = distance(origin, target);
  const direction = normalize(subtract(target, origin));
  const duration = estimatePassDuration(travelDistance, trajectory, range, targeting, power);
  const drag = trajectory === "air" ? PHYSICS.airBallDrag : PHYSICS.ballDrag;
  const speed = clamp(dragMatchedSpeed(travelDistance, duration, drag), 0, PHYSICS.maxBallSpeed);
  const verticalVelocity = trajectory === "air" ? PHYSICS.gravity * duration / 2 : 0;
  const reachableDistance = drag > 0 ? speed * (1 - Math.exp(-drag * duration)) / drag : speed * duration;
  const landingPoint = {
    x: clamp(origin.x + direction.x * reachableDistance, FIELD.ballRadius, FIELD.width - FIELD.ballRadius),
    y: clamp(origin.y + direction.y * reachableDistance, FIELD.ballRadius, FIELD.height - FIELD.ballRadius),
  };
  return { velocity: scale(direction, speed), verticalVelocity, duration, landingPoint };
};

export const targetAlongDirection = (origin: Vec2, intendedTarget: Vec2, direction: Vec2): Vec2 =>
  add(origin, scale(normalize(direction), distance(origin, intendedTarget)));
