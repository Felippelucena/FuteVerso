import { FIELD, PHYSICS } from "../config";
import { clamp, distance, length } from "../../shared/math";
import type { MatchState, PlayerRuntime, PreparedReceptionAction, ShotTechnique } from "../model";
import { predictPlayerAlongPlan, predictedSpaceAt } from "./prediction";
import { evaluateShotOpportunity } from "./shot-opportunity";
import { pressureAt } from "./control";

const fieldX = (value: number): number => value * FIELD.width / 100;

const expectedContactHeight = (state: MatchState): number => {
  const pending = state.pendingPass;
  if (!pending || pending.trajectory === "ground") return 0;
  const remaining = Math.max(0, pending.expectedArrivalAt - state.elapsed);
  const height = state.ball.height + state.ball.verticalVelocity * remaining - PHYSICS.gravity * remaining * remaining / 2;
  return clamp(height, 0, 2.4);
};

export const prepareReceptionAction = (state: MatchState, player: PlayerRuntime): PreparedReceptionAction | null => {
  const pending = state.pendingPass;
  if (!pending) return null;
  const intendedReceiver = pending.receiverId === player.profile.id;
  const remaining = Math.max(0.12, pending.expectedArrivalAt - state.elapsed);
  const interceptionReach = (8.5 + player.profile.skills.sprintSpeed * 0.06) * PHYSICS.runSpeedFactor * remaining + player.radius * 1.5;
  const canPrepareInterception = player.team !== pending.team && distance(player.position, pending.landingPoint) <= interceptionReach;
  if (!intendedReceiver && !canPrepareInterception) return null;
  const contact = pending.landingPoint;
  const expectedHeight = expectedContactHeight(state) || pending.expectedHeight || 0;
  const expectedSpeed = pending.expectedSpeed ?? length(state.ball.velocity);
  const opponents = state.players.filter((candidate) => candidate.team !== player.team);
  const teammates = state.players.filter((candidate) => candidate.team === player.team && candidate.profile.id !== player.profile.id);
  const virtualPlayer = { ...player, position: contact };
  const purpose = pending.purpose ?? "feet";
  const directContext = purpose === "cross" || purpose === "cutback";
  const technique: ShotTechnique = expectedHeight > 1.15 ? "header"
    : expectedHeight > 0.28 ? "volley"
      : "placed";
  const shot = evaluateShotOpportunity(virtualPlayer, opponents, state, true, technique);
  const arrivalPressure = clamp(1 - predictedSpaceAt(contact, opponents, Math.max(0.12, pending.expectedArrivalAt - state.elapsed)) / fieldX(8), 0, 1);
  const shotScore = shot ? shot.utility + (directContext ? 0.24 : -0.38) - Math.max(0, expectedSpeed - 58) / 100 : -1;
  const passTarget = [...teammates]
    .map((teammate) => {
      const target = predictPlayerAlongPlan(state, teammate, Math.max(0.12, pending.expectedArrivalAt - state.elapsed));
      const space = predictedSpaceAt(target, opponents, 0.25);
      const direction = player.team === "blue" ? 1 : -1;
      const progress = direction * (target.x - contact.x);
      return { teammate, target, score: space / fieldX(12) + progress / fieldX(24) + player.memory.policy.pass * 0.4 };
    })
    .sort((a, b) => b.score - a.score)[0];
  const passScore = passTarget ? passTarget.score + (purpose === "layoff" ? 0.28 : 0) + arrivalPressure * 0.18 : -1;
  const controlScore = 1.05 + player.profile.skills.control / 100 * 0.42
    + player.profile.mental.composure / 100 * 0.18 - arrivalPressure * 0.22;
  const passId = pending.id ?? 0;
  const base = {
    passId,
    validFrom: pending.expectedArrivalAt - (pending.trajectory === "air" ? 0.24 : 0.14),
    expiresAt: pending.expectedArrivalAt + 0.22,
    expectedHeight,
    expectedSpeed,
    fallback: arrivalPressure > 0.55 ? "protectBall" as const : "orientedControl" as const,
  };
  if (canPrepareInterception) {
    return {
      ...base,
      kind: "control",
      target: contact,
      score: 0.9 + player.profile.skills.defending / 250 + player.profile.mental.anticipation / 400,
      fallback: "protectBall",
    };
  }
  if (shot && shotScore >= Math.max(controlScore + 0.08, passScore + 0.04)) {
    return { ...base, kind: "shot", technique, target: shot.action.target, score: shotScore };
  }
  if (passTarget && passScore >= controlScore + 0.18 && distance(contact, passTarget.target) > player.radius * 2) {
    return { ...base, kind: "pass", target: passTarget.target, receiverId: passTarget.teammate.profile.id, score: passScore };
  }
  if (directContext && shot && shotScore >= controlScore - 0.12 && pressureAt(state, virtualPlayer) > 0.42) {
    return { ...base, kind: "redirect", technique: expectedHeight > 1.15 ? "header" : "redirect", target: shot.action.target, score: shotScore };
  }
  return { ...base, kind: "control", target: contact, score: controlScore };
};
