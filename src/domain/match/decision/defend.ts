import { DEFENSE, FIELD, PHYSICS } from "../config";
import { add, blend, clamp, distance, normalize, scale, subtract } from "../../shared/math";
import type { AgentDecision, DecisionReason, MatchState, PlayerRuntime, TargetFrame, Vec2 } from "../model";
import { assignedAnchor, attackDirection, goalCenter } from "../runtime/formation-geometry";
import type { MarkingAssignment } from "../runtime/marking";
import { clampToField, fieldX, fieldY } from "../runtime/pitch";
import { playerSkillSpeed } from "../runtime/player-metrics";
import { predictBallPosition, predictPlayerPosition, predictionHorizon } from "../runtime/prediction";

import { perceptionDepth } from "./shared";

/**
 * Onde ficar sem a bola: entre a zona que se sustenta e o homem por quem se responde. A firmeza
 * da marcação vem da situação (`runtime/marking`); aqui só se resolve a geometria dela.
 */

export const defensiveTarget = (
  player: PlayerRuntime,
  marking: MarkingAssignment | null,
  state: MatchState,
): {
  target: Vec2;
  frame: TargetFrame;
  intent: AgentDecision["intent"];
  burst: boolean;
  reason: DecisionReason;
  burstDuration?: number;
} => {
  const collective = state.tactics[player.team].collectivePlan;
  const anchor = assignedAnchor(collective, player);
  const direction = attackDirection(player.team);
  const thinkingTime = perceptionDepth(player, state.ball.position);
  const ownGoal = goalCenter(player.team, true);
  const phase = state.tactics[player.team].phase;
  const mark = marking?.mark ?? null;
  // A firmeza da marcação sai da situação (`runtime/marking`); a disposição do jogador só a
  // tempera. Antes era um número fixo — 0,3 para a zona —, e o defensor nunca chegava no homem.
  const tightness = marking
    ? clamp(marking.tightness * (0.82 + player.memory.policy.mark * 0.36 - player.memory.policy.cover * 0.12), 0, 1)
    : 0;
  const predictedBall = predictBallPosition(state, predictionHorizon(player, 0.7) * 0.5);
  // A escada de cobertura por índice global morreu aqui. A distância à bola sai da profundidade
  // da própria célula, e o valor pode ser **negativo**: quem tem zona funda cobre atrás da bola,
  // quem tem célula adiantada fica à frente dela, fechando a saída. Sem isso o time inteiro
  // desabava para trás da bola e as duas equipes viravam dois blocos que não se tocam.
  const coverDistance = clamp(
    distance(predictedBall, ownGoal) - distance(anchor, ownGoal),
    -FIELD.width * 0.3,
    FIELD.width * 0.46,
  );
  const coverPoint = add(predictedBall, scale(normalize(subtract(ownGoal, predictedBall)), coverDistance));
  const predictedMark = mark ? predictPlayerPosition(mark, predictionHorizon(player, 0.55) * 0.48) : null;
  // Quanto mais firme a marcação, mais colado nas costas do homem e menos de lado: soltar é o
  // que dá o passo de vantagem que o atacante usa para receber virado.
  const markSide = predictedMark ? {
    x: predictedMark.x - direction * fieldX(1.5 + (1 - tightness) * 4),
    y: predictedMark.y + Math.sign(anchor.y - predictedMark.y || 1) * fieldY(1 + (1 - tightness) * 3),
  } : anchor;
  const medium = blend(coverPoint, markSide, tightness);
  const farPlan = blend(anchor, markSide, tightness * (0.42 + thinkingTime * 0.3));
  // Com a bola longe o jogador volta à forma; colado no homem, ele vai com ele.
  const contextualTarget = blend(medium, farPlan, thinkingTime * (1 - tightness));
  // A disciplina de faixa é da zona: quem está preso a um homem não volta para a própria linha.
  const laneDiscipline = (phase === "lowBlock" ? 0.36 : 0.28) * (1 - tightness);
  const target = clampToField(blend(contextualTarget, { x: contextualTarget.x, y: anchor.y }, laneDiscipline), 3);
  const intent = mark ? "marking" : "covering";
  const reason: DecisionReason = mark ? "markThreat" : "holdZone";
  // Item 4B: zagueiro adiantado que acabou de perder a posse recompõe em disparada garantida
  // (sem o gate de intensidade/fase do burst defensivo normal).
  const justLost = state.previousControlledTeam === player.team
    && state.lastControlledTeam !== player.team
    && state.elapsed - state.controlChangedAt < DEFENSE.recoverWindow;
  const advanced = direction * (player.position.x - anchor.x) > DEFENSE.recoverAdvancedGap * FIELD.width;
  // Quem está à frente da própria célula com o time sem a bola volta em disparada. Antes isso só
  // valia para zagueiros nos segundos seguintes à perda, porque a âncora era fixa e ficar
  // adiantado era exceção. Com o bloco subindo e descendo atrás da bola, estar fora de forma é a
  // situação comum — e recompor passou a ser trabalho de todo mundo, não só da zaga.
  const guaranteed = player.profile.role === "defender" && justLost;
  if (advanced && (guaranteed || (player.sprintEnergy > DEFENSE.recoverMinEnergy && player.sprintCooldown <= 0))) {
    const recoverPoint = clampToField(guaranteed ? blend(anchor, ownGoal, 0.25) : anchor, 3);
    const raceSpeed = playerSkillSpeed(player) * PHYSICS.burstSpeedFactor;
    const burstDuration = clamp(distance(player.position, recoverPoint) / Math.max(1, raceSpeed), PHYSICS.burstDuration, DEFENSE.recoverBurstMax);
    return {
      target: recoverPoint,
      frame: { anchor, bodyId: null, bodyShare: { x: 0, y: 0 } },
      intent: "covering",
      reason: "recoverShape",
      burst: true,
      burstDuration,
    };
  }
  const defensiveBurst = player.sprintEnergy > 0.5
    && player.sprintCooldown <= 0
    && player.profile.mental.intensity > 78
    && distance(player.position, target) > fieldX(12)
    && (phase === "counterPress" || phase === "recovery");
  // A firmeza é exatamente a fatia: marcação frouxa é sustentar a zona (que se recoloca com o
  // bloco), marcação firme é ir junto com o homem. Sem o quadro, o alvo virava um ponto congelado
  // enquanto a bola e o bloco andavam — e estalava 9 m a cada replanejamento.
  // Marcar é ir com o homem nos dois eixos: a firmeza vale igual em profundidade e em faixa.
  return {
    target,
    frame: { anchor, bodyId: mark?.profile.id ?? null, bodyShare: { x: tightness, y: tightness } },
    intent,
    reason,
    burst: defensiveBurst,
  };
};
