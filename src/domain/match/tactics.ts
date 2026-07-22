import { FIELD, POSSESSION, TACTICS } from "./config";
import { distance } from "../shared/math";
import type { MatchState, TacticalPhase, Team, TeamShape, TeamTacticalState } from "./model";

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
});

const attackingProgress = (team: Team, x: number): number => team === "blue" ? x / FIELD.width : (FIELD.width - x) / FIELD.width;

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
