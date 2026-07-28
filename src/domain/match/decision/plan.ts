import { COGNITION, PHYSICS } from "../config";
import { add, blend, clamp, distanceSquared, limit, scale, subtract } from "../../shared/math";
import type { AgentDecision, MatchState, PlanTarget, PlayerPlan, PlayerRuntime, Vec2 } from "../model";
import { activeBallPlayerId } from "../runtime/control";
import { assignedAnchor } from "../runtime/formation-geometry";
import { clampToField } from "../runtime/pitch";
import { prepareReceptionAction } from "../runtime/reception-planning";
import { goalkeeperMovementTarget } from "../systems/goalkeeper-system";
import { decideAll, decideFor, type FrameContext, type TeamContext } from "./decide";
import { outOfPositionCost } from "./shared";

/**
 * Do que se decide para o que se sustenta. A decisão é instantânea; o PLANO tem duração, âncora
 * (um ponto, a bola, um companheiro, o gol) e um compromisso — é ele que impede o jogador de
 * trocar de ideia a cada quadro, e é dele que sai o alvo vivo a cada tick.
 */

/** As intenções que só o goleiro produz. Todas resolvem o alvo pelo próprio sistema, a cada tick. */
const GOALKEEPER_INTENTS: ReadonlySet<AgentDecision["intent"]> = new Set([
  "goalkeeping", "preparingSave", "diving", "jumping", "claimingHighBall", "recoveringSave",
]);

/**
 * De ponto congelado para referências vivas. O plano guarda de que o alvo é FEITO, não onde ele
 * estava: quem calcula o alvo declara o quadro (`decision.targetFrame`), e aqui só se converte
 * para deslocamentos. Adivinhar o quadro pela intenção — como se fazia — tratava o alvo inteiro
 * do apoio como relativo ao portador, inclusive a parte que vinha da célula presa ao gramado.
 */
const planTarget = (decision: AgentDecision, state: MatchState): PlanTarget => {
  // O alvo do goleiro é contínuo: a bola se move a cada tick, e o ajuste de pés tem que
  // acompanhar a rota sem esperar o próximo pensamento. O plano guarda a referência, não o ponto.
  if (GOALKEEPER_INTENTS.has(decision.intent)) return { kind: "goalkeeper" };
  if (decision.intent === "pressing") {
    return { kind: "ball", offset: subtract(decision.movementTarget, state.ball.position) };
  }
  const frame = decision.targetFrame;
  if (frame) {
    const body = frame.bodyId
      ? state.players.find((candidate) => candidate.profile.id === frame.bodyId) ?? null
      : null;
    return {
      kind: "anchored",
      anchorOffset: subtract(decision.movementTarget, frame.anchor),
      bodyId: body?.profile.id ?? null,
      bodyOffset: body ? subtract(decision.movementTarget, body.position) : { x: 0, y: 0 },
      bodyShare: body ? frame.bodyShare : 0,
    };
  }
  return { kind: "point", position: { ...decision.movementTarget } };
};

/**
 * Que referência VIVA o alvo persegue. Dois planos com a mesma referência são a mesma ideia — é o
 * que a cognição pergunta para decidir se vale a pena trocar o plano em curso.
 */
export const targetReference = (target: PlanTarget): string =>
  target.kind === "anchored" ? `anchored:${target.bodyId ?? "-"}` : target.kind;

export const thinkingInterval = (player: PlayerRuntime): number => {
  const read = (player.profile.mental.decisionMaking * 0.72 + player.profile.mental.anticipation * 0.28) / 100;
  // Fora de posição o jogador lê o jogo mais devagar: as referências que ele conhece não estão
  // onde ele está acostumado a procurar.
  const quality = clamp(read * (1 - outOfPositionCost(player) * 0.3), 0, 1);
  return COGNITION.slowestThinkSeconds + (COGNITION.fastestThinkSeconds - COGNITION.slowestThinkSeconds) * quality;
};

/** O plano de um jogador a partir da decisão dele. Ver `planFor` para o caminho da cognição. */
const planFromDecision = (state: MatchState, player: PlayerRuntime, decision: AgentDecision): PlayerPlan => ({
  target: planTarget(decision, state),
  burst: decision.burst,
  burstDuration: decision.burstDuration,
  posture: decision.posture,
  intent: decision.intent,
  reason: decision.reason,
  ballAction: decision.ballAction,
  objective: decision.reason === "aggressiveBreak" ? "aggressiveBreak" : null,
  preparedReceptionAction: prepareReceptionAction(state, player),
  startedAt: state.elapsed,
  expiresAt: state.elapsed + COGNITION.planDuration[decision.intent] * (0.88 + player.profile.mental.composure / 520),
  possessionTeam: state.possessionTeam,
  controllerId: state.ball.controllerId,
  ballActorId: activeBallPlayerId(state),
  collectivePlanStartedAt: state.tactics[player.team].collectivePlan?.startedAt ?? 0,
  duringRestart: state.restart !== null,
});

/**
 * O plano de UM jogador, a partir do quadro e do time já lidos. É por aqui que a cognição pede
 * só o que vai usar — decidir é a parte cara, e quem não vai repensar não precisa de decisão.
 */
export const planFor = (
  state: MatchState,
  frame: FrameContext,
  context: TeamContext,
  player: PlayerRuntime,
): PlayerPlan => planFromDecision(state, player, decideFor(state, frame, context, player));

/** Os planos dos vinte e dois. Cenário montado à mão e diagnóstico; o tick usa `planFor`. */
export const planAll = (state: MatchState): Map<string, PlayerPlan> => {
  const decisions = decideAll(state);
  return new Map(state.players.map((player) =>
    [player.profile.id, planFromDecision(state, player, decisions.get(player.profile.id)!)]));
};

/**
 * Espaço pessoal: o alvo se afasta do companheiro que já ocupa aquele palmo de grama.
 *
 * É ANTECIPATÓRIO e mora no ALVO; a colisão (`systems/collision-system`) é CORRETIVA e mora no
 * CORPO. Uma diz para onde eu quero ir sabendo que há alguém ali; a outra impõe que dois corpos
 * não ocupem o mesmo ponto. Nenhuma substitui a outra: a separação é mole por necessidade (senão
 * não haveria dividida) e a colisão só age depois que os corpos já estão amontoados.
 *
 * Só entre companheiros: dois de nós no mesmo metro quadrado é um jogador desperdiçado; um
 * adversário no meu metro quadrado é o jogo.
 *
 * Roda dentro de `resolvePlanDecision`, que a cognição resolve para os vinte e dois ANTES de
 * qualquer corpo se mexer — todos leem o mesmo quadro, e a ordem da escalação não vira resultado.
 */
const personalSpaceShift = (player: PlayerRuntime, target: Vec2, state: MatchState): Vec2 => {
  const room = player.radius * 2 * PHYSICS.personalSpaceFactor;
  const roomSquared = room * room;
  let shift = { x: 0, y: 0 };
  for (const teammate of state.players) {
    if (teammate.team !== player.team || teammate.profile.id === player.profile.id) continue;
    const squared = distanceSquared(target, teammate.position);
    if (squared >= roomSquared || squared < 0.0001) continue;
    const gap = Math.sqrt(squared);
    shift = add(shift, scale(subtract(target, teammate.position), (room - gap) / gap));
  }
  return limit(shift, room);
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
    const { anchorOffset, bodyId, bodyOffset, bodyShare } = plan.target;
    // A âncora é VIVA: a colocação do bloco se refaz a cada percepção, e é ela que mantém o alvo
    // preso ao gramado enquanto o corpo de referência anda.
    const anchored = add(assignedAnchor(state.tactics[player.team].collectivePlan, player), anchorOffset);
    const body = bodyId ? state.players.find((candidate) => candidate.profile.id === bodyId) ?? null : null;
    movementTarget = body ? blend(anchored, add(body.position, bodyOffset), bodyShare) : anchored;
  }
  const controlsBall = state.ball.controllerId === player.profile.id;
  const ballAction = controlsBall ? plan.ballAction : { kind: "none" } as const;
  // O desenho da bola parada é autoritativo e legitimamente sai das linhas: o cobrador do lateral
  // e o do escanteio ficam do lado de fora (a faixa `runOff`, que o movimento já permite). Prender
  // esse alvo à margem interna deixava o cobrador parado a alguns passos do ponto — ele nunca
  // "chegava", e a cobrança só saía pela trava de tempo.
  const duringDeadBall = state.restart !== null && !state.restart.ballInPlay;
  // Alvo ancorado na bola não tem espaço pessoal: a bola é um ponto só, e disputá-la é o jogo. Na
  // bola parada o desenho do reinício é autoritativo — a mesma razão pela qual `engine.ts` já
  // suspende a colisão ali.
  const positional = !duringDeadBall && !chasing && !controlsBall
    && plan.target.kind !== "ball" && plan.target.kind !== "goalkeeper";
  const spaced = positional ? add(movementTarget, personalSpaceShift(player, movementTarget, state)) : movementTarget;
  return {
    movementTarget: duringDeadBall ? spaced : clampToField(spaced, 3),
    burst: plan.burst,
    burstDuration: plan.burstDuration,
    posture: plan.posture,
    intent: plan.intent,
    reason: plan.reason,
    ballAction,
  };
};
