import { planAll, resolvePlanDecision, thinkingInterval } from "../ai";
import { COGNITION, FIELD } from "../config";
import { distance } from "../../shared/math";
import type { AgentDecision, MatchState, PlayerRuntime } from "../model";

const planNeedsRefresh = (player: PlayerRuntime, state: MatchState): boolean => {
  const plan = player.plan;
  if (!plan || state.elapsed >= plan.expiresAt) return true;
  if (plan.possessionTeam !== state.possessionTeam || plan.controllerId !== state.ball.controllerId) return true;
  if (plan.duringRestart !== (state.kickoffTimer > 0)) return true;
  if (plan.ballAction.kind !== "none" && state.ball.controllerId !== player.profile.id) return true;
  if (plan.target.kind === "point"
    && state.elapsed - plan.startedAt > 0.2
    && distance(player.position, plan.target.position) < player.radius * 2) return true;
  const looseBallClose = !state.ball.controllerId
    && !state.pendingPass
    && !state.ball.dribbleOwnerId
    && distance(player.position, state.ball.position) < FIELD.width * 0.065;
  return looseBallClose && plan.target.kind !== "ball";
};

export const updateCognition = (state: MatchState): Map<string, AgentDecision> => {
  const immediateRefresh = state.players.some((player) => {
    const plan = player.plan;
    return !plan || plan.possessionTeam !== state.possessionTeam || plan.controllerId !== state.ball.controllerId;
  });
  if (state.elapsed + 0.000_001 >= state.nextCognitionAt || immediateRefresh) {
    const candidates = planAll(state);
    for (const player of state.players) {
      const candidate = candidates.get(player.profile.id)!;
      const invalid = planNeedsRefresh(player, state);
      if (!invalid) {
        if (state.elapsed < player.nextThinkAt) continue;
        player.nextThinkAt = state.elapsed + thinkingInterval(player);
        const current = player.plan!;
        const sameIdea = current.intent === candidate.intent
          && current.reason === candidate.reason
          && current.ballAction.kind === candidate.ballAction.kind
          && current.target.kind === candidate.target.kind;
        const commitmentUntil = current.startedAt + (current.expiresAt - current.startedAt) * 0.65;
        if (sameIdea || state.elapsed < commitmentUntil) continue;
      }
      player.plan = candidate;
      player.lastDecisionAt = state.elapsed;
      player.nextThinkAt = state.elapsed + thinkingInterval(player);
    }
    state.nextCognitionAt = state.elapsed + COGNITION.teamTickSeconds;
  }
  return new Map(state.players.map((player) => [player.profile.id, resolvePlanDecision(player, state)]));
};
