import { COGNITION, CONDUCT, CONTEST, DEFENSE, DUEL, FIELD, GOALKEEPING, MENTALITY, OFFSIDE, PHYSICS, TACTICS } from "./config";
import { add, clamp, distance, distanceToSegment, dot, normalize, scale, subtract } from "../shared/math";
import { mentalityBias, type FreedomInstruction } from "../tactics/model";
import type { AgentDecision, AssignmentDuty, BallAction, DecisionReason, DribbleStyle, MatchState, PlanTarget, PlayerPlan, PlayerRuntime, Team, Vec2 } from "./model";
import { chasersFor, readBallSituation } from "./runtime/ball-situation";
import { activeBallPlayerId, ballHeldByKeeper, keeperHoldingBall } from "./runtime/control";
import { goalkeeperReleasePost } from "./runtime/goalkeeper-geometry";
import { resolveMarking, type MarkingAssignment } from "./runtime/marking";
import { duelEdge, duelStrength } from "./runtime/duel";
import { isRestartTaker, restartLayoutTarget } from "./runtime/restart";
import { offsideLineProgress } from "./runtime/offside";
import {
  attackingProgress,
  centrality,
  channelAffinity,
  channelY,
  clampToField,
  edgeRisk,
  fieldX,
  fieldY,
} from "./runtime/pitch";
import {
  interceptionThreat,
  predictBallPosition,
  predictPlayerPosition,
  predictPlayerAlongPlan,
  predictedSpaceAt,
  predictionHorizon,
} from "./runtime/prediction";
import { estimatePassDuration } from "./runtime/pass-trajectory";
import { etaToPoint, playerSkillSpeed } from "./runtime/player-metrics";
import { chooseDribbleTouch, evaluateForwardRunway, knockPastEligible } from "./runtime/dribble-runway";
import { classifyPassPurpose } from "./runtime/pass-purpose";
import { evaluateShotOpportunity } from "./runtime/shot-opportunity";
import { goalkeeperDecision, goalkeeperMovementTarget } from "./systems/goalkeeper-system";
import { assignedAnchor, assignmentOf, dutyHolders } from "./systems/assignment-system";
import { attackDirection, formationAnchor, goalCenter } from "./runtime/formation-geometry";
import { prepareReceptionAction } from "./runtime/reception-planning";

// A geometria da grade tática (célula → gramado) vive em runtime/formation-geometry, porque o
// plano coletivo também precisa dela. Reexportadas aqui para quem já as importava daqui.
export { attackDirection, formationAnchor };

export const PASS_VARIANTS = (["ground", "air"] as const).flatMap((trajectory) =>
  (["short", "long"] as const).flatMap((range) =>
    (["feet", "space"] as const).map((targeting) => ({ trajectory, range, targeting })),
  ),
);

const PERCEPTION = {
  intervention: fieldX(12),
  support: fieldX(28),
  cooperation: fieldX(47),
} as const;

const blend = (a: Vec2, b: Vec2, amount: number): Vec2 => ({
  x: a.x * (1 - amount) + b.x * amount,
  y: a.y * (1 - amount) + b.y * amount,
});

/**
 * Custo de jogar fora de posição, em cima do encaixe (`positionFit`) que o plano tático
 * calculou. Encaixe 1 (posição natural) não cobra nada; o pior improviso possível hoje é 0,55.
 *
 * A referência é a "familiaridade" do FC IQ, que pesa de 10% a 40% do resultado conforme o
 * contexto: aqui o improviso encarece o erro de decisão em até ~27% e alarga o intervalo de
 * pensamento em até ~14%. Não mexe nas habilidades — um zagueiro improvisado de lateral não
 * fica mais lento, ele lê o jogo pior naquela função.
 */
const outOfPositionCost = (player: PlayerRuntime): number => clamp(1 - player.positionFit, 0, 1);

const decisionNoise = (player: PlayerRuntime, state: MatchState, salt: number): number => {
  let hash = (state.randomSeed ^ Math.imul(Math.floor(state.elapsed / COGNITION.teamTickSeconds) + salt, 2654435761)) >>> 0;
  for (let index = 0; index < player.profile.id.length; index += 1) hash = Math.imul(hash ^ player.profile.id.charCodeAt(index), 16777619) >>> 0;
  const normalized = hash / 0xffff_ffff * 2 - 1;
  return normalized * (1 - player.profile.mental.decisionMaking / 100) * 0.34
    * (1 + outOfPositionCost(player) * 0.6);
};

const nearestPlayer = (origin: Vec2, players: PlayerRuntime[]): PlayerRuntime | null =>
  [...players].sort((a, b) => distance(origin, a.position) - distance(origin, b.position))[0] ?? null;

const perceptionDepth = (player: PlayerRuntime, ballPosition: Vec2): number =>
  clamp((distance(player.position, ballPosition) - PERCEPTION.intervention) / (PERCEPTION.cooperation - PERCEPTION.intervention), 0, 1);

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
      const wallPassBonus = wallPass ? 0.64 : 0;
      const roleBonus = teammate.profile.role === "finisher" ? Math.max(0, progress) / fieldX(35) : 0;
      const backwardsSafety = progress < 0 && openness > fieldX(7) ? 0.22 : 0;
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
      const dutyBonus = !collective || !receiverDuty ? 0
        : receiverDuty.duty === "runInBehind" ? (0.34 + collective.risk * 0.18) / (1 + receiverDuty.priority * 0.6)
          : receiverDuty.duty === "overlap" ? 0.2
            : receiverDuty.duty === "support" ? 0.18 / (1 + receiverDuty.priority)
              : receiverDuty.duty === "restDefense" && progress < 0
                ? (1 - collective.risk) * 0.3 / (1 + receiverDuty.priority)
                : 0;
      const collectiveBonus = collective
        ? dutyBonus
          + channelAffinity(target, collective.attackChannel) * 0.2
          + (collective.buildUpStyle === "direct"
            ? clamp(progress / fieldX(24), -0.12, 0.3)
            : collective.buildUpStyle === "short"
              ? clamp(1 - passDistance / fieldX(24), 0, 1) * 0.24
              : 0)
        : 0;
      const purposeBonus = purpose === "cutback" ? 0.42
        : purpose === "cross" ? (teammate.profile.role === "finisher" ? 0.32 : 0.14)
          : purpose === "throughBall" ? 0.28
            : purpose === "layoff" && wallPass ? 0.22
              : 0;
      // Passar para um companheiro já impedido é jogar fora a posse: penalidade dura, que só o
      // deixa competitivo se todas as outras saídas forem piores ainda (um raro chutão de aposta).
      const offsidePenalty = isOffsideNow(teammate) ? 5 : 0;
      const score = clamp(progress / fieldX(24), -0.8, 1.45)
        + clamp(openness / fieldX(14), 0, 1.18) + centrality(target) * 0.18 + roleBonus
        + switchValue + wallPassBonus + backwardsSafety + collectiveBonus + aerialValue + purposeBonus
        + (longProgression ? passerTechnique * 0.36 : 0)
        + (player.profile.mental.teamwork - 50) / 100 * 0.22
        + (player.profile.mental.decisionMaking - 50) / 100 * 0.16
        + (player.profile.mental.creativity - 50) / 100 * (blocked ? 0.2 : 0.06)
        - passDistance / fieldX(72) - rangePenalty - offsidePenalty
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

/**
 * Quanto a instrução individual acrescenta à utilidade da ação. `normal` vale zero: o padrão do
 * treinador não mexe em nada, e é isso que mantém o comportamento emergente como estava.
 */
const FREEDOM_APPETITE: Record<FreedomInstruction, number> = { rarely: -0.4, normal: 0, often: 0.4 };

const carrierDecision = (
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
  const finalThirdUrgency = state.tactics[player.team].phase === "finalThird"
    ? clamp((state.elapsed - state.tactics[player.team].phaseStartedAt) / 6, 0, 1) * 0.22
    : 0;
  const shot = evaluateShotOpportunity(player, opponents, state);
  const clearChanceBonus = shot && !shot.blocked && shot.distance < fieldX(18) ? 1.45 : 0;
  const shotUtility = shot ? shot.utility + clearChanceBonus + finalThirdUrgency + aggression * 0.12
    + composure * pressure * 0.1 + FREEDOM_APPETITE[player.instruction.shootFreedom]
    + decisionNoise(player, state, 11) : -1;
  const passUtility = pass ? pass.score + policy.pass * 0.52 + pressure * (0.58 + composure * 0.2)
    + edgeRisk(player.position) * 0.62 + teamwork * 0.14 + decisions * 0.1 + decisionNoise(player, state, 23) : -1;
  const controlAge = Math.max(0, state.elapsed - state.ball.controlStartedAt);
  const baseDribbleTarget = chooseDribbleTarget(player, opponents, state);
  const forwardRunway = evaluateForwardRunway(state, player);
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
    ? evaluateShotOpportunity(player, opponents, state, false, undefined, { position: carryOrigin, facing: subtract(goalTargetPoint, carryOrigin) })
    : null;
  const carryShotGain = (futureShot?.utility ?? -1) - (shot?.utility ?? -1);
  const carryShotBonus = futureShot && !futureShot.blocked
    && forwardRunway.distance >= touchChoice.touchDistance
    && futureShot.distance < fieldX(CONDUCT.carryShotMaxDistance)
    ? clamp(carryShotGain - CONDUCT.carryShotMinGain, 0, CONDUCT.carryShotCap) * CONDUCT.carryShotWeight
    : 0;
  const dribbleUtility = policy.dribble * 0.62
    + clamp(dribbleSpace / fieldX(15), 0, 1.4)
    + creativity * 0.22 + aggression * 0.08
    - pressure * (0.8 - composure * 0.16 - escapeConfidence * 0.82)
    - edgeRisk(baseDribbleTarget) * 0.55
    + (breakEligible ? clamp(forwardRunway.distance / fieldX(45), 0, 1) * 0.54 : 0)
    + (activeBreak ? 0.32 : 0)
    + carryShotBonus
    + FREEDOM_APPETITE[player.instruction.dribbleFreedom]
    + decisionNoise(player, state, 37);
  const clearShootingChance = Boolean(shot && !shot.blocked && shot.distance < fieldX(18));
  if (clearShootingChance && pass && passUtility > shotUtility + 0.18) {
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
    ? 0.08 + escapeConfidence * 0.32 + creativity * 0.08 - teamwork * 0.1
    : 0.38 + creativity * 0.08 - teamwork * 0.12;
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

/**
 * Profundidade do apoio por dever, em percentual da largura do campo à frente do portador.
 * Antes vinha de `profile.role`, que tem três valores e não sabia o que o time estava pedindo:
 * agora vem da incumbência, que é o que o coletivo de fato decidiu para este jogador agora.
 */
const DUTY_DEPTH: Record<AssignmentDuty, { fast: number; final: number; base: number }> = {
  runInBehind: { fast: 33, final: 28, base: 23 },
  overlap: { fast: 30, final: 26, base: 22 },
  width: { fast: 18, final: 15, base: 12 },
  support: { fast: 12, final: 9, base: 7 },
  restDefense: { fast: -22, final: -24, base: -18 },
  holdLine: { fast: 8, final: 6, base: 4 },
  // Deveres que nunca chegam aqui (quem tem a bola, quem pressiona, o goleiro) ficam neutros.
  carry: { fast: 0, final: 0, base: 0 },
  receive: { fast: 0, final: 0, base: 0 },
  press: { fast: 0, final: 0, base: 0 },
  trackRunner: { fast: 0, final: 0, base: 0 },
  goalkeep: { fast: 0, final: 0, base: 0 },
};

/** Largura do bolsão de recepção que cada dever procura, em unidades verticais do campo. */
const DUTY_WIDTH: Record<AssignmentDuty, number> = {
  width: 22, support: 21, overlap: 20, runInBehind: 16, restDefense: 10,
  holdLine: 10, press: 10, trackRunner: 10, carry: 0, receive: 0, goalkeep: 0,
};

const supportTarget = (
  player: PlayerRuntime,
  controller: PlayerRuntime,
  state: MatchState,
): { target: Vec2; reason: DecisionReason; burst: boolean } => {
  const direction = attackDirection(player.team);
  const collective = state.tactics[player.team].collectivePlan;
  const assignment = assignmentOf(collective, player.profile.id);
  // A âncora do apoio é a célula que o coletivo entregou, não a posição fixa da escalação. É
  // ela que faz o bloco inteiro deslizar com o canal de ataque e subir com a fase.
  const anchor = assignedAnchor(collective, player);
  const duty = assignment?.duty ?? "support";
  const supportDepth = perceptionDepth(player, state.ball.position);
  const phase = state.tactics[player.team].phase;
  const phaseIsFast = phase === "counterAttack";
  const phaseIsFinal = phase === "finalThird";
  // O lado do bolsão vem da célula do jogador em relação ao portador: quem foi encarregado da
  // faixa de cima oferece a linha por cima. Antes era a paridade do índice na escalação.
  const side = anchor.y <= controller.position.y ? -1 : 1;
  const controllerNearEdge = edgeRisk(controller.position);
  const depth = DUTY_DEPTH[duty];
  const roleDepth = fieldX(phaseIsFast ? depth.fast : phaseIsFinal ? depth.final : depth.base);
  const anticipatedRoleDepth = roleDepth * (0.86 + player.profile.mental.anticipation / 500);
  const roleWidth = fieldY(DUTY_WIDTH[duty]);
  const reason: DecisionReason = assignment?.rationale ?? "giveWidth";
  const horizon = predictionHorizon(player, phaseIsFast ? 0.82 : 0.42);
  const predictedController = predictPlayerPosition(controller, horizon * 0.55);
  const preferredY = collective
    ? channelY(collective.attackChannel)
    : controller.position.y + side * roleWidth;
  const channelPull = duty === "runInBehind" ? 0.72 : duty === "support" ? 0.42 : duty === "width" ? 0.1 : 0.18;
  const passingPocket = {
    x: predictedController.x + direction * anticipatedRoleDepth,
    y: blend({ x: 0, y: predictedController.y + side * roleWidth }, { x: 0, y: preferredY }, channelPull).y,
  };
  if (duty === "restDefense") {
    const gap = fieldX(phase === "buildUp" ? 18 : phase === "progression" ? 20 : phaseIsFast ? 22 : 24);
    const ballLine = state.ball.position.x - direction * gap;
    const transitionThreats = state.players.filter((candidatePlayer) => candidatePlayer.team !== player.team
      && direction * (state.ball.position.x - candidatePlayer.position.x) > 0
      && distance(candidatePlayer.position, state.ball.position) < fieldX(36)
      && candidatePlayer.profile.position !== "goalkeeper");
    const threat = [...transitionThreats].sort((first, second) => direction > 0
      ? first.position.x - second.position.x
      : second.position.x - first.position.x)[0];
    const threatGuard = threat ? threat.position.x - direction * fieldX(5) : ballLine;
    const safeX = direction > 0 ? Math.min(ballLine, threatGuard, state.ball.position.x - fieldX(7))
      : Math.max(ballLine, threatGuard, state.ball.position.x + fieldX(7));
    return {
      target: clampToField({ x: safeX, y: blend(anchor, { x: safeX, y: state.ball.position.y }, 0.34).y }, 5),
      reason: "restDefense",
      burst: false,
    };
  }
  // A profundidade da âncora **é** o acompanhamento da bola: a altura de linha do time sai da
  // posição dela. Somar aqui outra vez faria o bloco perseguir a bola em dobro e se esticar.
  // Quem segura a largura quase não desliza atrás do portador: a função dele é justamente não
  // fechar a faixa que o time precisa manter aberta.
  const base = {
    x: anchor.x,
    y: anchor.y + (controller.position.y - FIELD.height / 2) * (duty === "width" ? 0.12 : 0.28),
  };
  const candidate = blend(passingPocket, base, 0.35 + supportDepth * 0.4);
  if (controllerNearEdge > 0.35) candidate.y = blend(candidate, { x: candidate.x, y: FIELD.height / 2 }, controllerNearEdge * 0.65).y;
  const nearby = state.players.filter((candidatePlayer) => candidatePlayer.team === player.team && candidatePlayer.profile.id !== player.profile.id);
  const separation = nearby.reduce((force, teammate) => {
    const gap = distance(candidate, teammate.position);
    if (gap >= fieldX(10) || gap < 0.01) return force;
    return add(force, scale(normalize(subtract(candidate, teammate.position)), (fieldX(10) - gap) * 0.72));
  }, { x: 0, y: 0 });
  const nearestOpponent = nearestPlayer(candidate, state.players.filter((candidatePlayer) => candidatePlayer.team !== player.team));
  const escapeOpponent = nearestOpponent && distance(nearestOpponent.position, candidate) < fieldX(7)
    ? scale(normalize(subtract(candidate, nearestOpponent.position)), fieldX(4))
    : { x: 0, y: 0 };
  const target = clampToField(add(add(candidate, separation), escapeOpponent), 5);
  const targetGap = distance(player.position, target);
  const forwardProgress = direction * (target.x - player.position.x);
  const transitionAge = state.elapsed - state.controlChangedAt;
  // O rest defense já saiu por cima, com alvo próprio: aqui só passa quem apoia o ataque.
  const transitionRun = phaseIsFast
    && transitionAge < TACTICS.counterAttackWindow * 0.72
    && forwardProgress > fieldX(7)
    && targetGap > fieldX(10);
  const depthRun = (duty === "runInBehind" || duty === "overlap")
    && phase !== "buildUp"
    && forwardProgress > fieldX(8)
    && targetGap > fieldX(11)
    && (phaseIsFinal || phaseIsFast || controller.velocity.x * direction > 2.5);
  const workThreshold = 0.58 - player.profile.mental.intensity / 500;
  const burst = player.sprintEnergy > workThreshold && player.sprintCooldown <= 0 && (transitionRun || depthRun);
  return { target, reason, burst };
};

/**
 * Ir até onde a bola vai estar. É o mesmo movimento para quem empurrou a bola à frente num
 * pique, para quem espera o passe e para quem vai tomá-la de alguém: muda o rótulo, a postura e
 * o ponto exato de chegada, não o trajeto.
 *
 * É aqui que morre o detector de desvio caseiro da recepção. Se a bola muda de rota, o ponto de
 * encontro muda com ela; quem deixou de chegar primeiro deixa de ser o dono do lance, sem que
 * ninguém precise reconhecer um "desvio".
 */
const pursueBallDecision = (player: PlayerRuntime, state: MatchState, team: Team, committed: boolean): AgentDecision => {
  const situation = state.ballSituation;
  const ownKnockOn = state.ball.dribbleOwnerId === player.profile.id;
  const awaitingPass = state.pendingPass?.receiverId === player.profile.id;
  // O rótulo sai de POR QUE a bola é minha, e não de como ela está rolando: continuo o meu
  // pique, recebo o passe que veio para mim, ou vou tomar uma bola que não era de ninguém.
  const mine = ownKnockOn || awaitingPass;
  const style = state.ball.dribbleStyle;
  const intent: AgentDecision["intent"] = ownKnockOn
    ? style === "feint" ? "feinting" : style === "carry" ? "carrying" : "knockingOn"
    : awaitingPass ? "receiving" : "pressing";
  // Bola minha: vou nela. Bola a tomar: chego pelo lado do próprio gol, fechando a saída em vez
  // de correr atrás por trás.
  const phase = state.tactics[team].phase;
  const aggressive = committed || situation.phase === "contested"
    || phase === "counterPress" || phase === "highPress";
  const target = mine ? { ...situation.contactPoint } : add(
    situation.contactPoint,
    scale(
      normalize(subtract(goalCenter(team, true), situation.contactPoint)),
      player.radius * (aggressive ? 0.95 : 1.75),
    ),
  );
  if (!mine && state.tactics[team].collectivePlan?.pressTrigger === "touchline") {
    target.y += (situation.contactPoint.y < FIELD.height / 2 ? 1 : -1) * player.radius * 0.9;
  }
  const runSpeed = playerSkillSpeed(player) * PHYSICS.runSpeedFactor;
  const gap = distance(player.position, target);
  // Bola minha: só queimo pique se for chegar tarde ou se houver alguém no páreo. Bola a tomar:
  // solta se corre atrás, dominada se pressiona andando — e é esse pique que transforma um toque
  // adiantado do adversário numa chance de dividida.
  const race = mine
    ? gap / Math.max(0.12, situation.contactIn) > runSpeed * 0.88 || situation.margin < CONTEST.settleMargin
    : committed || situation.phase !== "controlled";
  const burst = race && player.sprintCooldown <= 0 && player.sprintEnergy > (mine ? 0.48 : 0.12);
  const raceSpeed = playerSkillSpeed(player) * PHYSICS.burstSpeedFactor;
  return {
    movementTarget: clampToField(target, 3),
    burst,
    burstDuration: burst
      ? clamp(gap / Math.max(1, raceSpeed * 0.78), PHYSICS.burstDuration, 1.45)
      : undefined,
    posture: mine ? "inPossession" : "outOfPossession",
    intent,
    reason: ownKnockOn ? "carryIntoSpace" : awaitingPass ? "attackReception" : "pressBall",
    ballAction: { kind: "none" },
  };
};

const defensiveTarget = (
  player: PlayerRuntime,
  marking: MarkingAssignment | null,
  state: MatchState,
): { target: Vec2; intent: AgentDecision["intent"]; burst: boolean; reason: DecisionReason; burstDuration?: number } => {
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
    return { target: recoverPoint, intent: "covering", reason: "recoverShape", burst: true, burstDuration };
  }
  const defensiveBurst = player.sprintEnergy > 0.5
    && player.sprintCooldown <= 0
    && player.profile.mental.intensity > 78
    && distance(player.position, target) > fieldX(12)
    && (phase === "counterPress" || phase === "recovery");
  return { target, intent, reason, burst: defensiveBurst };
};

export const decideAll = (state: MatchState): Map<string, AgentDecision> => {
  const decisions = new Map<string, AgentDecision>();
  // O motor tem dois começos de leitura-para-decidir: o coletivo (`updateTacticalContext`) e o
  // individual, aqui. Os dois medem a situação da bola antes de olhar para ela — é uma função
  // só, lida em dois momentos, e não duas fontes.
  const situation = state.ballSituation = readBallSituation(state);
  const actualController = state.players.find((player) => player.profile.id === state.ball.controllerId) ?? null;
  // Quem manda na bola solta é quem vence a corrida por ela — e só enquanto a corrida tiver um
  // vencedor claro. Em disputa aberta ninguém a tem, e é isso que solta os dois times para ir
  // nela. Antes esta linha era a mesma confusão de `activeBallPlayerId`, reescrita aqui.
  const controller = actualController ?? (situation.phase === "owned" && situation.favourite
    ? state.players.find((player) => player.profile.id === situation.favourite?.playerId) ?? null
    : null);
  const heldByKeeper = ballHeldByKeeper(state);
  for (const team of ["blue", "coral"] as const) {
    const teammates = state.players.filter((player) => player.team === team);
    const opponents = state.players.filter((player) => player.team !== team);
    const teamHasPossession = controller?.team === team;
    const plan = state.tactics[team].collectivePlan;
    // Quem vai à bola sai da CORRIDA, a cada quadro — não de um papel escolhido segundos atrás,
    // quando a bola estava em outro lugar. O plano tático segue mandando no que é dele: gatilho
    // desligado é abrir mão de sair para uma bola que o adversário domina. Bola em aberto,
    // porém, ninguém recusa — é o que "disputa" quer dizer.
    const mayLeaveShape = situation.phase === "contested" || !plan || plan.pressTrigger !== null;
    const slots = situation.phase === "contested" ? CONTEST.contestSlots : CONTEST.pressSlots;
    // Regra 12: bola nas mãos do goleiro adversário não se persegue — ela não pode ser tomada.
    // O time recua e marca as saídas (todos caem no alvo defensivo), em vez de correr para cima
    // de um corpo que ninguém pode disputar.
    const unpressable = heldByKeeper !== null && heldByKeeper.team !== team;
    const chasers = mayLeaveShape && !teamHasPossession && !unpressable ? chasersFor(state, team, slots) : [];
    // O segundo engajador é outra decisão, não um segundo lugar na corrida: é o zagueiro que sai
    // da linha para dividir com um portador sem pressão dentro do nosso terço. Vem do dever.
    const stepper = unpressable ? null : dutyHolders(plan, "press")[1] ?? null;
    // Quem marca quem, resolvido agora e para o time inteiro de uma vez — é aqui que a
    // exclusividade entre defensores cabe, sem ninguém precisar de estado global.
    const marking = resolveMarking(state, team, plan);
    for (const player of teammates) {
      // Bola parada: enquanto a bola está parada no ponto e o cobrador caminha, todos vão para o
      // desenho do reinício (a fonte de incumbência com prioridade sobre a cognição normal, até o
      // goleiro do tiro de meta). Cai fora no instante em que o cobrador assume a posse — daí ele
      // segue no fluxo normal (carrierDecision) e cobra com um passe.
      if (state.restart && !state.restart.ballInPlay && state.ball.controllerId !== player.profile.id) {
        // O cobrador trota direto até a bola (intent "sprinting" corre sem desacelerar perto do
        // alvo, senão ele engatinharia o último trecho e estouraria o teto de preparo). Os demais
        // apenas se reposicionam.
        const isTaker = player.profile.id === state.restart.takerId;
        decisions.set(player.profile.id, {
          movementTarget: restartLayoutTarget(player, state),
          burst: false,
          posture: player.team === state.restart.team ? "inPossession" : "outOfPossession",
          intent: isTaker ? "sprinting" : "covering",
          reason: "recoverShape",
          ballAction: { kind: "none" },
        });
        continue;
      }
      // O goleiro tem cérebro próprio (goalkeeper-system): a posição de guarda, a saída e a defesa
      // saem todas de lá. Ele só entra no fluxo comum quando é ELE que vai jogar a bola — nas
      // mãos, cobrando um reinício ou como destino de um passe do próprio time. Ganhar uma
      // corrida qualquer não o tira do gol: a saída dele tem régua própria, mais estrita.
      const keeperPlaysBall = state.ball.controllerId === player.profile.id
        || (state.pendingPass?.receiverId === player.profile.id && state.pendingPass.team === player.team);
      if (player.profile.position === "goalkeeper" && !keeperPlaysBall) {
        decisions.set(player.profile.id, goalkeeperDecision(player, state));
        continue;
      }
      if (actualController?.profile.id === player.profile.id) {
        decisions.set(player.profile.id, carrierDecision(player, teammates, opponents, state));
        continue;
      }
      // Ir buscar a bola que é sua é COMPROMISSO, não corrida que se desiste: quem empurrou a
      // bola à frente vai atrás dela, e quem foi mirado num passe vai recebê-lo — mesmo com um
      // adversário chegando antes. Quem desiste porque perdeu a corrida não disputa nada, e o
      // passe morre sem ninguém em cima dele.
      const committedToBall = !state.ball.controllerId
        && (state.ball.dribbleOwnerId === player.profile.id
          || state.pendingPass?.receiverId === player.profile.id);
      if (committedToBall || controller?.profile.id === player.profile.id) {
        decisions.set(player.profile.id, pursueBallDecision(player, state, team, false));
        continue;
      }
      if (teamHasPossession && controller) {
        const support = supportTarget(player, controller, state);
        decisions.set(player.profile.id, {
          movementTarget: support.target,
          burst: support.burst,
          posture: "inPossession",
          intent: "supporting",
          reason: support.reason,
          ballAction: { kind: "none" },
        });
        continue;
      }
      // Ir à bola tem duas origens, e uma só forma de andar: ganhar a corrida por ela, ou ter
      // sido mandado sair da linha para dividir (o segundo engajador, que é uma aposta do plano
      // e por isso vai comprometido, mesmo perdendo a corrida).
      const committed = stepper === player.profile.id;
      if (committed || chasers.includes(player.profile.id)) {
        decisions.set(player.profile.id, pursueBallDecision(player, state, team, committed));
        continue;
      }
      // Por quem ele responde vem da leitura do quadro, não de um id decidido segundos atrás:
      // o vizinho que entrou na faixa dele agora é o problema dele agora.
      const { target, intent, burst, reason, burstDuration } = defensiveTarget(
        player,
        marking.get(player.profile.id) ?? null,
        state,
      );
      decisions.set(player.profile.id, { movementTarget: target, burst, burstDuration, posture: "outOfPossession", intent, reason, ballAction: { kind: "none" } });
    }
  }
  return decisions;
};

/** As intenções que só o goleiro produz. Todas resolvem o alvo pelo próprio sistema, a cada tick. */
const GOALKEEPER_INTENTS: ReadonlySet<AgentDecision["intent"]> = new Set([
  "goalkeeping", "preparingSave", "diving", "jumping", "claimingHighBall", "recoveringSave",
]);

const planTarget = (player: PlayerRuntime, decision: AgentDecision, state: MatchState): PlanTarget => {
  // O alvo do goleiro é contínuo: a bola se move a cada tick, e o ajuste de pés tem que
  // acompanhar a rota sem esperar o próximo pensamento. O plano guarda a referência, não o ponto.
  if (GOALKEEPER_INTENTS.has(decision.intent)) return { kind: "goalkeeper" };
  if (decision.intent === "pressing") {
    return { kind: "ball", offset: subtract(decision.movementTarget, state.ball.position) };
  }
  if (decision.intent === "marking") {
    const opponent = nearestPlayer(decision.movementTarget, state.players.filter((candidate) => candidate.team !== player.team));
    if (opponent) return { kind: "player", playerId: opponent.profile.id, offset: subtract(decision.movementTarget, opponent.position) };
  }
  if (decision.intent === "supporting") {
    const actorId = activeBallPlayerId(state);
    const actor = state.players.find((candidate) => candidate.profile.id === actorId);
    if (actor && actor.profile.id !== player.profile.id) {
      return { kind: "player", playerId: actor.profile.id, offset: subtract(decision.movementTarget, actor.position) };
    }
  }
  return { kind: "point", position: { ...decision.movementTarget } };
};

export const thinkingInterval = (player: PlayerRuntime): number => {
  const read = (player.profile.mental.decisionMaking * 0.72 + player.profile.mental.anticipation * 0.28) / 100;
  // Fora de posição o jogador lê o jogo mais devagar: as referências que ele conhece não estão
  // onde ele está acostumado a procurar.
  const quality = clamp(read * (1 - outOfPositionCost(player) * 0.3), 0, 1);
  return COGNITION.slowestThinkSeconds + (COGNITION.fastestThinkSeconds - COGNITION.slowestThinkSeconds) * quality;
};

export const planAll = (state: MatchState): Map<string, PlayerPlan> => {
  const decisions = decideAll(state);
  return new Map(state.players.map((player) => {
    const decision = decisions.get(player.profile.id)!;
    const duration = COGNITION.planDuration[decision.intent] * (0.88 + player.profile.mental.composure / 520);
    const objective = decision.reason === "aggressiveBreak" ? "aggressiveBreak" : null;
    const preparedReceptionAction = prepareReceptionAction(state, player);
    return [player.profile.id, {
      target: planTarget(player, decision, state),
      burst: decision.burst,
      burstDuration: decision.burstDuration,
      posture: decision.posture,
      intent: decision.intent,
      reason: decision.reason,
      ballAction: decision.ballAction,
      objective,
      preparedReceptionAction,
      startedAt: state.elapsed,
      expiresAt: state.elapsed + duration,
      possessionTeam: state.possessionTeam,
      controllerId: state.ball.controllerId,
      ballActorId: activeBallPlayerId(state),
      collectivePlanStartedAt: state.tactics[player.team].collectivePlan?.startedAt ?? 0,
      duringRestart: state.restart !== null,
    } satisfies PlayerPlan];
  }));
};

export const resolvePlanDecision = (player: PlayerRuntime, state: MatchState): AgentDecision => {
  const plan = player.plan;
  if (!plan) {
    const isGoalkeeper = player.profile.position === "goalkeeper";
    return {
      movementTarget: isGoalkeeper ? goalkeeperMovementTarget(player, state) : player.homeAnchor,
      burst: false, posture: "outOfPossession",
      intent: isGoalkeeper ? "goalkeeping" : "covering",
      reason: isGoalkeeper ? "protectGoal" : "coverGoal", ballAction: { kind: "none" },
    };
  }
  let movementTarget: Vec2;
  // Quem vai à bola persegue o ponto de encontro ao vivo, e não o alvo congelado no plano: entre
  // dois pensamentos a bola anda, e é ela que manda no trajeto de quem corre atrás dela. O
  // goleiro vem antes de tudo: o alvo dele é do sistema dele, e ganhar uma corrida não o tira
  // da posição de guarda.
  const chasing = !state.ball.controllerId
    && state.ballSituation.phase !== "contested"
    && state.ballSituation.favourite?.playerId === player.profile.id;
  if (plan.target.kind === "goalkeeper") movementTarget = goalkeeperMovementTarget(player, state);
  else if (chasing) movementTarget = state.ballSituation.contactPoint;
  else if (plan.target.kind === "point") movementTarget = plan.target.position;
  else if (plan.target.kind === "ball") movementTarget = add(state.ball.position, plan.target.offset);
  else {
    const targetPlayerId = plan.target.playerId;
    const targetPlayer = state.players.find((candidate) => candidate.profile.id === targetPlayerId);
    movementTarget = targetPlayer ? add(targetPlayer.position, plan.target.offset) : player.homeAnchor;
  }
  const controlsBall = state.ball.controllerId === player.profile.id;
  const ballAction = controlsBall ? plan.ballAction : { kind: "none" } as const;
  // O desenho da bola parada é autoritativo e legitimamente sai das linhas: o cobrador do lateral
  // e o do escanteio ficam do lado de fora (a faixa `runOff`, que o movimento já permite). Prender
  // esse alvo à margem interna deixava o cobrador parado a alguns passos do ponto — ele nunca
  // "chegava", e a cobrança só saía pela trava de tempo.
  const duringDeadBall = state.restart !== null && !state.restart.ballInPlay;
  return {
    movementTarget: duringDeadBall ? movementTarget : clampToField(movementTarget, 3),
    burst: plan.burst,
    burstDuration: plan.burstDuration,
    posture: plan.posture,
    intent: plan.intent,
    reason: plan.reason,
    ballAction,
  };
};
