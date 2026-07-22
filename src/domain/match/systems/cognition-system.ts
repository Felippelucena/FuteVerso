import { planAll, resolvePlanDecision, thinkingInterval } from "../ai";
import { COGNITION, FIELD } from "../config";
import { distance } from "../../shared/math";
import type { AgentDecision, MatchState, PlayerRuntime } from "../model";
import { activeBallPlayerId } from "../runtime/control";

const planNeedsRefresh = (player: PlayerRuntime, state: MatchState): boolean => {
  const plan = player.plan;
  if (!plan) return true;
  if (plan.possessionTeam !== state.possessionTeam || plan.ballActorId !== activeBallPlayerId(state)) return true;
  if (plan.collectivePlanStartedAt !== (state.tactics[player.team].collectivePlan?.startedAt ?? 0)) return true;
  if (plan.duringRestart !== (state.kickoffTimer > 0)) return true;
  if (plan.ballAction.kind !== "none"
    && state.ball.controllerId !== player.profile.id
    && state.ball.dribbleOwnerId !== player.profile.id) return true;
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
  const actorId = activeBallPlayerId(state);
  const immediateRefresh = state.players.some((player) => {
    const plan = player.plan;
    return !plan
      || plan.possessionTeam !== state.possessionTeam
      || plan.ballActorId !== actorId
      || plan.collectivePlanStartedAt !== (state.tactics[player.team].collectivePlan?.startedAt ?? 0);
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
        const sameTargetReference = current.target.kind === candidate.target.kind
          && (current.target.kind !== "player" || candidate.target.kind !== "player" || current.target.playerId === candidate.target.playerId);
        const sameBallAction = current.ballAction.kind === candidate.ballAction.kind
          && (current.ballAction.kind !== "dribble" || candidate.ballAction.kind !== "dribble" || current.ballAction.style === candidate.ballAction.style)
          && (current.ballAction.kind !== "dribble" || candidate.ballAction.kind !== "dribble"
            || current.ballAction.touchRange === candidate.ballAction.touchRange)
          && (current.ballAction.kind !== "pass" || candidate.ballAction.kind !== "pass" || current.ballAction.receiverId === candidate.ballAction.receiverId);
        const sameIdea = current.intent === candidate.intent
          && current.reason === candidate.reason
          && sameBallAction
          && sameTargetReference
          && (current.intent !== "receiving" || current.burst === candidate.burst);
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
