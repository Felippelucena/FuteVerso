import { FIELD, MATCH_DURATION, POSSESSION, TACTICS } from "../config";
import { clamp, distance } from "../../shared/math";
import type {
  AttackChannel,
  BuildUpStyle,
  DefensiveBlock,
  MatchState,
  PlayerRuntime,
  PressTrigger,
  TacticalPhase,
  Team,
  TeamCollectivePlan,
  TeamShape,
  TeamTacticalState,
} from "../model";
import { activeBallPlayerId } from "../runtime/control";
import { predictPlayerPosition, predictedSpaceAt, predictionHorizon } from "../runtime/prediction";

export const TACTICAL_PHASES: TacticalPhase[] = [
  "buildUp", "progression", "finalThird", "counterAttack",
  "highPress", "midBlock", "lowBlock", "counterPress", "recovery",
];

export const createPhaseSeconds = (): Record<TacticalPhase, number> => Object.fromEntries(
  TACTICAL_PHASES.map((phase) => [phase, 0]),
) as Record<TacticalPhase, number>;

export const createTacticalState = (team: Team): TeamTacticalState => ({
  phase: team === "blue" ? "midBlock" : "midBlock",
  phaseStartedAt: 0,
  candidatePhase: "midBlock",
  candidatePhaseStartedAt: 0,
  shape: { width: 0, depth: 0, compactness: 0, lineHeight: 0 },
  finalThirdLatched: false,
  lastFinalThirdEntryAt: -POSSESSION.finalThirdEntryCooldown,
  collectivePlan: null,
});

const attackingProgress = (team: Team, x: number): number => team === "blue" ? x / FIELD.width : (FIELD.width - x) / FIELD.width;

const collectivePosture = (state: MatchState, team: Team): "inPossession" | "outOfPossession" => {
  const actor = state.players.find((player) => player.profile.id === activeBallPlayerId(state));
  return actor ? (actor.team === team ? "inPossession" : "outOfPossession") : state.possessionTeam === team ? "inPossession" : "outOfPossession";
};

const measureShape = (state: MatchState, team: Team): TeamShape => {
  const players = state.players.filter((player) => player.team === team && player.profile.position !== "goalkeeper");
  if (players.length === 0) return { width: 0, depth: 0, compactness: 0, lineHeight: 0 };
  const xs = players.map((player) => player.position.x);
  const ys = players.map((player) => player.position.y);
  const centroid = {
    x: xs.reduce((sum, value) => sum + value, 0) / players.length,
    y: ys.reduce((sum, value) => sum + value, 0) / players.length,
  };
  return {
    width: Math.max(...ys) - Math.min(...ys),
    depth: Math.max(...xs) - Math.min(...xs),
    compactness: players.reduce((sum, player) => sum + distance(player.position, centroid), 0) / players.length,
    lineHeight: attackingProgress(team, centroid.x) * 100,
  };
};

const detectPhase = (state: MatchState, team: Team, shape: TeamShape): TacticalPhase => {
  const progress = attackingProgress(team, state.ball.position.x);
  const sinceControlChange = state.elapsed - state.controlChangedAt;
  if (state.possessionTeam === team) {
    const wonFromOpponent = state.previousControlledTeam !== null && state.previousControlledTeam !== team;
    if (wonFromOpponent && sinceControlChange < TACTICS.counterAttackWindow) return "counterAttack";
    if (progress < TACTICS.buildUpEnd) return "buildUp";
    if (progress >= TACTICS.finalThirdStart) return "finalThird";
    return "progression";
  }
  const justLost = state.previousControlledTeam === team && state.lastControlledTeam !== team;
  if (justLost && sinceControlChange < TACTICS.counterPressWindow) return "counterPress";
  if (justLost && sinceControlChange < TACTICS.recoveryWindow && shape.depth > FIELD.width * 0.28) return "recovery";
  if (progress >= 0.64) return "highPress";
  if (progress < 0.34) return "lowBlock";
  return "midBlock";
};

const channelY = (channel: AttackChannel): number => channel === "left"
  ? FIELD.height * 0.22
  : channel === "right"
    ? FIELD.height * 0.78
    : FIELD.height * 0.5;

const average = (players: PlayerRuntime[], value: (player: PlayerRuntime) => number): number =>
  players.reduce((sum, player) => sum + value(player), 0) / Math.max(1, players.length);

const selectAttackChannel = (state: MatchState, team: Team, players: PlayerRuntime[], opponents: PlayerRuntime[]): AttackChannel => {
  const direction = team === "blue" ? 1 : -1;
  const horizon = average(players, (player) => predictionHorizon(player, 0.35));
  const channels: AttackChannel[] = ["left", "center", "right"];
  return channels.sort((first, second) => {
    const score = (channel: AttackChannel): number => {
      const point = {
        x: clamp(state.ball.position.x + direction * FIELD.width * 0.16, FIELD.width * 0.08, FIELD.width * 0.92),
        y: channelY(channel),
      };
      const space = predictedSpaceAt(point, opponents, horizon);
      const support = Math.max(...players.map((player) => {
        const predicted = predictPlayerPosition(player, horizon);
        return player.profile.skills.sprintSpeed / 100 - distance(predicted, point) / FIELD.width;
      }));
      const centralProgression = channel === "center" ? 0.08 : 0;
      return space / (FIELD.width * 0.12) + support * 0.5 + centralProgression;
    };
    return score(second) - score(first);
  })[0];
};

const chooseBuildUpStyle = (players: PlayerRuntime[]): BuildUpStyle => {
  const association = average(players, (player) => (
    player.profile.skills.passing + player.profile.skills.vision + player.profile.mental.teamwork
  ) / 3);
  const verticality = average(players, (player) => (
    player.profile.skills.sprintSpeed + player.profile.skills.burst + player.profile.mental.aggression
  ) / 3);
  if (association > verticality + 5) return "short";
  if (verticality > association + 5) return "direct";
  return "balanced";
};

const chooseDefensiveBlock = (state: MatchState, team: Team, players: PlayerRuntime[]): DefensiveBlock => {
  const scoreDifference = state.stats[team].goals - state.stats[team === "blue" ? "coral" : "blue"].goals;
  const remaining = MATCH_DURATION - state.elapsed;
  if (scoreDifference > 0 && remaining < 120) return "low";
  if (scoreDifference < 0 && remaining < 150) return "high";
  const intensity = average(players, (player) => player.profile.mental.intensity * 0.55 + player.profile.mental.aggression * 0.45);
  return intensity > 77 ? "high" : intensity < 58 ? "low" : "mid";
};

const choosePressTrigger = (state: MatchState, team: Team): PressTrigger => {
  if (!state.ball.controllerId && !state.pendingPass && !state.ball.dribbleOwnerId) return "looseBall";
  if (state.tactics[team].phase === "counterPress") return "counterPress";
  const edgeDistance = Math.min(state.ball.position.y, FIELD.height - state.ball.position.y);
  return edgeDistance < FIELD.height * 0.18 ? "touchline" : "compact";
};

const choosePresser = (state: MatchState, team: Team, players: PlayerRuntime[]): string | null => {
  const ownGoalX = team === "blue" ? 0 : FIELD.width;
  return [...players].sort((first, second) => {
    const score = (player: PlayerRuntime): number => {
      const goalkeeperPenalty = player.profile.position === "goalkeeper"
        && Math.abs(state.ball.position.x - ownGoalX) > FIELD.width * 0.14 ? FIELD.width * 0.2 : 0;
      const mentality = (player.profile.mental.aggression + player.profile.mental.intensity + player.profile.mental.anticipation) / 300;
      const future = predictPlayerPosition(player, predictionHorizon(player, 0.85) * 0.55);
      return distance(future, state.ball.position) + goalkeeperPenalty - mentality * FIELD.width * 0.045;
    };
    return score(first) - score(second);
  })[0]?.profile.id ?? null;
};

const createCollectivePlan = (state: MatchState, team: Team): TeamCollectivePlan => {
  const tactical = state.tactics[team];
  const players = state.players.filter((player) => player.team === team);
  const outfield = players.filter((player) => player.profile.position !== "goalkeeper");
  const opponents = state.players.filter((player) => player.team !== team);
  const actorId = activeBallPlayerId(state);
  const posture = collectivePosture(state, team);
  const attackChannel = selectAttackChannel(state, team, outfield, opponents);
  const corridor = channelY(attackChannel);
  const candidates = outfield.filter((player) => player.profile.id !== actorId).sort((first, second) => {
    const score = (player: PlayerRuntime): number => {
      const role = player.profile.role === "finisher" ? 0.34 : player.profile.role === "playmaker" ? 0.16 : 0;
      const vertical = player.profile.skills.sprintSpeed * 0.004 + player.profile.mental.anticipation * 0.003;
      const channelFit = 1 - clamp(Math.abs(player.position.y - corridor) / (FIELD.height * 0.5), 0, 1);
      const progress = attackingProgress(team, player.position.x);
      return role + vertical + channelFit * 0.24 + progress * 0.12;
    };
    return score(second) - score(first);
  });
  const safety = outfield.filter((player) => player.profile.id !== actorId).sort((first, second) => {
    const score = (player: PlayerRuntime): number => player.profile.skills.defending * 0.55
      + player.profile.mental.decisionMaking * 0.25 + player.profile.mental.teamwork * 0.2;
    return score(second) - score(first);
  })[0] ?? null;
  const primary = candidates.find((player) => player.profile.id !== safety?.profile.id) ?? candidates[0] ?? null;
  const secondary = candidates.find((player) => player.profile.id !== primary?.profile.id && player.profile.id !== safety?.profile.id) ?? null;
  const scoreDifference = state.stats[team].goals - state.stats[team === "blue" ? "coral" : "blue"].goals;
  const urgency = clamp((state.elapsed - MATCH_DURATION * 0.65) / (MATCH_DURATION * 0.35), 0, 1);
  const personalityRisk = average(players, (player) => player.profile.mental.creativity * 0.45 + player.profile.mental.aggression * 0.35 + player.profile.mental.composure * 0.2) / 100;
  const risk = clamp(personalityRisk + (scoreDifference < 0 ? urgency * 0.3 : scoreDifference > 0 ? -urgency * 0.2 : 0), 0.2, 0.95);
  return {
    startedAt: state.elapsed,
    expiresAt: state.elapsed + TACTICS.collectivePlanSeconds * (0.82 + average(players, (player) => player.profile.mental.teamwork) / 360),
    phase: tactical.phase,
    posture,
    ballActorId: actorId,
    buildUpStyle: chooseBuildUpStyle(players),
    attackChannel,
    defensiveBlock: chooseDefensiveBlock(state, team, players),
    risk,
    primaryRunnerId: primary?.profile.id ?? null,
    secondaryRunnerId: secondary?.profile.id ?? null,
    safetyPlayerId: safety?.profile.id ?? null,
    presserId: choosePresser(state, team, players),
    pressTrigger: choosePressTrigger(state, team),
  };
};

const collectivePlanNeedsRefresh = (state: MatchState, team: Team): boolean => {
  const tactical = state.tactics[team];
  const plan = tactical.collectivePlan;
  if (!plan || state.elapsed >= plan.expiresAt) return true;
  const posture = collectivePosture(state, team);
  return plan.phase !== tactical.phase || plan.posture !== posture || plan.ballActorId !== activeBallPlayerId(state);
};

export const updateTacticalContext = (state: MatchState, dt: number): void => {
  for (const team of ["blue", "coral"] as const) {
    const tactical = state.tactics[team];
    const shape = measureShape(state, team);
    const desiredPhase = detectPhase(state, team, shape);
    if (desiredPhase !== tactical.candidatePhase) {
      tactical.candidatePhase = desiredPhase;
      tactical.candidatePhaseStartedAt = state.elapsed;
    }
    if (desiredPhase !== tactical.phase) {
      const transitionPhase = desiredPhase === "counterAttack" || desiredPhase === "counterPress";
      const candidateStable = state.elapsed - tactical.candidatePhaseStartedAt >= POSSESSION.phaseDebounceSeconds;
      const currentDwelled = state.elapsed - tactical.phaseStartedAt >= POSSESSION.minimumPhaseSeconds;
      if (transitionPhase || (candidateStable && currentDwelled)) {
        tactical.phase = desiredPhase;
        tactical.phaseStartedAt = state.elapsed;
      }
    } else {
      tactical.candidatePhase = desiredPhase;
      tactical.candidatePhaseStartedAt = state.elapsed;
    }
    tactical.shape = shape;
    if (collectivePlanNeedsRefresh(state, team)) tactical.collectivePlan = createCollectivePlan(state, team);
    const progress = attackingProgress(team, state.ball.position.x);
    if (state.possessionTeam !== team || progress <= POSSESSION.finalThirdRearm) tactical.finalThirdLatched = false;
    const inFinalThird = state.possessionTeam === team && progress >= POSSESSION.finalThirdEnter;
    if (inFinalThird && !tactical.finalThirdLatched && state.elapsed - tactical.lastFinalThirdEntryAt >= POSSESSION.finalThirdEntryCooldown) {
      state.stats[team].finalThirdEntries += 1;
      tactical.finalThirdLatched = true;
      tactical.lastFinalThirdEntryAt = state.elapsed;
    }
    if (dt <= 0) continue;
    state.stats[team].phaseSeconds[tactical.phase] += dt;
    state.stats[team].widthIntegral += shape.width * dt;
    state.stats[team].depthIntegral += shape.depth * dt;
    state.stats[team].compactnessIntegral += shape.compactness * dt;
    state.stats[team].spatialSeconds += dt;
  }
};
