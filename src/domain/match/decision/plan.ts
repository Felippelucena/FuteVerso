import { COGNITION } from "../config";
import { add, clamp, subtract } from "../../shared/math";
import type { AgentDecision, MatchState, PlanTarget, PlayerPlan, PlayerRuntime, Vec2 } from "../model";
import { activeBallPlayerId } from "../runtime/control";
import { clampToField } from "../runtime/pitch";
import { prepareReceptionAction } from "../runtime/reception-planning";
import { goalkeeperMovementTarget } from "../systems/goalkeeper-system";
import { decideAll } from "./decide";
import { nearestPlayer, outOfPositionCost } from "./shared";

/**
 * Do que se decide para o que se sustenta. A decisão é instantânea; o PLANO tem duração, âncora
 * (um ponto, a bola, um companheiro, o gol) e um compromisso — é ele que impede o jogador de
 * trocar de ideia a cada quadro, e é dele que sai o alvo vivo a cada tick.
 */

/** As intenções que só o goleiro produz. Todas resolvem o alvo pelo próprio sistema, a cada tick. */
const GOALKEEPER_INTENTS: ReadonlySet<AgentDecision["intent"]> = new Set([
  "goalkeeping", "preparingSave", "diving", "jumping", "claimingHighBall", "recoveringSave",
]);

const planTarget = (player: PlayerRuntime, decision: AgentDecision, state: MatchState): PlanTarget => {
  // O alvo do goleiro é contínuo: a bola se move a cada tick, e o ajuste de pés tem que
  // acompanhar a rota sem esperar o próximo pensamento. O plano guarda a referência, não o ponto.
  if (GOALKEEPER_INTENTS.has(decision.intent)) return { kind: "goalkeeper" };
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
      duringRestart: state.restart !== null,
    } satisfies PlayerPlan];
  }));
};

export const resolvePlanDecision = (player: PlayerRuntime, state: MatchState): AgentDecision => {
  const plan = player.plan;
  if (!plan) {
    const isGoalkeeper = player.profile.position === "goalkeeper";
    return {
      movementTarget: isGoalkeeper ? goalkeeperMovementTarget(player, state) : player.homeAnchor,
      burst: false, posture: "outOfPossession",
      intent: isGoalkeeper ? "goalkeeping" : "covering",
      reason: isGoalkeeper ? "protectGoal" : "coverGoal", ballAction: { kind: "none" },
    };
  }
  let movementTarget: Vec2;
  // Quem vai à bola persegue o ponto de encontro ao vivo, e não o alvo congelado no plano: entre
  // dois pensamentos a bola anda, e é ela que manda no trajeto de quem corre atrás dela. O
  // goleiro vem antes de tudo: o alvo dele é do sistema dele, e ganhar uma corrida não o tira
  // da posição de guarda.
  const chasing = !state.ball.controllerId
    && state.ballSituation.phase !== "contested"
    && state.ballSituation.favourite?.playerId === player.profile.id;
  if (plan.target.kind === "goalkeeper") movementTarget = goalkeeperMovementTarget(player, state);
  else if (chasing) movementTarget = state.ballSituation.contactPoint;
  else if (plan.target.kind === "point") movementTarget = plan.target.position;
  else if (plan.target.kind === "ball") movementTarget = add(state.ball.position, plan.target.offset);
  else {
    const targetPlayerId = plan.target.playerId;
    const targetPlayer = state.players.find((candidate) => candidate.profile.id === targetPlayerId);
    movementTarget = targetPlayer ? add(targetPlayer.position, plan.target.offset) : player.homeAnchor;
  }
  const controlsBall = state.ball.controllerId === player.profile.id;
  const ballAction = controlsBall ? plan.ballAction : { kind: "none" } as const;
  // O desenho da bola parada é autoritativo e legitimamente sai das linhas: o cobrador do lateral
  // e o do escanteio ficam do lado de fora (a faixa `runOff`, que o movimento já permite). Prender
  // esse alvo à margem interna deixava o cobrador parado a alguns passos do ponto — ele nunca
  // "chegava", e a cobrança só saía pela trava de tempo.
  const duringDeadBall = state.restart !== null && !state.restart.ballInPlay;
  return {
    movementTarget: duringDeadBall ? movementTarget : clampToField(movementTarget, 3),
    burst: plan.burst,
    burstDuration: plan.burstDuration,
    posture: plan.posture,
    intent: plan.intent,
    reason: plan.reason,
    ballAction,
  };
};
