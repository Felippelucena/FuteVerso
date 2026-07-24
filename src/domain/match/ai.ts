import { COGNITION, CONDUCT, DEFENSE, DUEL, FIELD, PHYSICS, TACTICS } from "./config";
import { add, clamp, distance, dot, normalize, scale, subtract } from "../shared/math";
import type { AgentDecision, AssignmentDuty, BallAction, DecisionReason, DribbleStyle, MatchState, PlanTarget, PlayerAssignment, PlayerPlan, PlayerRuntime, Team, Vec2 } from "./model";
import { activeBallPlayerId } from "./runtime/control";
import {
  interceptionThreat,
  predictBallPosition,
  predictPlayerPosition,
  predictPlayerAlongPlan,
  predictedSpaceAt,
  predictionHorizon,
} from "./runtime/prediction";
import { estimatePassDuration } from "./runtime/pass-trajectory";
import { playerSkillSpeed } from "./runtime/player-metrics";
import { chooseDribbleTouch, evaluateForwardRunway } from "./runtime/dribble-runway";
import { classifyPassPurpose } from "./runtime/pass-purpose";
import { evaluateShotOpportunity } from "./runtime/shot-opportunity";
import { goalkeeperDecision } from "./systems/goalkeeper-system";
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

const fieldX = (original: number): number => original * FIELD.width / 100;
const fieldY = (original: number): number => original * FIELD.height / 60;

const PERCEPTION = {
  intervention: fieldX(12),
  support: fieldX(28),
  cooperation: fieldX(47),
} as const;

const blend = (a: Vec2, b: Vec2, amount: number): Vec2 => ({
  x: a.x * (1 - amount) + b.x * amount,
  y: a.y * (1 - amount) + b.y * amount,
});

const clampToField = (target: Vec2, margin = 4): Vec2 => ({
  x: clamp(target.x, margin, FIELD.width - margin),
  y: clamp(target.y, margin, FIELD.height - margin),
});

const edgeRisk = (position: Vec2): number => {
  const nearestTouchline = Math.min(position.y, FIELD.height - position.y);
  const nearestGoalLine = Math.min(position.x, FIELD.width - position.x);
  return clamp(1 - Math.min(nearestTouchline / fieldY(10), nearestGoalLine / fieldX(7)), 0, 1);
};

const centrality = (position: Vec2): number => 1 - clamp(Math.abs(position.y - FIELD.height / 2) / (FIELD.height / 2), 0, 1);

const channelAffinity = (position: Vec2, channel: "left" | "center" | "right"): number => {
  const targetY = channel === "left" ? FIELD.height * 0.22 : channel === "right" ? FIELD.height * 0.78 : FIELD.height * 0.5;
  return 1 - clamp(Math.abs(position.y - targetY) / (FIELD.height * 0.42), 0, 1);
};

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

const distanceToSegment = (point: Vec2, start: Vec2, end: Vec2): number => {
  const segment = subtract(end, start);
  const squared = dot(segment, segment);
  if (squared < 0.001) return distance(point, start);
  const amount = clamp(dot(subtract(point, start), segment) / squared, 0, 1);
  return distance(point, add(start, scale(segment, amount)));
};

const nearestPlayer = (origin: Vec2, players: PlayerRuntime[]): PlayerRuntime | null =>
  [...players].sort((a, b) => distance(origin, a.position) - distance(origin, b.position))[0] ?? null;

const perceptionDepth = (player: PlayerRuntime, ballPosition: Vec2): number =>
  clamp((distance(player.position, ballPosition) - PERCEPTION.intervention) / (PERCEPTION.cooperation - PERCEPTION.intervention), 0, 1);

const choosePresser = (team: Team, players: PlayerRuntime[], ballPosition: Vec2): PlayerRuntime => {
  const ownGoal = goalCenter(team, true);
  const score = (player: PlayerRuntime): number => {
    const goalkeeperPenalty = player.profile.position === "goalkeeper" && distance(ballPosition, ownGoal) > fieldX(13)
      ? fieldX(18)
      : 0;
    const mentalityBonus = (player.profile.mental.aggression + player.profile.mental.intensity) / 200 * fieldX(3.5)
      + player.memory.policy.press * fieldX(1.5);
    return distance(player.position, ballPosition) + goalkeeperPenalty - mentalityBonus;
  };
  return [...players].sort((a, b) => {
    return score(a) - score(b);
  })[0];
};

const goalkeeperTarget = (player: PlayerRuntime, state: MatchState): Vec2 => {
  const direction = attackDirection(player.team);
  const ownX = direction > 0 ? 0 : FIELD.width;
  const ballDepth = direction > 0 ? state.ball.position.x : FIELD.width - state.ball.position.x;
  const advance = clamp(fieldX(4) + ballDepth * 0.08, fieldX(4), FIELD.penaltyDepth - player.radius);
  return {
    x: ownX + direction * advance,
    y: clamp(FIELD.height / 2 + (state.ball.position.y - FIELD.height / 2) * 0.42, FIELD.goalTop + 2, FIELD.goalBottom - 2),
  };
};

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
      const score = clamp(progress / fieldX(24), -0.8, 1.45)
        + clamp(openness / fieldX(14), 0, 1.18) + centrality(target) * 0.18 + roleBonus
        + switchValue + wallPassBonus + backwardsSafety + collectiveBonus + aerialValue + purposeBonus
        + (longProgression ? passerTechnique * 0.36 : 0)
        + (player.profile.mental.teamwork - 50) / 100 * 0.22
        + (player.profile.mental.decisionMaking - 50) / 100 * 0.16
        + (player.profile.mental.creativity - 50) / 100 * (blocked ? 0.2 : 0.06)
        - passDistance / fieldX(72) - rangePenalty
        - effectivePressure * (passDistance > fieldX(18) ? 0.58 : 0.86) * (1.08 - player.profile.mental.creativity / 500);
      const receiverEta = distance(teammate.position, target) / Math.max(1, playerSkillSpeed(teammate) * PHYSICS.runSpeedFactor);
      const opponentEta = Math.min(...opponents.map((opponent) => distance(opponent.position, target)
        / Math.max(1, playerSkillSpeed(opponent) * PHYSICS.runSpeedFactor)));
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

const carrierDecision = (
  player: PlayerRuntime,
  teammates: PlayerRuntime[],
  opponents: PlayerRuntime[],
  state: MatchState,
): AgentDecision => {
  if (player.profile.position === "goalkeeper" && player.goalkeeperHoldUntil > state.elapsed) {
    // Bola nas mãos: segura a posse e espera o time se reposicionar antes de distribuir,
    // ignorando o marcador que pressiona (ele não pode desarmar as mãos do goleiro).
    return {
      movementTarget: { ...player.position }, burst: false, posture: "inPossession",
      intent: "holdingBall", reason: "holdInHands", ballAction: { kind: "none" },
    };
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
  const duelQuality = (player.profile.skills.control * 0.58 + player.profile.skills.burst * 0.42) / 100;
  const escapeConfidence = clamp((duelQuality - 0.52) / 0.35, 0, 1);
  const finalThirdUrgency = state.tactics[player.team].phase === "finalThird"
    ? clamp((state.elapsed - state.tactics[player.team].phaseStartedAt) / 6, 0, 1) * 0.22
    : 0;
  const shot = evaluateShotOpportunity(player, opponents, state);
  const clearChanceBonus = shot && !shot.blocked && shot.distance < fieldX(18) ? 1.45 : 0;
  const shotUtility = shot ? shot.utility + clearChanceBonus + finalThirdUrgency + aggression * 0.12
    + composure * pressure * 0.1 + decisionNoise(player, state, 11) : -1;
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
  const hasSettledPossession = controlAge > 0.72 || pressure > 0.68 || player.profile.position === "goalkeeper";
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
  const canFeint = controlAge >= PHYSICS.feintControlSettleTime
    && player.reactionTimer <= 0
    && player.duelCooldown <= 0
    && creativity > 0.48;
  const laneSpace = openDribbleLane(player, baseDribbleTarget, opponents);
  // Avançar em espaço é sempre knock-on (empurra a bola e corre atrás). A bola colada
  // (carry) fica reservada para quando não há pique possível: apertado, sem corredor,
  // ou vencendo um marcador que se comprometeu (feint).
  const style: DribbleStyle = defenderIsCommitting && duelQuality > 0.56 && canFeint
    ? "feint"
    : touchChoice.range
      ? "knockOn"
      : "carry";
  const touchDistance = style === "knockOn"
    ? touchChoice.touchDistance
    : style === "feint"
      ? clamp(laneSpace * 0.62, fieldX(10), fieldX(16))
      : clamp(laneSpace * 0.66, fieldX(9.6), fieldX(14.4));
  const dribbleTarget = style === "knockOn"
    ? touchChoice.target
    : clampToField(add(player.position, scale(normalize(subtract(baseDribbleTarget, player.position)), touchDistance)), 5);
  const intent: AgentDecision["intent"] = style === "knockOn"
    ? "knockingOn"
    : style === "feint"
      ? "feinting"
      : "carrying";
  return {
    movementTarget: dribbleTarget,
    burst: style === "knockOn" || style === "feint",
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
  const anchor = assignedAnchor(assignment, player);
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
    ? collective.attackChannel === "left" ? FIELD.height * 0.22 : collective.attackChannel === "right" ? FIELD.height * 0.78 : FIELD.height * 0.5
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
  // A célula já carrega o avanço do bloco por fase e o deslizamento pelo canal, então o
  // acompanhamento contínuo da bola pesa menos do que pesava sobre a âncora fixa. É um dos
  // números que a remedição do Passo 5 vai revisitar.
  // Quem segura a largura quase não desliza atrás do portador: a função dele é justamente não
  // fechar a faixa que o time precisa manter aberta.
  const base = {
    x: anchor.x + (state.ball.position.x - FIELD.width / 2) * 0.26,
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

const defensiveTarget = (
  player: PlayerRuntime,
  mark: PlayerRuntime | null,
  state: MatchState,
  assignment: PlayerAssignment | null,
): { target: Vec2; intent: AgentDecision["intent"]; burst: boolean; reason: DecisionReason; burstDuration?: number } => {
  const anchor = assignedAnchor(assignment, player);
  const direction = attackDirection(player.team);
  const thinkingTime = perceptionDepth(player, state.ball.position);
  const ownGoal = goalCenter(player.team, true);
  const phase = state.tactics[player.team].phase;
  const collective = state.tactics[player.team].collectivePlan;
  const marksMan = assignment?.duty === "trackRunner";
  const markWeight = player.memory.policy.mark * (marksMan ? 0.68 : 0.46);
  const coverWeight = player.memory.policy.cover * (marksMan ? 0.24 : 0.38);
  const minimumGap = fieldX(collective?.defensiveBlock === "low" || phase === "lowBlock"
    ? 9
    : collective?.defensiveBlock === "high" || phase === "counterPress" || phase === "highPress"
      ? 16
      : 12);
  const predictedBall = predictBallPosition(state, predictionHorizon(player, 0.7) * 0.5);
  // A escada de cobertura por índice global morreu aqui. A distância à bola sai da profundidade
  // da própria célula: quem foi encarregado de uma zona funda cobre de longe, quem tem célula
  // adiantada cobre de perto. Escala para qualquer número de jogadores sem esticar o bloco.
  const coverDistance = clamp(
    distance(predictedBall, ownGoal) - distance(anchor, ownGoal),
    minimumGap,
    FIELD.width * 0.46,
  );
  const coverPoint = add(predictedBall, scale(normalize(subtract(ownGoal, predictedBall)), coverDistance));
  const predictedMark = mark ? predictPlayerPosition(mark, predictionHorizon(player, 0.55) * 0.48) : null;
  const markSide = predictedMark ? {
    x: predictedMark.x - direction * fieldX(marksMan ? 5 : 3),
    y: predictedMark.y + Math.sign(anchor.y - predictedMark.y || 1) * fieldY(3),
  } : anchor;
  // Marcação individual persegue o homem; a zonal só encosta em quem entrou na célula dela.
  const markBias = marksMan ? 0.75 : 0.3;
  const medium = blend(coverPoint, markSide, markBias + markWeight * 0.18 - coverWeight * 0.1);
  const farPlan = blend(anchor, markSide, markWeight * (0.42 + thinkingTime * 0.3));
  const contextualTarget = blend(medium, farPlan, thinkingTime);
  const laneDiscipline = phase === "lowBlock" ? 0.36 : 0.28;
  const target = clampToField(blend(contextualTarget, { x: contextualTarget.x, y: anchor.y }, laneDiscipline), 3);
  const intent = mark ? "marking" : "covering";
  const reason: DecisionReason = mark ? "markThreat" : "holdZone";
  // Item 4B: zagueiro adiantado que acabou de perder a posse recompõe em disparada garantida
  // (sem o gate de intensidade/fase do burst defensivo normal).
  const justLost = state.previousControlledTeam === player.team
    && state.lastControlledTeam !== player.team
    && state.elapsed - state.controlChangedAt < DEFENSE.recoverWindow;
  const advanced = direction * (player.position.x - anchor.x) > DEFENSE.recoverAdvancedGap * FIELD.width;
  if (player.profile.role === "defender" && justLost && advanced) {
    const recoverPoint = clampToField(blend(anchor, ownGoal, 0.25), 3);
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

const receptionTarget = (state: MatchState): Vec2 => {
  const pending = state.pendingPass;
  if (!pending) return state.ball.position;
  const remaining = pending.expectedArrivalAt - state.elapsed;
  const liveProjection = predictBallPosition(state, clamp(remaining, 0.12, 2.2));
  const trajectoryChanged = distance(liveProjection, pending.landingPoint) > fieldX(6);
  return clampToField(trajectoryChanged || remaining <= 0 ? liveProjection : pending.landingPoint, 3);
};

const receptionDecision = (player: PlayerRuntime, opponents: PlayerRuntime[], state: MatchState): AgentDecision => {
  const target = receptionTarget(state);
  const remaining = Math.max(0.12, (state.pendingPass?.expectedArrivalAt ?? state.elapsed + 0.4) - state.elapsed);
  const runSpeed = playerSkillSpeed(player) * PHYSICS.runSpeedFactor;
  const receiverEta = distance(player.position, target) / Math.max(1, runSpeed);
  const opponentEta = Math.min(...opponents.map((opponent) => distance(opponent.position, target)
    / Math.max(1, playerSkillSpeed(opponent) * PHYSICS.runSpeedFactor)));
  const requiredSpeed = distance(player.position, target) / remaining;
  const urgentRace = opponentEta <= receiverEta + 0.35;
  const burst = player.sprintEnergy > 0.48 && player.sprintCooldown <= 0
    && (requiredSpeed > runSpeed * 0.88 || urgentRace);
  return {
    movementTarget: target,
    burst,
    burstDuration: burst ? clamp(Math.max(receiverEta, remaining), PHYSICS.burstDuration, 1.45) : undefined,
    posture: "inPossession",
    intent: "receiving",
    reason: "attackReception",
    ballAction: { kind: "none" },
  };
};

export const decideAll = (state: MatchState): Map<string, AgentDecision> => {
  const decisions = new Map<string, AgentDecision>();
  const actualController = state.players.find((player) => player.profile.id === state.ball.controllerId) ?? null;
  const dribbleOwner = !actualController
    ? state.players.find((player) => player.profile.id === state.ball.dribbleOwnerId) ?? null
    : null;
  const passReceiver = !actualController && !dribbleOwner && state.pendingPass
    ? state.players.find((player) => player.profile.id === state.pendingPass?.receiverId) ?? null
    : null;
  const controller = actualController ?? dribbleOwner ?? passReceiver;
  for (const team of ["blue", "coral"] as const) {
    const teammates = state.players.filter((player) => player.team === team);
    const opponents = state.players.filter((player) => player.team !== team);
    const teamHasPossession = controller?.team === team;
    const plan = state.tactics[team].collectivePlan;
    // Quem pressiona vem do dever `press`: prioridade 0 é quem chega primeiro na bola,
    // prioridade 1 é o segundo que sai da linha para dividir.
    const pressers = dutyHolders(plan, "press");
    const presser = teammates.find((player) => player.profile.id === pressers[0])
      ?? choosePresser(team, teammates, state.ball.position);
    const secondPresser = pressers[1] && pressers[1] !== presser.profile.id
      ? teammates.find((player) => player.profile.id === pressers[1]) ?? null
      : null;
    const ownGoal = goalCenter(team, true);
    for (const player of teammates) {
      const keeperReaction = player.profile.position === "goalkeeper" && actualController?.profile.id !== player.profile.id
        ? goalkeeperDecision(player, state)
        : null;
      if (keeperReaction) {
        decisions.set(player.profile.id, keeperReaction);
        continue;
      }
      if (controller?.profile.id === player.profile.id) {
        if (actualController) {
          decisions.set(player.profile.id, carrierDecision(player, teammates, opponents, state));
        } else if (dribbleOwner) {
          const style = state.ball.dribbleStyle ?? "carry";
          const lookAhead = style === "knockOn"
            ? state.ball.dribbleTouchRange === "short" ? 0.34 : state.ball.dribbleTouchRange === "medium" ? 0.52 : 0.72
            : style === "feint" ? 0.58 : 0.36;
          const chaseTarget = clampToField(predictBallPosition(state, lookAhead), 3);
          const intent: AgentDecision["intent"] = style === "knockOn"
            ? "knockingOn"
            : style === "feint"
              ? "feinting"
              : "carrying";
          decisions.set(player.profile.id, {
            movementTarget: chaseTarget,
            burst: style === "knockOn" || style === "feint",
            posture: "inPossession",
            intent,
            reason: "carryIntoSpace",
            ballAction: { kind: "none" },
          });
        } else {
          decisions.set(player.profile.id, receptionDecision(player, opponents, state));
        }
        continue;
      }
      if (teamHasPossession && controller) {
        const support = player.profile.position === "goalkeeper"
          ? { target: goalkeeperTarget(player, state), reason: "protectGoal" as const, burst: false }
          : supportTarget(player, controller, state);
        decisions.set(player.profile.id, {
          movementTarget: support.target,
          burst: support.burst,
          posture: "inPossession",
          intent: player.profile.position === "goalkeeper" ? "goalkeeping" : "supporting",
          reason: support.reason,
          ballAction: { kind: "none" },
        });
        continue;
      }
      if (player.profile.position === "goalkeeper") {
        const target = presser.profile.id === player.profile.id ? state.ball.position : goalkeeperTarget(player, state);
        decisions.set(player.profile.id, { movementTarget: target, burst: false, posture: "outOfPossession", intent: "goalkeeping", reason: "protectGoal", ballAction: { kind: "none" } });
        continue;
      }
      if (presser.profile.id === player.profile.id) {
        const predictedPressSpeed = (8.5 + player.profile.skills.sprintSpeed * 0.06) * PHYSICS.runSpeedFactor;
        const pressHorizon = clamp(distance(player.position, state.ball.position) / Math.max(12, predictedPressSpeed), 0.18, 1.2);
        const prediction = predictBallPosition(state, pressHorizon);
        const aggressivePress = state.tactics[team].phase === "counterPress" || state.tactics[team].phase === "highPress";
        const goalSide = add(prediction, scale(normalize(subtract(ownGoal, prediction)), player.radius * (aggressivePress ? 0.95 : 1.75)));
        if (state.tactics[team].collectivePlan?.pressTrigger === "touchline") {
          goalSide.y += (prediction.y < FIELD.height / 2 ? 1 : -1) * player.radius * 0.9;
        }
        const rivalBallDistance = Math.min(...opponents.map((opponent) => distance(opponent.position, state.ball.position)));
        const looseBallRace = !actualController
          && distance(player.position, state.ball.position) < fieldX(28)
          && rivalBallDistance < fieldX(28);
        const raceDistance = distance(player.position, prediction);
        const raceSpeed = (8.5 + player.profile.skills.sprintSpeed * 0.06) * PHYSICS.burstSpeedFactor;
        const burstDuration = looseBallRace ? clamp(raceDistance / Math.max(1, raceSpeed * 0.78), PHYSICS.burstDuration, 1.45) : undefined;
        decisions.set(player.profile.id, { movementTarget: clampToField(goalSide, 3), burst: looseBallRace, burstDuration, posture: "outOfPossession", intent: "pressing", reason: "pressBall", ballAction: { kind: "none" } });
        continue;
      }
      if (secondPresser && secondPresser.profile.id === player.profile.id) {
        // Item 1: segundo engajador sai da linha e divide em disparada, goal-side e agressivo.
        const raceBase = 8.5 + player.profile.skills.sprintSpeed * 0.06;
        const pressHorizon = clamp(distance(player.position, state.ball.position) / Math.max(12, raceBase * PHYSICS.runSpeedFactor), 0.18, 1);
        const prediction = predictBallPosition(state, pressHorizon);
        const goalSide = add(prediction, scale(normalize(subtract(ownGoal, prediction)), player.radius * 0.95));
        const burstDuration = clamp(distance(player.position, prediction) / Math.max(1, raceBase * PHYSICS.burstSpeedFactor * 0.78), PHYSICS.burstDuration, 1.45);
        decisions.set(player.profile.id, { movementTarget: clampToField(goalSide, 3), burst: true, burstDuration, posture: "outOfPossession", intent: "pressing", reason: "pressBall", ballAction: { kind: "none" } });
        continue;
      }
      // Sem ranking global de ameaça e sem marcação por índice: o jogador responde por quem o
      // plano coletivo colocou dentro da célula dele. Ninguém atravessa o campo atrás de um número.
      const assignment = assignmentOf(plan, player.profile.id);
      const assignedMark = assignment?.targetPlayerId
        ? opponents.find((opponent) => opponent.profile.id === assignment.targetPlayerId) ?? null
        : null;
      const { target, intent, burst, reason, burstDuration } = defensiveTarget(player, assignedMark, state, assignment);
      decisions.set(player.profile.id, { movementTarget: target, burst, burstDuration, posture: "outOfPossession", intent, reason, ballAction: { kind: "none" } });
    }
  }
  return decisions;
};

const planTarget = (player: PlayerRuntime, decision: AgentDecision, state: MatchState): PlanTarget => {
  if (state.ball.dribbleOwnerId === player.profile.id || state.pendingPass?.receiverId === player.profile.id) {
    return { kind: "ball", offset: subtract(decision.movementTarget, state.ball.position) };
  }
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
  if (decision.intent === "goalkeeping") return { kind: "goalkeeper" };
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
      duringRestart: state.kickoffTimer > 0,
    } satisfies PlayerPlan];
  }));
};

export const resolvePlanDecision = (player: PlayerRuntime, state: MatchState): AgentDecision => {
  const plan = player.plan;
  if (!plan) {
    return {
      movementTarget: player.homeAnchor, burst: false, posture: "outOfPossession",
      intent: player.profile.position === "goalkeeper" ? "goalkeeping" : "covering",
      reason: player.profile.position === "goalkeeper" ? "protectGoal" : "coverGoal", ballAction: { kind: "none" },
    };
  }
  let movementTarget: Vec2;
  if (state.ball.dribbleOwnerId === player.profile.id) {
    const style = state.ball.dribbleStyle ?? "carry";
    const lookAhead = style === "knockOn"
      ? state.ball.dribbleTouchRange === "short" ? 0.34 : state.ball.dribbleTouchRange === "medium" ? 0.52 : 0.72
      : style === "feint" ? 0.58 : 0.36;
    movementTarget = predictBallPosition(state, lookAhead);
  } else if (state.pendingPass?.receiverId === player.profile.id && !state.ball.controllerId) {
    movementTarget = receptionTarget(state);
  } else if (plan.target.kind === "point") movementTarget = plan.target.position;
  else if (plan.target.kind === "ball") movementTarget = add(state.ball.position, plan.target.offset);
  else if (plan.target.kind === "goalkeeper") movementTarget = goalkeeperTarget(player, state);
  else {
    const targetPlayerId = plan.target.playerId;
    const targetPlayer = state.players.find((candidate) => candidate.profile.id === targetPlayerId);
    movementTarget = targetPlayer ? add(targetPlayer.position, plan.target.offset) : player.homeAnchor;
  }
  const controlsBall = state.ball.controllerId === player.profile.id;
  const ballAction = controlsBall ? plan.ballAction : { kind: "none" } as const;
  return {
    movementTarget: clampToField(movementTarget, 3),
    burst: plan.burst,
    burstDuration: plan.burstDuration,
    posture: plan.posture,
    intent: plan.intent,
    reason: plan.reason,
    ballAction,
  };
};
