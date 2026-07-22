import { FIELD, PHYSICS } from "./config";
import { add, clamp, distance, dot, normalize, scale, subtract } from "./math";
import type { AgentDecision, BallAction, DecisionReason, GameState, PlayerRuntime, Team, Vec2 } from "./model";

export const PASS_VARIANTS = (["ground", "air"] as const).flatMap((trajectory) =>
  (["short", "long"] as const).flatMap((range) =>
    (["feet", "space"] as const).map((targeting) => ({ trajectory, range, targeting })),
  ),
);

export const attackDirection = (team: Team): number => (team === "blue" ? 1 : -1);

const fieldX = (original: number): number => original * FIELD.width / 100;
const fieldY = (original: number): number => original * FIELD.height / 60;
const laneY = (player: PlayerRuntime): number => [fieldY(15), fieldY(30), fieldY(45)][Math.max(0, player.lineupIndex - 1)] ?? FIELD.height / 2;

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

export const formationAnchor = (player: PlayerRuntime): Vec2 => {
  const direction = attackDirection(player.team);
  const mirroredX = (blueX: number): number => direction > 0 ? blueX : FIELD.width - blueX;
  const roleAdvance = fieldX(player.profile.role === "finisher" ? 4 : player.profile.role === "defender" ? -3 : 0);
  switch (player.profile.position) {
    case "goalkeeper": return { x: mirroredX(fieldX(6)), y: FIELD.height / 2 };
    case "centerBack": return { x: mirroredX(fieldX(22) + roleAdvance), y: laneY(player) };
    case "fullBack": return { x: mirroredX(fieldX(29) + roleAdvance), y: player.lineupIndex % 2 === 0 ? fieldY(47) : fieldY(13) };
    case "midfielder": return { x: mirroredX(fieldX(38) + roleAdvance), y: laneY(player) };
    case "forward": return { x: mirroredX(fieldX(47) + roleAdvance), y: laneY(player) };
  }
};

const goalCenter = (team: Team, ownGoal: boolean): Vec2 => {
  const direction = attackDirection(team);
  const attackingX = direction > 0 ? FIELD.width : 0;
  return { x: ownGoal ? FIELD.width - attackingX : attackingX, y: FIELD.height / 2 };
};

const distanceToSegment = (point: Vec2, start: Vec2, end: Vec2): number => {
  const segment = subtract(end, start);
  const squared = dot(segment, segment);
  if (squared < 0.001) return distance(point, start);
  const amount = clamp(dot(subtract(point, start), segment) / squared, 0, 1);
  return distance(point, add(start, scale(segment, amount)));
};

const nearestOpponentDistance = (player: PlayerRuntime, opponents: PlayerRuntime[]): number =>
  Math.min(...opponents.map((opponent) => distance(player.position, opponent.position)));

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
    return distance(player.position, ballPosition) + goalkeeperPenalty;
  };
  return [...players].sort((a, b) => {
    return score(a) - score(b);
  })[0];
};

const goalkeeperTarget = (player: PlayerRuntime, state: GameState): Vec2 => {
  const direction = attackDirection(player.team);
  const ownX = direction > 0 ? 0 : FIELD.width;
  const ballDepth = direction > 0 ? state.ball.position.x : FIELD.width - state.ball.position.x;
  const advance = clamp(fieldX(4) + ballDepth * 0.08, fieldX(4), fieldX(13));
  return {
    x: ownX + direction * advance,
    y: clamp(FIELD.height / 2 + (state.ball.position.y - FIELD.height / 2) * 0.42, FIELD.goalTop + 2, FIELD.goalBottom - 2),
  };
};

interface PassOption {
  action: Extract<BallAction, { kind: "pass" }>;
  score: number;
  reason: DecisionReason;
}

const choosePass = (player: PlayerRuntime, teammates: PlayerRuntime[], opponents: PlayerRuntime[], state: GameState): PassOption | null => {
  const direction = attackDirection(player.team);
  const carrierEdgeRisk = edgeRisk(player.position);
  const candidates = teammates
    .filter((teammate) => teammate.profile.id !== player.profile.id)
    .map((teammate) => {
      const passDistance = distance(player.position, teammate.position);
      const progress = direction * (teammate.position.x - player.position.x);
      const openness = nearestOpponentDistance(teammate, opponents);
      const lanePressure = opponents.reduce((risk, opponent) => {
        const laneDistance = distanceToSegment(opponent.position, player.position, teammate.position);
        return risk + clamp(1 - laneDistance / fieldY(4), 0, 1);
      }, 0);
      const blocked = lanePressure > 0.72;
      const phase = state.tactics[player.team].phase;
      const passerTechnique = (player.profile.skills.passing + player.profile.skills.vision) / 200;
      const longProgression = progress > fieldX(18) && (phase === "buildUp" || phase === "progression" || phase === "counterAttack");
      const crossesPitch = (player.position.y - FIELD.height / 2) * (teammate.position.y - FIELD.height / 2) < 0;
      const switchValue = carrierEdgeRisk * centrality(teammate.position) * (crossesPitch ? 1.2 : 0.42);
      const wallPass = state.lastAssist?.playerId === teammate.profile.id && state.elapsed - state.lastAssist.time < 4.2;
      const wallPassBonus = wallPass ? 0.64 : 0;
      const roleBonus = teammate.profile.role === "finisher" ? Math.max(0, progress) / fieldX(35) : 0;
      const backwardsSafety = progress < 0 && openness > fieldX(7) ? 0.22 : 0;
      const score = clamp(progress / fieldX(24), -0.8, 1.45)
        + clamp(openness / fieldX(14), 0, 1.18)
        + centrality(teammate.position) * 0.18
        + roleBonus
        + switchValue
        + wallPassBonus
        + backwardsSafety
        + (longProgression ? passerTechnique * 0.36 : 0)
        - passDistance / fieldX(72)
        - lanePressure * (passDistance > fieldX(18) ? 0.58 : 0.86);
      const reason: DecisionReason = wallPass ? "wallPass" : switchValue > 0.52 ? "switchPlay" : "progressivePass";
      return { teammate, passDistance, blocked, lanePressure, progress, longProgression, score, reason };
    })
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  const targeting = best.teammate.velocity.x * direction > 2 || best.teammate.profile.role === "finisher" ? "space" : "feet";
  const range = best.passDistance > fieldX(18) || (best.longProgression && best.passDistance > fieldX(14)) ? "long" : "short";
  const trajectory = best.blocked && best.passDistance > fieldX(9) && (range === "long" || best.lanePressure > 1.08) ? "air" : "ground";
  const leadMultiplier = range === "long" ? 1.18 : 0.82;
  const lead = targeting === "space" ? scale(best.teammate.velocity, clamp(best.passDistance / 24, 0.25, leadMultiplier)) : { x: 0, y: 0 };
  return {
    score: best.score,
    reason: best.reason,
    action: {
      kind: "pass",
      receiverId: best.teammate.profile.id,
      target: clampToField(add(best.teammate.position, lead), 4),
      trajectory,
      range,
      targeting,
      power: clamp(0.42 + best.passDistance / fieldX(82) + (targeting === "space" ? 0.08 : 0) + (best.blocked ? 0.06 : 0), 0.48, 1),
    },
  };
};

const chooseDribbleTarget = (player: PlayerRuntime, opponents: PlayerRuntime[]): Vec2 => {
  const direction = attackDirection(player.team);
  const stride = fieldX(7);
  const lateral = fieldY(8);
  const candidates = [-1, -0.45, 0, 0.45, 1].map((offset) => clampToField({
    x: player.position.x + direction * stride * (1 - Math.abs(offset) * 0.16),
    y: player.position.y + offset * lateral,
  }, 5));
  return candidates.sort((a, b) => {
    const utility = (target: Vec2): number => {
      const space = Math.min(...opponents.map((opponent) => distance(target, opponent.position)));
      const progress = direction * (target.x - player.position.x);
      return space / fieldX(10) + progress / fieldX(16) + centrality(target) * edgeRisk(player.position) * 1.2 - edgeRisk(target) * 1.35;
    };
    return utility(b) - utility(a);
  })[0];
};

const carrierDecision = (
  player: PlayerRuntime,
  teammates: PlayerRuntime[],
  opponents: PlayerRuntime[],
  state: GameState,
): AgentDecision => {
  const targetGoal = goalCenter(player.team, false);
  const goalDistance = distance(player.position, targetGoal);
  const duelOpponent = nearestPlayer(player.position, opponents);
  const closestOpponent = duelOpponent ? distance(player.position, duelOpponent.position) : FIELD.width;
  const opponentToCarrier = duelOpponent ? normalize(subtract(player.position, duelOpponent.position)) : { x: 0, y: 0 };
  const closingSpeed = duelOpponent ? dot(subtract(duelOpponent.velocity, player.velocity), opponentToCarrier) : 0;
  const shotLaneBlocked = opponents.some((opponent) => distanceToSegment(opponent.position, player.position, targetGoal) < 3.2);
  const pass = choosePass(player, teammates, opponents, state);
  const policy = player.memory.policy;
  const pressure = clamp(1 - closestOpponent / fieldX(7), 0, 1);
  const duelQuality = (player.profile.skills.control * 0.58 + player.profile.skills.burst * 0.42) / 100;
  const escapeConfidence = clamp((duelQuality - 0.52) / 0.35, 0, 1);
  const shootingRange = fieldX(21 + policy.shoot * 8);
  const finalThirdUrgency = state.tactics[player.team].phase === "finalThird"
    ? clamp(state.stats[player.team].finalThirdEntries / Math.max(1, state.stats[player.team].shots + 1), 0, 4) * 0.2
    : 0;
  const shotUtility = goalDistance < shootingRange
    ? 0.85 + (1 - goalDistance / shootingRange) * 1.25 + policy.shoot * 0.4 + finalThirdUrgency - (shotLaneBlocked ? 0.64 : 0)
    : -1;
  const passUtility = pass ? pass.score + policy.pass * 0.52 + pressure * 0.74 + edgeRisk(player.position) * 0.62 : -1;
  const controlAge = Math.max(0, state.elapsed - state.ball.controlStartedAt);
  const dribbleTarget = chooseDribbleTarget(player, opponents);
  const dribbleSpace = Math.min(...opponents.map((opponent) => distance(dribbleTarget, opponent.position)));
  const dribbleUtility = policy.dribble * 0.62
    + clamp(dribbleSpace / fieldX(15), 0, 1.4)
    - pressure * (0.72 - escapeConfidence * 0.82)
    - edgeRisk(dribbleTarget) * 0.55;
  if (shotUtility >= passUtility && shotUtility >= dribbleUtility) {
    const aimY = player.position.y < FIELD.height / 2 ? FIELD.goalBottom - 2.5 : FIELD.goalTop + 2.5;
    return {
      movementTarget: player.position,
      burst: false,
      posture: "inPossession",
      intent: "shooting",
      reason: "shootingWindow",
      ballAction: { kind: "shot", target: { x: targetGoal.x, y: aimY }, power: clamp(0.56 + goalDistance / fieldX(70), 0.62, 1) },
    };
  }
  const passAdvantageRequired = pressure > 0.25 ? 0.08 + escapeConfidence * 0.32 : 0.38;
  const hasSettledPossession = controlAge > 0.72 || pressure > 0.68 || player.profile.position === "goalkeeper";
  if (pass && hasSettledPossession && passUtility >= dribbleUtility + passAdvantageRequired) {
    return { movementTarget: player.position, burst: false, posture: "inPossession", intent: "passing", reason: pass.reason, ballAction: pass.action };
  }
  const reason: DecisionReason = pressure > 0.58 || edgeRisk(player.position) > 0.38 ? "escapePressure" : "carryIntoSpace";
  const phase = state.tactics[player.team].phase;
  const defenderCanDuel = Boolean(duelOpponent && duelOpponent.reactionTimer <= 0 && duelOpponent.duelCooldown <= 0);
  const defenderIsCommitting = defenderCanDuel
    && closestOpponent < fieldX(7.2)
    && (closingSpeed > 0.65 || closestOpponent < fieldX(4.6));
  const canFeint = controlAge >= PHYSICS.feintControlSettleTime
    && player.reactionTimer <= 0
    && player.duelCooldown <= 0;
  const style = defenderIsCommitting && duelQuality > 0.56 && canFeint
    ? "feint"
    : closestOpponent > fieldX(6.5) && player.energy > 0.46 && (phase === "counterAttack" || phase === "progression" || phase === "finalThird")
      ? "sprint"
      : "carry";
  return {
    movementTarget: dribbleTarget,
    burst: style === "sprint" || style === "feint",
    posture: "inPossession",
    intent: style === "sprint" ? "sprinting" : style === "feint" ? "feinting" : "carrying",
    reason,
    ballAction: { kind: "dribble", target: dribbleTarget, style },
  };
};

const supportTarget = (player: PlayerRuntime, controller: PlayerRuntime, state: GameState): { target: Vec2; reason: DecisionReason } => {
  const direction = attackDirection(player.team);
  const anchor = formationAnchor(player);
  const supportDepth = perceptionDepth(player, state.ball.position);
  const phase = state.tactics[player.team].phase;
  const phaseIsFast = phase === "counterAttack";
  const phaseIsFinal = phase === "finalThird";
  const side = player.profile.role === "playmaker"
    ? (controller.position.y < FIELD.height / 2 ? 1 : -1)
    : (player.lineupIndex % 2 === 0 ? 1 : -1);
  const controllerNearEdge = edgeRisk(controller.position);
  const roleDepth = player.profile.role === "finisher"
    ? fieldX(phaseIsFast ? 27 : phaseIsFinal ? 23 : 19)
    : player.profile.role === "defender"
      ? -fieldX(phaseIsFinal ? 21 : 15)
      : fieldX(phaseIsFast ? 12 : phaseIsFinal ? 9 : 7);
  const roleWidth = player.profile.role === "defender" ? fieldY(10) : player.profile.role === "finisher" ? fieldY(16) : fieldY(21);
  const reason: DecisionReason = player.profile.role === "defender"
    ? "restDefense"
    : player.profile.role === "finisher" && phase !== "buildUp"
      ? "runInBehind"
      : player.profile.role === "playmaker"
        ? "thirdManSupport"
        : "giveWidth";
  const passingPocket = {
    x: controller.position.x + direction * roleDepth,
    y: controller.position.y + side * roleWidth,
  };
  const base = {
    x: anchor.x + (state.ball.position.x - FIELD.width / 2) * (player.profile.role === "defender" ? 0.2 : 0.42),
    y: anchor.y + (controller.position.y - FIELD.height / 2) * (player.profile.role === "defender" ? 0.12 : 0.28),
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
  return { target: clampToField(add(add(candidate, separation), escapeOpponent), 5), reason };
};

const defensiveTarget = (
  player: PlayerRuntime,
  mark: PlayerRuntime | null,
  state: GameState,
  coverSlot: number,
): { target: Vec2; intent: AgentDecision["intent"]; burst: boolean; reason: DecisionReason } => {
  const anchor = formationAnchor(player);
  const direction = attackDirection(player.team);
  const thinkingTime = perceptionDepth(player, state.ball.position);
  const ownGoal = goalCenter(player.team, true);
  const phase = state.tactics[player.team].phase;
  const markWeight = player.memory.policy.mark * (player.profile.role === "defender" ? 0.68 : 0.46);
  const coverWeight = player.memory.policy.cover * (player.profile.role === "defender" ? 0.38 : 0.24);
  const phaseDistance = phase === "lowBlock" ? 10 : phase === "counterPress" || phase === "highPress" ? 15 : 12;
  const coverDistance = fieldX(phaseDistance + coverSlot * 4.5);
  const coverPoint = add(state.ball.position, scale(normalize(subtract(ownGoal, state.ball.position)), coverDistance));
  const markSide = mark ? {
    x: mark.position.x - direction * fieldX(player.profile.role === "defender" ? 5 : 3),
    y: mark.position.y + Math.sign(anchor.y - mark.position.y || (coverSlot % 2 ? 1 : -1)) * fieldY(3),
  } : anchor;
  const roleCoverBias = player.profile.role === "defender" ? 0.3 : player.profile.role === "playmaker" ? 0.46 : 0.62;
  const medium = blend(coverPoint, markSide, roleCoverBias + markWeight * 0.18 - coverWeight * 0.1);
  const farPlan = blend(anchor, markSide, markWeight * (0.42 + thinkingTime * 0.3));
  const contextualTarget = blend(medium, farPlan, thinkingTime);
  const laneDiscipline = phase === "lowBlock" ? 0.36 : 0.28;
  const target = clampToField(blend(contextualTarget, { x: contextualTarget.x, y: anchor.y }, laneDiscipline), 3);
  const intent = roleCoverBias > 0.52 ? "marking" : "covering";
  const reason: DecisionReason = intent === "marking" ? "markThreat" : "coverGoal";
  return { target, intent, reason, burst: false };
};

export const decideAll = (state: GameState): Map<string, AgentDecision> => {
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
    const presser = choosePresser(team, teammates, state.ball.position);
    const ownGoal = goalCenter(team, true);
    const threats = [...opponents].sort((a, b) => {
      const threat = (opponent: PlayerRuntime): number => distance(opponent.position, ownGoal) * 0.54
        + distance(opponent.position, state.ball.position) * 0.34
        + Math.abs(opponent.position.y - FIELD.height / 2) * 0.12;
      return threat(a) - threat(b);
    });
    const coveringPlayers = teammates.filter((player) => player.profile.position !== "goalkeeper" && player.profile.id !== presser.profile.id);
    for (const player of teammates) {
      if (controller?.profile.id === player.profile.id) {
        if (actualController) {
          decisions.set(player.profile.id, carrierDecision(player, teammates, opponents, state));
        } else if (dribbleOwner) {
          const chaseTarget = clampToField(add(state.ball.position, scale(state.ball.velocity, 0.16)), 3);
          const style = state.ball.dribbleStyle ?? "carry";
          decisions.set(player.profile.id, {
            movementTarget: chaseTarget,
            burst: style === "sprint" || style === "feint",
            posture: "inPossession",
            intent: style === "sprint" ? "sprinting" : style === "feint" ? "feinting" : "carrying",
            reason: "carryIntoSpace",
            ballAction: { kind: "none" },
          });
        } else {
          const receiveTarget = clampToField(add(state.ball.position, scale(state.ball.velocity, 0.22)), 3);
          decisions.set(player.profile.id, {
            movementTarget: receiveTarget,
            burst: false,
            posture: "inPossession",
            intent: "supporting",
            reason: "thirdManSupport",
            ballAction: { kind: "none" },
          });
        }
        continue;
      }
      if (teamHasPossession && controller) {
        const support = player.profile.position === "goalkeeper"
          ? { target: goalkeeperTarget(player, state), reason: "protectGoal" as const }
          : supportTarget(player, controller, state);
        decisions.set(player.profile.id, {
          movementTarget: support.target,
          burst: false,
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
        const prediction = add(state.ball.position, scale(state.ball.velocity, clamp(distance(player.position, state.ball.position) / 35, 0.08, 0.45)));
        const aggressivePress = state.tactics[team].phase === "counterPress" || state.tactics[team].phase === "highPress";
        const goalSide = add(prediction, scale(normalize(subtract(ownGoal, prediction)), player.radius * (aggressivePress ? 0.95 : 1.75)));
        const rivalBallDistance = Math.min(...opponents.map((opponent) => distance(opponent.position, state.ball.position)));
        const looseBallRace = !actualController
          && distance(player.position, state.ball.position) < fieldX(28)
          && rivalBallDistance < fieldX(28);
        decisions.set(player.profile.id, { movementTarget: clampToField(goalSide, 3), burst: looseBallRace, posture: "outOfPossession", intent: "pressing", reason: "pressBall", ballAction: { kind: "none" } });
        continue;
      }
      const coverSlot = Math.max(0, coveringPlayers.findIndex((candidate) => candidate.profile.id === player.profile.id));
      const assignedMark = threats[coverSlot % Math.max(1, threats.length)] ?? null;
      const { target, intent, burst, reason } = defensiveTarget(player, assignedMark, state, coverSlot);
      decisions.set(player.profile.id, { movementTarget: target, burst, posture: "outOfPossession", intent, reason, ballAction: { kind: "none" } });
    }
  }
  return decisions;
};
