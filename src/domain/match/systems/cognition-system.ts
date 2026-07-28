import { planFor, readFrame, readTeam, resolvePlanDecision, targetReference, thinkingInterval } from "../decision";
import { COGNITION, CONTEST } from "../config";
import { distance } from "../../shared/math";
import type { AgentDecision, MatchState, PlayerRuntime } from "../model";
import { activeBallPlayerId } from "../runtime/control";
import { cognitiveEventAffects } from "../runtime/cognitive-events";

const planNeedsRefresh = (player: PlayerRuntime, state: MatchState): boolean => {
  const plan = player.plan;
  if (!plan) return true;
  if (plan.possessionTeam !== state.possessionTeam || plan.ballActorId !== activeBallPlayerId(state)) return true;
  if (plan.collectivePlanStartedAt !== (state.tactics[player.team].collectivePlan?.startedAt ?? 0)) return true;
  if (plan.duringRestart !== (state.restart !== null)) return true;
  if (plan.ballAction.kind !== "none"
    && state.ball.controllerId !== player.profile.id
    && state.ball.dribbleOwnerId !== player.profile.id) return true;
  // Alvo POSICIONAL cumprido é objetivo cumprido: chegou, repensa. Não vale para alvo colado num
  // corpo que se mexe — esse nunca está "cumprido", e o gatilho viraria repensar a cada quadro.
  const positional = plan.target.kind === "point" || (plan.target.kind === "anchored" && !plan.target.bodyId);
  if (positional
    && state.elapsed - plan.startedAt > 0.2
    && distance(player.position, resolvePlanDecision(player, state).movementTarget) < player.radius * 2) return true;
  // Bola em aberto e eu no páreo: repensar agora, não no próximo pensamento. É a diferença
  // entre investir na bola adiantada e vê-la passar — antes este gatilho se calava justamente
  // quando havia um pique ou um passe em curso, que é quando a chance aparece.
  const { phase, contenders } = state.ballSituation;
  const best = contenders[0];
  const mine = contenders.find((contender) => contender.playerId === player.profile.id);
  const inTheRace = phase === "contested" && best !== undefined && mine !== undefined
    && mine.eta <= best.eta + CONTEST.openMargin;
  return inTheRace && plan.target.kind !== "ball";
};

export const updateCognition = (state: MatchState): Map<string, AgentDecision> => {
  const actorId = activeBallPlayerId(state);
  const queuedEvents = state.cognitiveEvents;
  const latestEventId = queuedEvents.at(-1)?.id ?? 0;
  const immediateRefresh = state.players.some((player) => {
    const plan = player.plan;
    const stimulated = queuedEvents.some((event) => event.id > player.lastCognitiveEventId && cognitiveEventAffects(event, player.profile.id));
    return stimulated || !plan
      || plan.possessionTeam !== state.possessionTeam
      || plan.ballActorId !== actorId
      || plan.collectivePlanStartedAt !== (state.tactics[player.team].collectivePlan?.startedAt ?? 0);
  });
  if (state.elapsed + 0.000_001 >= state.nextCognitionAt || immediateRefresh) {
    // O quadro e o contexto de cada time se resolvem uma vez; a DECISÃO, que é a parte cara, só
    // para quem vai de fato repensar — antes o ciclo pedia as vinte e duas e jogava fora as que
    // ninguém ia usar.
    //
    // Em duas passagens, e não numa: decidir lê o plano dos companheiros (é assim que se prevê
    // para onde o outro vai). Decidir dentro do laço de adoção faria os primeiros lerem os planos
    // velhos e os últimos os novos — a ordem da escalação virando resultado. Todos decidem do
    // mesmo quadro, e só então o quadro muda.
    const frame = readFrame(state);
    const contexts = { blue: readTeam(state, frame, "blue"), coral: readTeam(state, frame, "coral") };
    const thinkers = state.players.flatMap((player) => {
      const stimulated = queuedEvents.some((event) => event.id > player.lastCognitiveEventId && cognitiveEventAffects(event, player.profile.id));
      const invalid = stimulated || planNeedsRefresh(player, state);
      if (!invalid && state.elapsed < player.nextThinkAt) return [];
      return [{ player, invalid }];
    });
    const candidates = thinkers.map(({ player }) => planFor(state, frame, contexts[player.team], player));
    for (const [index, { player, invalid }] of thinkers.entries()) {
      const candidate = candidates[index];
      if (!invalid) {
        player.nextThinkAt = state.elapsed + thinkingInterval(player);
        const current = player.plan!;
        const sameTargetReference = targetReference(current.target) === targetReference(candidate.target);
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
      if (candidate.objective === "aggressiveBreak") {
        if (player.objective !== "aggressiveBreak" || state.elapsed >= player.objectiveExpiresAt) {
          player.objectiveExpiresAt = state.elapsed + 3;
          state.stats[player.team].aggressiveBreaks += 1;
        }
        player.objective = "aggressiveBreak";
      } else if (invalid || state.elapsed >= player.objectiveExpiresAt) {
        player.objective = null;
        player.objectiveExpiresAt = 0;
      }
      player.lastDecisionAt = state.elapsed;
      player.nextThinkAt = state.elapsed + thinkingInterval(player);
    }
    state.nextCognitionAt = state.elapsed + COGNITION.teamTickSeconds;
    for (const player of state.players) player.lastCognitiveEventId = Math.max(player.lastCognitiveEventId, latestEventId);
    state.cognitiveEvents = [];
  }
  return new Map(state.players.map((player) => [player.profile.id, resolvePlanDecision(player, state)]));
};
