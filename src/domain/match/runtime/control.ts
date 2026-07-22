import { POSSESSION } from "../config";
import { clamp, distance } from "../../shared/math";
import type { MatchState, PlayerRuntime, Team } from "../model";
import { policyLearningBounds } from "../../roster/personality";
import { emitCognitiveEvent } from "./cognitive-events";

export const pressureAt = (state: MatchState, player: PlayerRuntime): number => {
  const closest = Math.min(...state.players.filter((other) => other.team !== player.team).map((other) => distance(other.position, player.position)));
  return clamp(1 - closest / 10, 0, 1);
};

export const activeBallPlayerId = (state: MatchState): string | null =>
  state.ball.controllerId ?? state.ball.dribbleOwnerId ?? state.pendingPass?.receiverId ?? null;

export const adaptPlayerPolicy = (
  player: PlayerRuntime,
  key: keyof PlayerRuntime["memory"]["policy"],
  amount: number,
): void => {
  if (amount === 0) return;
  const bounds = policyLearningBounds(player.profile, key);
  const learningScale = 0.6 + player.profile.mental.adaptability / 100 * 1.4;
  player.memory.policy[key] = clamp(player.memory.policy[key] + amount * learningScale, bounds.minimum, bounds.maximum);
  player.memory.version += 1;
};

const confirmPossession = (state: MatchState, team: Team): void => {
  const previous = state.lastControlledTeam;
  if (previous !== team) {
    if (previous) state.stats[team].turnoversWon += 1;
    state.previousControlledTeam = previous;
    state.lastControlledTeam = team;
    state.controlChangedAt = state.elapsed;
    state.lastPossessionChangeAt = state.elapsed;
    emitCognitiveEvent(state, "possessionChanged", null, { controllerId: state.ball.controllerId ?? undefined });
  }
  state.possessionTeam = team;
  state.possessionCandidateTeam = null;
  state.possessionCandidateSince = state.elapsed;
  state.nextCognitionAt = state.elapsed;
};

export const registerControlledTeam = (state: MatchState, team: Team, force = false): void => {
  if (state.ballControlTeam !== team) state.ballControlTeam = team;
  if (force || state.possessionTeam === team) {
    if (state.possessionTeam !== team) confirmPossession(state, team);
    else {
      state.possessionCandidateTeam = null;
      state.possessionCandidateSince = state.elapsed;
    }
    return;
  }
  if (state.possessionCandidateTeam !== team) {
    state.possessionCandidateTeam = team;
    state.possessionCandidateSince = state.elapsed;
    return;
  }
  if (state.elapsed - state.possessionCandidateSince >= POSSESSION.confirmationSeconds) confirmPossession(state, team);
};

export const registerLooseBall = (state: MatchState): void => {
  if (state.ballControlTeam !== null) {
    state.ballControlTeam = null;
    state.possessionCandidateTeam = null;
    state.possessionCandidateSince = state.elapsed;
  }
  if (state.possessionTeam && state.elapsed - state.possessionCandidateSince >= POSSESSION.looseBallGraceSeconds) {
    state.possessionTeam = null;
  }
};

export const clearDribbleOwner = (state: MatchState): void => {
  state.ball.dribbleOwnerId = null;
  state.ball.dribbleTarget = null;
  state.ball.dribbleStyle = null;
  state.ball.dribbleTouchRange = null;
  state.ball.dribbleStartedAt = 0;
};

export const isEvadedDefender = (state: MatchState, player: PlayerRuntime): boolean =>
  state.feintEvasion?.defenderId === player.profile.id && state.elapsed < state.feintEvasion.expiresAt;
