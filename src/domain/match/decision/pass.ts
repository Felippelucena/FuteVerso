import { DECISION, FIELD, OFFSIDE } from "../config";
import { clamp, distance, distanceToSegment } from "../../shared/math";
import type { BallAction, DecisionReason, MatchState, PlayerRuntime } from "../model";
import { attackDirection } from "../runtime/formation-geometry";
import { offsideLineProgress } from "../runtime/offside";
import { classifyPassPurpose } from "../runtime/pass-purpose";
import { estimatePassDuration } from "../runtime/pass-trajectory";
import { attackingProgress, centrality, channelAffinity, clampToField, edgeRisk, fieldX, fieldY } from "../runtime/pitch";
import { etaToPoint } from "../runtime/player-metrics";
import { interceptionThreat, predictPlayerAlongPlan } from "../runtime/prediction";
import { assignmentOf } from "../systems/assignment-system";
import { blend } from "./shared";

/**
 * A escolha do passe: para quem, por onde e como. Enumera todo companheiro contra as oito
 * variantes de bola (chão/ar × curto/longo × pé/espaço) e devolve a melhor — a nota é a mesma
 * escala que o goleiro usa para decidir quando soltar a bola.
 */

export const PASS_VARIANTS = (["ground", "air"] as const).flatMap((trajectory) =>
  (["short", "long"] as const).flatMap((range) =>
    (["feet", "space"] as const).map((targeting) => ({ trajectory, range, targeting })),
  ),
);

export interface PassOption {
  action: Extract<BallAction, { kind: "pass" }>;
  score: number;
  reason: DecisionReason;
}

export const choosePass = (player: PlayerRuntime, teammates: PlayerRuntime[], opponents: PlayerRuntime[], state: MatchState): PassOption | null => {
  const direction = attackDirection(player.team);
  const carrierEdgeRisk = edgeRisk(player.position);
  const collective = state.tactics[player.team].collectivePlan;
  const phase = state.tactics[player.team].phase;
  // Consciência de impedimento: um bom passador não entrega a bola a quem já está impedido. A
  // linha é a mesma que o motor apita (penúltimo adversário); comparar a posição ATUAL do
  // companheiro, não o alvo, preserva a bola em profundidade — quem está no nível da linha e
  // corre para o passe está onside quando ele sai.
  const offsideLine = offsideLineProgress(state, player.team);
  const ballProgress = attackingProgress(player.team, state.ball.position.x);
  const isOffsideNow = (teammate: PlayerRuntime): boolean => {
    const progress = attackingProgress(player.team, teammate.position.x);
    return progress > 0.5 + OFFSIDE.toleranceProgress
      && progress > ballProgress + OFFSIDE.toleranceProgress
      && progress > offsideLine + OFFSIDE.toleranceProgress;
  };
  const candidates = teammates
    .filter((teammate) => teammate.profile.id !== player.profile.id)
    .flatMap((teammate) => PASS_VARIANTS.map((variant) => {
      const initialDistance = distance(player.position, teammate.position);
      const initialTime = estimatePassDuration(initialDistance, variant.trajectory, variant.range, variant.targeting);
      const anticipationScale = 0.78 + player.profile.mental.anticipation / 360;
      const routeProjection = predictPlayerAlongPlan(state, teammate, initialTime * anticipationScale);
      const predictedTarget = variant.targeting === "feet"
        ? blend(teammate.position, routeProjection, 0.72)
        : routeProjection;
      const passDistance = distance(player.position, predictedTarget);
      const travelTime = estimatePassDuration(passDistance, variant.trajectory, variant.range, variant.targeting);
      const receiverFuture = predictPlayerAlongPlan(state, teammate, travelTime);
      const target = variant.targeting === "space" ? blend(predictedTarget, receiverFuture, 0.68) : predictedTarget;
      const purpose = classifyPassPurpose(player, teammate, target, variant.trajectory, variant.targeting);
      const progress = direction * (target.x - player.position.x);
      const opponentFutures = opponents.map((opponent) => ({ opponent, position: predictPlayerAlongPlan(state, opponent, travelTime) }));
      const openness = Math.min(...opponentFutures.map(({ position }) => distance(target, position)));
      const rawLanePressure = opponentFutures.reduce((risk, { position }) => {
        const laneDistance = distanceToSegment(position, player.position, target);
        return risk + clamp(1 - laneDistance / fieldY(4), 0, 1);
      }, 0) + interceptionThreat(player.position, target, opponents, travelTime) * 0.58;
      const landingContest = clamp(1 - openness / fieldX(9), 0, 1);
      const effectivePressure = variant.trajectory === "air"
        ? rawLanePressure * 0.34 + landingContest * 1.2
        : rawLanePressure;
      const blocked = effectivePressure > 0.82;
      const passerTechnique = (player.profile.skills.passing + player.profile.skills.vision) / 200;
      const longProgression = progress > fieldX(18) && (phase === "buildUp" || phase === "progression" || phase === "counterAttack");
      const crossesPitch = (player.position.y - FIELD.height / 2) * (target.y - FIELD.height / 2) < 0;
      const switchValue = carrierEdgeRisk * centrality(target) * (crossesPitch ? 1.2 : 0.42);
      const wallPass = state.lastAssist?.playerId === teammate.profile.id && state.elapsed - state.lastAssist.time < 4.2;
      const wallPassBonus = wallPass ? DECISION.pass.wallPass : 0;
      const roleBonus = teammate.profile.role === "finisher" ? Math.max(0, progress) / fieldX(35) : 0;
      const backwardsSafety = progress < 0 && openness > fieldX(7) ? DECISION.pass.backwardsSafety : 0;
      const rangePenalty = variant.range === "short"
        ? clamp((passDistance - fieldX(24)) / fieldX(12), 0, 1) * 0.85
        : clamp((fieldX(13) - passDistance) / fieldX(8), 0, 1) * 0.72;
      const aerialValue = variant.trajectory === "air"
        ? (rawLanePressure > 0.9 ? 0.3 : -0.16) - landingContest * 0.72 - (variant.range === "long" ? 0.08 : 0)
        : 0;
      // O valor de passar para alguém sai do dever dele, não de um id nomeado no plano. Cada
      // dever decai com a ordem (`priority`), para o time não despejar tudo no mesmo corredor
      // só porque três jogadores foram encarregados de atacar as costas da linha.
      const receiverDuty = assignmentOf(collective, teammate.profile.id);
      const duty = DECISION.pass.duty;
      const dutyBonus = !collective || !receiverDuty ? 0
        : receiverDuty.duty === "runInBehind" ? (duty.runInBehind + collective.risk * duty.runInBehindRisk) / (1 + receiverDuty.priority * 0.6)
          : receiverDuty.duty === "overlap" ? duty.overlap
            : receiverDuty.duty === "support" ? duty.support / (1 + receiverDuty.priority)
              : receiverDuty.duty === "restDefense" && progress < 0
                ? (1 - collective.risk) * duty.restDefense / (1 + receiverDuty.priority)
                : 0;
      const collectiveBonus = collective
        ? dutyBonus
          + channelAffinity(target, collective.attackChannel) * DECISION.pass.channelAffinity
          + (collective.buildUpStyle === "direct"
            ? clamp(progress / fieldX(24), -0.12, 0.3)
            : collective.buildUpStyle === "short"
              ? clamp(1 - passDistance / fieldX(24), 0, 1) * 0.24
              : 0)
        : 0;
      const value = DECISION.pass.purpose;
      const purposeBonus = purpose === "cutback" ? value.cutback
        : purpose === "cross" ? (teammate.profile.role === "finisher" ? value.crossToFinisher : value.cross)
          : purpose === "throughBall" ? value.throughBall
            : purpose === "layoff" && wallPass ? value.layoff
              : 0;
      // Passar para um companheiro já impedido é jogar fora a posse: penalidade dura, que só o
      // deixa competitivo se todas as outras saídas forem piores ainda (um raro chutão de aposta).
      const offsidePenalty = isOffsideNow(teammate) ? DECISION.pass.offsidePenalty : 0;
      const score = clamp(progress / fieldX(DECISION.pass.progressReference), -0.8, 1.45)
        + clamp(openness / fieldX(DECISION.pass.opennessReference), 0, 1.18)
        + centrality(target) * DECISION.pass.centrality + roleBonus
        + switchValue + wallPassBonus + backwardsSafety + collectiveBonus + aerialValue + purposeBonus
        + (longProgression ? passerTechnique * 0.36 : 0)
        + (player.profile.mental.teamwork - 50) / 100 * 0.22
        + (player.profile.mental.decisionMaking - 50) / 100 * 0.16
        + (player.profile.mental.creativity - 50) / 100 * (blocked ? 0.2 : 0.06)
        - passDistance / fieldX(DECISION.pass.lengthPenaltyReference) - rangePenalty - offsidePenalty
        - effectivePressure * (passDistance > fieldX(18) ? 0.58 : 0.86) * (1.08 - player.profile.mental.creativity / 500);
      const receiverEta = etaToPoint(teammate, target);
      const opponentEta = Math.min(...opponents.map((opponent) => etaToPoint(opponent, target)));
      const reason: DecisionReason = wallPass ? "wallPass" : switchValue > 0.52 ? "switchPlay" : "progressivePass";
      return { teammate, target, passDistance, score, reason, variant, purpose, receiverEta, opponentEta };
    }))
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  return {
    score: best.score,
    reason: best.reason,
    action: {
      kind: "pass",
      receiverId: best.teammate.profile.id,
      target: clampToField(best.target, 4),
      trajectory: best.variant.trajectory,
      range: best.variant.range,
      targeting: best.variant.targeting,
      purpose: best.purpose,
      power: clamp(0.42 + best.passDistance / fieldX(82) + (best.variant.targeting === "space" ? 0.08 : 0)
        + (best.variant.trajectory === "air" ? 0.04 : 0), 0.48, 1),
      receiverEta: best.receiverEta,
      opponentEta: best.opponentEta,
      selectionReason: best.reason,
    },
  };
};
