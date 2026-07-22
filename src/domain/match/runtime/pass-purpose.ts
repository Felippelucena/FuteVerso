import { FIELD } from "../config";
import type { PassPurpose, PassTargeting, PassTrajectory, PlayerRuntime, Team, Vec2 } from "../model";

const attackingProgress = (team: Team, x: number): number => team === "blue" ? x / FIELD.width : (FIELD.width - x) / FIELD.width;

export const classifyPassPurpose = (
  passer: PlayerRuntime,
  receiver: PlayerRuntime,
  target: Vec2,
  trajectory: PassTrajectory,
  targeting: PassTargeting,
): PassPurpose => {
  const direction = passer.team === "blue" ? 1 : -1;
  const progress = direction * (target.x - passer.position.x);
  const lateralTravel = Math.abs(target.y - passer.position.y);
  const sourceWide = passer.position.y < FIELD.height * 0.28 || passer.position.y > FIELD.height * 0.72;
  const targetCentral = target.y > FIELD.height * 0.28 && target.y < FIELD.height * 0.72;
  const targetInBox = attackingProgress(passer.team, target.x) > 0.78 && targetCentral;
  const nearGoalLine = attackingProgress(passer.team, passer.position.x) > 0.82;
  if (nearGoalLine && targetCentral && progress < FIELD.width * 0.035) return "cutback";
  if (sourceWide && targetInBox && (trajectory === "air" || lateralTravel > FIELD.height * 0.16)) return "cross";
  const crossesCenter = (passer.position.y - FIELD.height / 2) * (target.y - FIELD.height / 2) < 0;
  if (crossesCenter && lateralTravel > FIELD.height * 0.3) return "switch";
  if (targeting === "space" && progress > FIELD.width * 0.13 && receiver.profile.position !== "goalkeeper") return "throughBall";
  if (progress < 0 && Math.abs(progress) < FIELD.width * 0.1 && lateralTravel < FIELD.height * 0.16) return "layoff";
  return "feet";
};
