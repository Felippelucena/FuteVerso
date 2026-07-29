import { CONDUCT, DECISION, DUEL, FIELD, GOALKEEPING, MENTALITY, PHYSICS, TACTICS } from "../config";
import { add, clamp, distance, dot, normalize, scale, subtract } from "../../shared/math";
import { mentalityBias, type FreedomInstruction } from "../../tactics/model";
import type { AgentDecision, DecisionReason, DribbleStyle, MatchState, PlayerRuntime, Vec2 } from "../model";
import { keeperHoldingBall } from "../runtime/control";
import { chooseDribbleTouch, evaluateForwardRunway, knockPastEligible } from "../runtime/dribble-runway";
import { duelEdge, duelStrength } from "../runtime/duel";
import { attackDirection, goalCenter } from "../runtime/formation-geometry";
import { goalkeeperReleasePost } from "../runtime/goalkeeper-geometry";
import { centrality, channelAffinity, clampToField, edgeRisk, fieldX, fieldY } from "../runtime/pitch";
import { predictedSpaceAt, predictionHorizon } from "../runtime/prediction";
import { isRestartTaker } from "../runtime/restart";
import { evaluateShotOpportunity } from "../runtime/shot-opportunity";
import { choosePass } from "./pass";
import { decisionNoise, nearestPlayer } from "./shared";

/**
 * A decisão de quem está com a bola: chutar, passar ou levá-la — e, levando, com que toque. É a
 * única trilha que compara utilidades entre si, porque é a única em que o jogador escolhe o que
 * FAZER com a bola em vez de para onde correr.
 */

const chooseDribbleTarget = (player: PlayerRuntime, opponents: PlayerRuntime[], state: MatchState): Vec2 => {
  const direction = attackDirection(player.team);
  const stride = fieldX(12);
  const lateral = fieldY(13);
  const collective = state.tactics[player.team].collectivePlan;
  const horizon = predictionHorizon(player, 0.58) * 0.72;
  const candidates = [-1, -0.45, 0, 0.45, 1].map((offset) => clampToField({
    x: player.position.x + direction * stride * (1 - Math.abs(offset) * 0.16),
    y: player.position.y + offset * lateral,
  }, 5));
  return candidates.sort((a, b) => {
    const utility = (target: Vec2): number => {
      const space = predictedSpaceAt(target, opponents, horizon);
      const progress = direction * (target.x - player.position.x);
      const collectiveLane = collective ? channelAffinity(target, collective.attackChannel) * (0.24 + collective.risk * 0.18) : 0;
      return space / fieldX(10) + progress / fieldX(16) + centrality(target) * edgeRisk(player.position) * 1.2
        + collectiveLane - edgeRisk(target) * 1.35;
    };
    return utility(b) - utility(a);
  })[0];
};

const openDribbleLane = (player: PlayerRuntime, target: Vec2, opponents: PlayerRuntime[]): number => {
  const direction = normalize(subtract(target, player.position));
  const blockers = opponents.flatMap((opponent) => {
    const relative = subtract(opponent.position, player.position);
    const forwardDistance = dot(relative, direction);
    const lateralDistance = Math.abs(relative.x * direction.y - relative.y * direction.x);
    return forwardDistance > 0 && lateralDistance < fieldY(6.5) ? [forwardDistance] : [];
  });
  return Math.min(fieldX(24), ...blockers);
};

/** Quanto a instrução individual do treinador acrescenta à utilidade da ação. */
const freedomAppetite = (instruction: FreedomInstruction): number => DECISION.freedomAppetite[instruction];

export const carrierDecision = (
  player: PlayerRuntime,
  teammates: PlayerRuntime[],
  opponents: PlayerRuntime[],
  state: MatchState,
): AgentDecision => {
  if (keeperHoldingBall(state, player)) {
    // Bola nas mãos (Regra 12): ele levanta, caminha até a frente da pequena área e distribui
    // quando aparece uma saída que valha — a exigência decai enquanto a janela corre. Antes isto
    // era um cronômetro fixo com o goleiro imóvel, e um corpo parado colado na linha é o que a
    // pressão empurrava para dentro da meta.
    const holdAge = state.elapsed - state.ball.controlStartedAt;
    const settling = player.goalkeeperRecoveryUntil > state.elapsed;
    const kick = choosePass(player, teammates, opponents, state);
    const patience = clamp(
      (GOALKEEPING.maximumHoldSeconds - holdAge) / (GOALKEEPING.maximumHoldSeconds - GOALKEEPING.minimumHoldSeconds),
      0,
      1,
    );
    if (kick && holdAge >= GOALKEEPING.minimumHoldSeconds && kick.score >= GOALKEEPING.releaseStandard * patience) {
      return {
        movementTarget: { ...player.position }, burst: false, posture: "inPossession",
        intent: "passing", reason: kick.reason, ballAction: kick.action,
      };
    }
    return {
      movementTarget: settling ? { ...player.position } : goalkeeperReleasePost(player, opponents),
      burst: false,
      posture: "inPossession",
      intent: "holdingBall",
      reason: "holdInHands",
      ballAction: { kind: "none" },
    };
  }
  if (isRestartTaker(state, player.profile.id)) {
    // Regra 8: quem cobra o reinício não pode tocar a bola duas vezes, então o primeiro toque é
    // obrigatoriamente um passe — não existe sair conduzindo a própria cobrança. Vale para toda
    // bola parada (saída, lateral, escanteio, tiro de meta, tiro livre).
    const kick = choosePass(player, teammates, opponents, state);
    if (kick) {
      return {
        movementTarget: { ...player.position },
        burst: false,
        posture: "inPossession",
        intent: "passing",
        reason: kick.reason,
        ballAction: kick.action,
      };
    }
  }
  const duelOpponent = nearestPlayer(player.position, opponents);
  const closestOpponent = duelOpponent ? distance(player.position, duelOpponent.position) : FIELD.width;
  const opponentToCarrier = duelOpponent ? normalize(subtract(player.position, duelOpponent.position)) : { x: 0, y: 0 };
  const closingSpeed = duelOpponent ? dot(subtract(duelOpponent.velocity, player.velocity), opponentToCarrier) : 0;
  const pass = choosePass(player, teammates, opponents, state);
  const policy = player.memory.policy;
  const pressure = clamp(1 - closestOpponent / fieldX(7), 0, 1);
  const composure = player.profile.mental.composure / 100;
  const creativity = player.profile.mental.creativity / 100;
  const aggression = player.profile.mental.aggression / 100;
  const teamwork = player.profile.mental.teamwork / 100;
  const decisions = player.profile.mental.decisionMaking / 100;
  const carrierStrength = duelStrength(player, "holder");
  const escapeConfidence = clamp((carrierStrength - DUEL.escapeConfidenceBase) / DUEL.escapeConfidenceSpan, 0, 1);
  const carrier = DECISION.carrier;
  const finalThirdUrgency = state.tactics[player.team].phase === "finalThird"
    ? clamp((state.elapsed - state.tactics[player.team].phaseStartedAt) / 6, 0, 1) * carrier.finalThirdUrgency
    : 0;
  const shot = evaluateShotOpportunity(player, opponents, state);
  const clearChanceBonus = shot && !shot.blocked && shot.distance < fieldX(18) ? carrier.clearChanceBonus : 0;
  const shotUtility = shot ? shot.utility + clearChanceBonus + finalThirdUrgency + aggression * 0.12
    + composure * pressure * 0.1 + freedomAppetite(player.instruction.shootFreedom)
    + decisionNoise(player, state, 11) : -1;
  const passUtility = pass ? pass.score + policy.pass * carrier.passPolicyWeight
    + pressure * (carrier.passUnderPressure + composure * 0.2)
    + edgeRisk(player.position) * carrier.passFromEdge + teamwork * 0.14 + decisions * 0.1
    + decisionNoise(player, state, 23) : -1;
  const controlAge = Math.max(0, state.elapsed - state.ball.controlStartedAt);
  const baseDribbleTarget = chooseDribbleTarget(player, opponents, state);
  // O toque à frente segue o MESMO rumo que o portador escolheu para levar a bola, e não o eixo do
  // gol: quem pesa espaço, marcador e risco de linha é `chooseDribbleTarget`, e o corredor só mede
  // o que cabe naquele rumo. Eram duas respostas para "para onde eu levo a bola", e o toque à
  // frente — 87% dos dribles — usava a que não olha para ninguém.
  const dribbleHeading = normalize(subtract(baseDribbleTarget, player.position));
  const forwardRunway = evaluateForwardRunway(state, player, dribbleHeading);
  const touchChoice = chooseDribbleTouch(state, player, forwardRunway);
  const etaAdvantage = touchChoice.opponentEta - touchChoice.carrierEta;
  const breakEligible = forwardRunway.distance >= fieldX(23)
    && player.sprintEnergy > 0.5
    && etaAdvantage >= 0.35;
  const activeBreak = player.objective === "aggressiveBreak" && state.elapsed < player.objectiveExpiresAt
    && forwardRunway.distance >= fieldX(13) && player.sprintEnergy > 0.4;
  const dribbleSpace = predictedSpaceAt(baseDribbleTarget, opponents, predictionHorizon(player, pressure));
  // Item 3: valor de "conduzir para abrir um chute melhor". Avalia o chute que existiria após
  // um toque à frente (touchChoice.target) e credita o ganho sobre o chute de agora.
  const goalTargetPoint = goalCenter(player.team, false);
  const carryOrigin = touchChoice.target;
  const futureShot = touchChoice.range
    ? evaluateShotOpportunity(player, opponents, state, { origin: { position: carryOrigin, facing: subtract(goalTargetPoint, carryOrigin) } })
    : null;
  const carryShotGain = (futureShot?.utility ?? -1) - (shot?.utility ?? -1);
  const carryShotBonus = futureShot && !futureShot.blocked
    && forwardRunway.distance >= touchChoice.touchDistance
    && futureShot.distance < fieldX(CONDUCT.carryShotMaxDistance)
    ? clamp(carryShotGain - CONDUCT.carryShotMinGain, 0, CONDUCT.carryShotCap) * CONDUCT.carryShotWeight
    : 0;
  const dribbleUtility = policy.dribble * carrier.dribblePolicyWeight
    + clamp(dribbleSpace / fieldX(carrier.dribbleSpaceReference), 0, 1.4)
    + creativity * 0.22 + aggression * 0.08
    - pressure * (0.8 - composure * 0.16 - escapeConfidence * 0.82)
    - edgeRisk(baseDribbleTarget) * carrier.dribbleFromEdge
    + (breakEligible ? clamp(forwardRunway.distance / fieldX(45), 0, 1) * carrier.breakBonus : 0)
    + (activeBreak ? carrier.breakContinuation : 0)
    + carryShotBonus
    + freedomAppetite(player.instruction.dribbleFreedom)
    + decisionNoise(player, state, 37);
  const clearShootingChance = Boolean(shot && !shot.blocked && shot.distance < fieldX(18));
  if (clearShootingChance && pass && passUtility > shotUtility + carrier.clearChancePassEdge) {
    return { movementTarget: player.position, burst: false, posture: "inPossession", intent: "passing", reason: pass.reason, ballAction: pass.action };
  }
  if (clearShootingChance && shot) {
    return {
      movementTarget: player.position,
      burst: false,
      posture: "inPossession",
      intent: "shooting",
      reason: "shootingWindow",
      ballAction: shot.action,
    };
  }
  if (shot && shotUtility >= passUtility && shotUtility >= dribbleUtility) {
    return {
      movementTarget: player.position,
      burst: false,
      posture: "inPossession",
      intent: "shooting",
      reason: shot.isLong ? "longShot" : "shootingWindow",
      ballAction: shot.action,
    };
  }
  const passAdvantageRequired = pressure > 0.25
    ? carrier.passAdvantageUnderPressure + escapeConfidence * 0.32 + creativity * 0.08 - teamwork * 0.1
    : carrier.passAdvantageInSpace + creativity * 0.08 - teamwork * 0.12;
  // Eixo `tempo`: o único ponto em que o treinador acelera ou segura a circulação. Ele encurta o
  // tempo que o portador leva acomodando a bola antes de considerar entregá-la.
  const settleSeconds = TACTICS.carrierSettleSeconds
    * (1 - mentalityBias(state.tactics[player.team].directives.mentality.tempo) * MENTALITY.tempo);
  const hasSettledPossession = controlAge > settleSeconds || pressure > 0.68 || player.profile.position === "goalkeeper";
  if (pass && hasSettledPossession && passUtility >= dribbleUtility + passAdvantageRequired) {
    return { movementTarget: player.position, burst: false, posture: "inPossession", intent: "passing", reason: pass.reason, ballAction: pass.action };
  }
  const continueBreak = activeBreak && (!pass || passUtility < dribbleUtility + 0.25);
  const startBreak = breakEligible && (!pass || passUtility < dribbleUtility + 0.25);
  const reason: DecisionReason = startBreak || continueBreak
    ? "aggressiveBreak"
    : pressure > 0.58 || edgeRisk(player.position) > 0.38 ? "escapePressure" : "carryIntoSpace";
  const defenderCanDuel = Boolean(duelOpponent && duelOpponent.reactionTimer <= 0 && duelOpponent.duelCooldown <= 0);
  // A finta só engaja quando o marcador está no raio de colisão (raios quase se tocando),
  // não em espaço vazio: distância < raio + raio + margem.
  const radiiTouch = player.radius + (duelOpponent ? duelOpponent.radius : player.radius);
  const defenderIsCommitting = defenderCanDuel
    && closestOpponent < radiiTouch + DUEL.feintEngageMargin
    && (closingSpeed > 0.65 || closestOpponent < radiiTouch);
  // Encarar ou não é uma comparação com ESTE marcador, não uma nota absoluta de habilidade: a
  // pergunta útil no 1x1 é "sou melhor que ele?", e é a mesma conta que resolve a finta depois.
  const canFeint = controlAge >= PHYSICS.feintControlSettleTime
    && player.reactionTimer <= 0
    && player.duelCooldown <= 0
    && creativity > 0.48
    && Boolean(duelOpponent && duelEdge(player, duelOpponent) > DUEL.feintConfidenceEdge);
  const laneSpace = openDribbleLane(player, baseDribbleTarget, opponents);
  // Diante de um marcador comprometido, o técnico finta e o veloz ergue a bola por cima e corre
  // atrás. Em espaço livre é sempre knock-on; a bola colada (carry) fica para o apertado, quando
  // não há pique possível.
  const canKnockPast = Boolean(duelOpponent && knockPastEligible(state, player, duelOpponent));
  const style: DribbleStyle = defenderIsCommitting && canFeint
    ? "feint"
    : defenderIsCommitting && canKnockPast
      ? "knockPast"
      : touchChoice.range
        ? "knockOn"
        : "carry";
  const touchDistance = style === "knockOn"
    ? touchChoice.touchDistance
    : style === "feint" || style === "knockPast"
      ? clamp(laneSpace * 0.62, fieldX(10), fieldX(16))
      : clamp(laneSpace * 0.66, fieldX(9.6), fieldX(14.4));
  const dribbleTarget = style === "knockOn"
    ? touchChoice.target
    : clampToField(add(player.position, scale(normalize(subtract(baseDribbleTarget, player.position)), touchDistance)), 5);
  const intent: AgentDecision["intent"] = style === "knockOn" || style === "knockPast"
    ? "knockingOn"
    : style === "feint"
      ? "feinting"
      : "carrying";
  return {
    movementTarget: dribbleTarget,
    burst: style !== "carry",
    posture: "inPossession",
    intent,
    reason,
    ballAction: {
      kind: "dribble",
      target: dribbleTarget,
      style,
      touchRange: style === "knockOn" ? touchChoice.range ?? undefined : undefined,
      runway: touchChoice.runway,
      carrierEta: touchChoice.carrierEta,
      opponentEta: touchChoice.opponentEta,
      rangeReason: touchChoice.reason,
    },
  };
};
