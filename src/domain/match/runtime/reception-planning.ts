import { PHYSICS } from "../config";
import { clamp, distance, length } from "../../shared/math";
import type { MatchState, PlayerRuntime, PreparedReceptionAction, ShotTechnique } from "../model";
import { playerSkillSpeed } from "./player-metrics";
import { predictPlayerAlongPlan, predictedSpaceAt } from "./prediction";
import { evaluateShotOpportunity } from "./shot-opportunity";
import { pressureAt } from "./control";
import { fieldX } from "./pitch";

/**
 * Onde a bola está no corpo, em **fração do alcance vertical** (`PHYSICS.reachableBallHeight`).
 * Fração e não altura absoluta porque as duas coisas são a mesma: subir o quanto um jogador
 * alcança sobe junto a altura em que ele cabeceia. Enquanto eram seis números soltos em dois
 * módulos, mexer no alcance deixava cinco deles mentindo.
 *
 * `plan` é a faixa que o recebedor PROCURA ao escolher a técnica; `execute` é a que ele ainda
 * aceita no contato. A segunda é mais larga de propósito: planeja-se a cabeçada na altura da
 * testa e ainda se cabeceia um palmo abaixo dela.
 */
export const CONTACT_BAND = {
  plan: { header: 0.48, volley: 0.117 },
  execute: {
    header: { low: 0.375, high: 1 },
    volley: { low: 0.083, high: 0.771 },
    redirect: { low: 0, high: 0.833 },
    placed: { low: 0, high: 0.313 },
  },
} as const;

/** A mesma faixa, já em unidades de altura. */
export const contactHeightBand = (technique: keyof typeof CONTACT_BAND.execute): { low: number; high: number } => {
  const band = CONTACT_BAND.execute[technique];
  return { low: band.low * PHYSICS.reachableBallHeight, high: band.high * PHYSICS.reachableBallHeight };
};

const expectedContactHeight = (state: MatchState): number => {
  const pending = state.pendingPass;
  if (!pending || pending.trajectory === "ground") return 0;
  const remaining = Math.max(0, pending.expectedArrivalAt - state.elapsed);
  const height = state.ball.height + state.ball.verticalVelocity * remaining - PHYSICS.gravity * remaining * remaining / 2;
  return clamp(height, 0, PHYSICS.reachableBallHeight);
};

export const prepareReceptionAction = (state: MatchState, player: PlayerRuntime): PreparedReceptionAction | null => {
  const pending = state.pendingPass;
  if (!pending) return null;
  const intendedReceiver = pending.receiverId === player.profile.id;
  const remaining = Math.max(0.12, pending.expectedArrivalAt - state.elapsed);
  const interceptionReach = playerSkillSpeed(player) * PHYSICS.runSpeedFactor * remaining + player.radius * 1.5;
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
  const technique: ShotTechnique = expectedHeight > CONTACT_BAND.plan.header * PHYSICS.reachableBallHeight ? "header"
    : expectedHeight > CONTACT_BAND.plan.volley * PHYSICS.reachableBallHeight ? "volley"
      : "placed";
  const shot = evaluateShotOpportunity(virtualPlayer, opponents, state, { prepared: true, technique, contactHeight: expectedHeight });
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
    return { ...base, kind: "shot", shotAction: shot.action, target: shot.action.target, score: shotScore };
  }
  if (passTarget && passScore >= controlScore + 0.18 && distance(contact, passTarget.target) > player.radius * 2) {
    return { ...base, kind: "pass", target: passTarget.target, receiverId: passTarget.teammate.profile.id, score: passScore };
  }
  if (directContext && shot && shotScore >= controlScore - 0.12 && pressureAt(state, virtualPlayer) > 0.42) {
    // Desviar de primeira é outro contato, e outra batida: reavalia com a técnica que vai sair.
    const redirect = technique === "header"
      ? shot
      : evaluateShotOpportunity(virtualPlayer, opponents, state, { prepared: true, technique: "redirect", contactHeight: expectedHeight });
    if (redirect) {
      return { ...base, kind: "redirect", shotAction: redirect.action, target: redirect.action.target, score: shotScore };
    }
  }
  return { ...base, kind: "control", target: contact, score: controlScore };
};
