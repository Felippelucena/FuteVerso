import { CONTEST, DECISION, FIELD, OFFSIDE, PHYSICS } from "../config";
import { blend, clamp, distance, dot, length, normalize, subtract } from "../../shared/math";
import type { BallAction, DecisionReason, MatchState, PlayerRuntime } from "../model";
import { attackDirection } from "../runtime/formation-geometry";
import { offsideLineProgress } from "../runtime/offside";
import { classifyPassPurpose } from "../runtime/pass-purpose";
import { estimatePassDuration, reachableFlightSeconds, solvePassTrajectory } from "../runtime/pass-trajectory";
import {
  completionChance,
  controlChance,
  laneClearance,
  laneSurvival,
  passLaneThreat,
  raceChance,
  receptionMargin,
} from "../runtime/pass-viability";
import { attackingProgress, centrality, channelAffinity, clampToField, edgeRisk, fieldX } from "../runtime/pitch";
import { etaToPoint } from "../runtime/player-metrics";
import { predictPlayerAlongPlan } from "../runtime/prediction";
import { assignmentOf } from "../systems/assignment-system";


/**
 * A escolha do passe: para quem, por onde e como. Enumera todo companheiro contra as oito
 * variantes de bola (chão/ar × curto/longo × pé/espaço) e devolve a melhor.
 *
 * A nota é **valor esperado**: o que a bola vale multiplicado pela chance de ela chegar, menos o
 * que custa perdê-la. A chance vem inteira de `runtime/pass-viability`, que é a mesma conta que o
 * `possession-system` aplica no primeiro toque de verdade — decisão e execução deixaram de ter
 * opiniões próprias sobre o que é um passe difícil.
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
      // O corpo a transpor decide a altura da bola, e a altura decide o resto: quanto tempo ela
      // voa, com que força chega e quanto do voo ela passa ao alcance de alguém.
      const clearance = laneClearance(player.position, predictedTarget, opponents, initialTime);
      const passDistance = distance(player.position, predictedTarget);
      const travelTime = estimatePassDuration(passDistance, variant.trajectory, variant.range, variant.targeting, 0.7, clearance);
      const receiverFuture = predictPlayerAlongPlan(state, teammate, travelTime);
      const target = variant.targeting === "space" ? blend(predictedTarget, receiverFuture, 0.68) : predictedTarget;
      const purpose = classifyPassPurpose(player, teammate, target, variant.trajectory, variant.targeting);
      const progress = direction * (target.x - player.position.x);

      // --- A chance de a bola chegar, pela geometria e pela mesma régua de domínio do motor ---
      const solution = solvePassTrajectory(player.position, target, variant.trajectory, variant.range, variant.targeting, 0.7, clearance);
      const drag = variant.trajectory === "air" ? PHYSICS.airBallDrag : PHYSICS.ballDrag;
      const arrivalSpeed = length(solution.velocity) * Math.exp(-drag * solution.duration);
      const reachableSeconds = reachableFlightSeconds(solution);
      // Só conta quem alcança a bola ONDE ela passa por ele: erguer a bola compra exatamente os
      // corpos sob a parte alta do voo, e nenhum a mais.
      const threat = passLaneThreat(player.position, target, opponents, solution, drag);
      const receiverEta = etaToPoint(teammate, target);
      const opponentEta = Math.min(...opponents.map((opponent) => etaToPoint(opponent, target)));
      // O decisor SUPUNHA duas entradas que o resolvedor MEDE, e supunha as duas a favor: altura
      // nominal (metade do alcance) e recebedor perfeitamente virado para a bola. Medido em tres
      // partidas, a altura real no contato aereo e 1,47 (supunha 1,20) e a orientacao real e 0,78
      // no ar e 0,84 no chao, com p10 de 0,06 — um decimo das recepcoes aereas acontece com o
      // jogador praticamente de costas. Era exatamente a "opiniao propria" que este modulo existe
      // para abolir, e cobrava o preco no passe aereo curto: 41% do volume, +15,6 pontos de
      // otimismo.
      //
      // Nenhuma das duas precisa ser suposta. A altura de chegada sai da trajetoria ja resolvida;
      // a orientacao sai da MESMA formula do resolvedor, com a melhor estimativa disponivel do
      // rumo de onde a bola vem. Estimar mal e um erro; assumir perfeicao e uma mentira.
      const arrivalHeight = Math.max(0, solution.verticalVelocity * solution.duration
        - PHYSICS.gravity * solution.duration * solution.duration / 2);
      const incoming = normalize(subtract(player.position, target));
      const margin = receptionMargin({
        quality: (teammate.profile.skills.control * 0.62 + teammate.profile.skills.acceleration * 0.15
          + teammate.profile.skills.vision * 0.13 + teammate.profile.skills.defending * 0.1
          + teammate.profile.mental.anticipation * 0.06 + teammate.profile.mental.composure * 0.03) / 100,
        stamina: teammate.stamina,
        composure: teammate.profile.mental.composure,
        anticipation: teammate.profile.mental.anticipation,
        relativeSpeed: arrivalSpeed,
        ballHeight: arrivalHeight,
        facingAlignment: clamp((dot(normalize(teammate.facing), incoming) + 1) / 2, 0, 1),
        pressure: clamp(1 - opponentEta / CONTEST.horizonSeconds, 0, 1),
        ownBox: false,
        continuesOwnDribble: false,
        prepared: true,
        reachableHeight: PHYSICS.reachableBallHeight,
      });
      const completion = completionChance(
        controlChance(margin),
        // Duas corridas, e as duas precisam dar certo: chegar antes DELE, e chegar antes que a
        // bola morra. A segunda é o desfecho que o motor mais produzia — o passe que expira sem
        // ninguém — e que a nota não enxergava de jeito nenhum.
        raceChance(opponentEta - receiverEta, CONTEST.settleMargin)
          * raceChance(solution.duration + reachableSeconds - receiverEta, CONTEST.settleMargin),
        laneSurvival(threat),
      );

      // --- O que a bola VALE se chegar ---
      const openness = Math.min(...opponents.map((opponent) => distance(target, predictPlayerAlongPlan(state, opponent, solution.duration))));
      const passerTechnique = (player.profile.skills.passing + player.profile.skills.vision) / 200;
      const longProgression = progress > fieldX(18) && (phase === "buildUp" || phase === "progression" || phase === "counterAttack");
      const crossesPitch = (player.position.y - FIELD.height / 2) * (target.y - FIELD.height / 2) < 0;
      const switchValue = carrierEdgeRisk * centrality(target) * (crossesPitch ? 1.2 : 0.42);
      const wallPass = state.lastAssist?.playerId === teammate.profile.id
        && state.elapsed - state.lastAssist.time < DECISION.pass.wallPassWindow;
      const roleBonus = teammate.profile.role === "finisher" ? Math.max(0, progress) / fieldX(35) : 0;
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
      const worth = clamp(progress / fieldX(DECISION.pass.progressReference), -0.8, 1.45)
        + clamp(openness / fieldX(DECISION.pass.opennessReference), 0, 1) * DECISION.pass.space
        + centrality(target) * DECISION.pass.centrality + roleBonus
        + switchValue + (wallPass ? DECISION.pass.wallPass : 0) + collectiveBonus + purposeBonus
        + (longProgression ? passerTechnique * 0.36 : 0)
        + (player.profile.mental.teamwork - 50) / 100 * 0.22
        + (player.profile.mental.decisionMaking - 50) / 100 * 0.16
        + (player.profile.mental.creativity - 50) / 100 * 0.06;

      // Perder a bola custa o que ela vale ao adversário no ponto em que ele a recolhe: perto do
      // nosso gol é quase um gol, no ataque é só um contra-ataque.
      const turnoverCost = DECISION.pass.turnoverCost * (1 - attackingProgress(player.team, target.x));
      // Passar para um companheiro já impedido é jogar fora a posse: penalidade dura, fora da
      // multiplicação, que só o deixa competitivo se todas as outras saídas forem piores ainda.
      const offsidePenalty = isOffsideNow(teammate) ? DECISION.pass.offsidePenalty : 0;
      const score = worth * completion - turnoverCost * (1 - completion) - offsidePenalty;
      const reason: DecisionReason = wallPass ? "wallPass" : switchValue > 0.52 ? "switchPlay" : "progressivePass";
      return { teammate, target, passDistance, score, reason, variant, purpose, receiverEta, opponentEta, completion };
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
      completion: best.completion,
      selectionReason: best.reason,
    },
  };
};
