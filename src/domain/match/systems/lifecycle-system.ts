import { MATCH_DURATION } from "../config";
import type { MatchState } from "../model";
import { emitMatchEvent } from "../runtime/events";

export const advanceMatchClock = (state: MatchState, dt: number): void => {
  const nextElapsed = state.elapsed + dt;
  state.elapsed = nextElapsed >= MATCH_DURATION - 0.000_001 ? MATCH_DURATION : nextElapsed;
};

export const expireTemporalEffects = (state: MatchState): void => {
  if (state.feintEvasion && state.elapsed >= state.feintEvasion.expiresAt) state.feintEvasion = null;
};

export const advanceKickoff = (state: MatchState, dt: number): boolean => {
  if (state.kickoffTimer <= 0) return false;
  state.kickoffTimer = Math.max(0, state.kickoffTimer - dt);
  state.contestedSeconds += dt;
  return true;
};

export const finishMatchIfNeeded = (state: MatchState): void => {
  if (state.finished || state.elapsed < MATCH_DURATION) return;
  state.finished = true;
  emitMatchEvent(state, { type: "match-finished" });
};
