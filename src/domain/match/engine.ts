import type { MatchState } from "./model";
import { sampleSpatialAnalytics } from "./systems/analytics-system";
import { updateBall, updateControlledBall } from "./systems/ball-system";
import { resolveBallPlayerCollision, resolvePlayerCollisions } from "./systems/collision-system";
import { updateCognition } from "./systems/cognition-system";
import {
  advanceKickoff,
  advanceMatchClock,
  expireTemporalEffects,
  finishMatchIfNeeded,
} from "./systems/lifecycle-system";
import { clampPlayersToField, updatePlayers } from "./systems/movement-system";
import { expirePendingPass, updatePossession } from "./systems/possession-system";
import { updateTacticalContext } from "./systems/tactics-system";

export function stepMatch(state: MatchState, dt: number): void {
  if (state.finished) return;

  advanceMatchClock(state, dt);
  expireTemporalEffects(state);
  sampleSpatialAnalytics(state);

  if (advanceKickoff(state, dt)) {
    updateTacticalContext(state, dt);
    finishMatchIfNeeded(state);
    return;
  }

  updatePossession(state, 0);
  updateTacticalContext(state, 0);
  const decisions = updateCognition(state);
  updatePlayers(state, decisions, dt);
  resolvePlayerCollisions(state);
  clampPlayersToField(state);
  updateControlledBall(state, decisions, dt);
  updateBall(state, dt);
  updatePossession(state, dt);
  resolveBallPlayerCollision(state);
  updateTacticalContext(state, dt);
  expirePendingPass(state);
  finishMatchIfNeeded(state);
}
