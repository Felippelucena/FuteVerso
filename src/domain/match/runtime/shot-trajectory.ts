import { PHYSICS } from "../config";
import { clamp, distance, normalize, scale } from "../../shared/math";
import type { Vec2 } from "../model";

export interface ShotTrajectorySolution {
  velocity: Vec2;
  verticalVelocity: number;
  duration: number;
  targetHeight: number;
  arrivalSpeed: number;
}

export interface PredictedShotPoint {
  position: Vec2;
  height: number;
  verticalVelocity: number;
  speed: number;
}

const travelDuration = (travelDistance: number, launchSpeed: number): number => {
  const drag = PHYSICS.airBallDrag;
  const safeSpeed = Math.max(launchSpeed, travelDistance * drag + 0.5);
  const ratio = clamp(travelDistance * drag / safeSpeed, 0, 0.96);
  return -Math.log(1 - ratio) / drag;
};

export const solveShotTrajectory = (
  origin: Vec2,
  target: Vec2,
  originHeight: number,
  targetHeight: number,
  desiredSpeed: number,
): ShotTrajectorySolution => {
  const travelDistance = distance(origin, target);
  const duration = travelDuration(travelDistance, desiredSpeed);
  const dragFactor = (1 - Math.exp(-PHYSICS.airBallDrag * duration)) / PHYSICS.airBallDrag;
  const horizontalSpeed = travelDistance / Math.max(0.001, dragFactor);
  const clampedHeight = Math.max(0, targetHeight);
  const verticalVelocity = (clampedHeight - Math.max(0, originHeight) + 0.5 * PHYSICS.gravity * duration * duration)
    / Math.max(0.001, duration);
  return {
    velocity: scale(normalize({ x: target.x - origin.x, y: target.y - origin.y }), horizontalSpeed),
    verticalVelocity,
    duration,
    targetHeight: clampedHeight,
    arrivalSpeed: horizontalSpeed * Math.exp(-PHYSICS.airBallDrag * duration),
  };
};

export const predictShotPoint = (
  origin: Vec2,
  velocity: Vec2,
  originHeight: number,
  verticalVelocity: number,
  seconds: number,
): PredictedShotPoint => {
  const duration = Math.max(0, seconds);
  const dragFactor = (1 - Math.exp(-PHYSICS.airBallDrag * duration)) / PHYSICS.airBallDrag;
  const drag = Math.exp(-PHYSICS.airBallDrag * duration);
  return {
    position: {
      x: origin.x + velocity.x * dragFactor,
      y: origin.y + velocity.y * dragFactor,
    },
    height: Math.max(0, originHeight + verticalVelocity * duration - 0.5 * PHYSICS.gravity * duration * duration),
    verticalVelocity: verticalVelocity - PHYSICS.gravity * duration,
    speed: Math.hypot(velocity.x, velocity.y) * drag,
  };
};

export const timeToX = (originX: number, velocityX: number, targetX: number): number | null => {
  if (Math.abs(velocityX) < 0.001) return null;
  const ratio = (targetX - originX) * PHYSICS.airBallDrag / velocityX;
  if (ratio <= 0 || ratio >= 0.98) return null;
  return -Math.log(1 - ratio) / PHYSICS.airBallDrag;
};
