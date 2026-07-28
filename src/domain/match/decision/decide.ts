import { CONTEST } from "../config";
import type { AgentDecision, BallSituation, MatchState, PlayerRuntime, Team, TeamCollectivePlan } from "../model";
import { chasersFor } from "../runtime/ball-situation";
import { ballHeldByKeeper } from "../runtime/control";
import { resolveMarking, type MarkingAssignment } from "../runtime/marking";
import { restartLayoutTarget } from "../runtime/restart";
import { dutyHolders } from "../systems/assignment-system";
import { goalkeeperDecision } from "../systems/goalkeeper-system";
import { carrierDecision } from "./carry";
import { defensiveTarget } from "./defend";
import { pursueBallDecision } from "./pursue";
import { supportTarget } from "./support";

/**
 * O despachante: para cada jogador, qual trilha de decisão vale agora. É só a escolha da trilha —
 * nenhuma regra de comportamento mora aqui, e é isso que mantém as trilhas independentes.
 *
 * Vem em três camadas porque o custo de cada uma é diferente. O quadro e o time se resolvem uma
 * vez e valem para todos; a decisão individual é cara e só interessa a quem vai de fato repensar.
 * Quem decide isso é a cognição — antes ela pedia as vinte e duas decisões e jogava fora as vinte
 * e uma que ninguém ia usar.
 */

/** O que vale para os dois times neste quadro. */
export interface FrameContext {
  situation: BallSituation;
  /** Quem tem a bola no pé de fato. */
  actualController: PlayerRuntime | null;
  /** Quem manda nela agora: o portador, ou quem vence a corrida com folga. Nulo em disputa aberta. */
  controller: PlayerRuntime | null;
  heldByKeeper: PlayerRuntime | null;
}

/** O que o time resolve de uma vez só: quem sai para a bola e quem responde por quem. */
export interface TeamContext {
  team: Team;
  teammates: PlayerRuntime[];
  opponents: PlayerRuntime[];
  teamHasPossession: boolean;
  plan: TeamCollectivePlan | null;
  chasers: string[];
  /** O segundo engajador: o zagueiro que sai da linha para dividir. Vem do dever, não da corrida. */
  stepper: string | null;
  marking: Map<string, MarkingAssignment>;
}

export const readFrame = (state: MatchState): FrameContext => {
  // Decidir é LER o quadro, não medi-lo de novo: a leitura da bola é uma só por quadro percebido,
  // escrita pela atualização do contexto tático.
  const situation = state.ballSituation;
  const actualController = state.players.find((player) => player.profile.id === state.ball.controllerId) ?? null;
  // Quem manda na bola solta é quem vence a corrida por ela — e só enquanto a corrida tiver um
  // vencedor claro. Em disputa aberta ninguém a tem, e é isso que solta os dois times para ir nela.
  const controller = actualController ?? (situation.phase === "owned" && situation.favourite
    ? state.players.find((player) => player.profile.id === situation.favourite?.playerId) ?? null
    : null);
  return { situation, actualController, controller, heldByKeeper: ballHeldByKeeper(state) };
};

export const readTeam = (state: MatchState, frame: FrameContext, team: Team): TeamContext => {
  const plan = state.tactics[team].collectivePlan;
  const teamHasPossession = frame.controller?.team === team;
  // Quem vai à bola sai da CORRIDA, a cada quadro — não de um papel escolhido segundos atrás,
  // quando a bola estava em outro lugar. O plano tático segue mandando no que é dele: gatilho
  // desligado é abrir mão de sair para uma bola que o adversário domina. Bola em aberto, porém,
  // ninguém recusa — é o que "disputa" quer dizer.
  const mayLeaveShape = frame.situation.phase === "contested" || !plan || plan.pressTrigger !== null;
  const slots = frame.situation.phase === "contested" ? CONTEST.contestSlots : CONTEST.pressSlots;
  // Regra 12: bola nas mãos do goleiro adversário não se persegue — ela não pode ser tomada. O
  // time recua e marca as saídas, em vez de correr para cima de um corpo que ninguém disputa.
  const unpressable = frame.heldByKeeper !== null && frame.heldByKeeper.team !== team;
  return {
    team,
    teammates: state.players.filter((player) => player.team === team),
    opponents: state.players.filter((player) => player.team !== team),
    teamHasPossession,
    plan,
    chasers: mayLeaveShape && !teamHasPossession && !unpressable ? chasersFor(state, team, slots) : [],
    stepper: unpressable ? null : dutyHolders(plan, "press")[1] ?? null,
    // Quem marca quem, resolvido para o time inteiro de uma vez — é aqui que a exclusividade entre
    // defensores cabe, sem ninguém precisar de estado global.
    marking: resolveMarking(state, team, plan),
  };
};

export const decideFor = (
  state: MatchState,
  frame: FrameContext,
  context: TeamContext,
  player: PlayerRuntime,
): AgentDecision => {
  // Bola parada: enquanto a bola está parada no ponto e o cobrador caminha, todos vão para o
  // desenho do reinício (a fonte de incumbência com prioridade sobre a cognição normal, até o
  // goleiro do tiro de meta). Cai fora no instante em que o cobrador assume a posse — daí ele
  // segue no fluxo normal (carrierDecision) e cobra com um passe.
  if (state.restart && !state.restart.ballInPlay && state.ball.controllerId !== player.profile.id) {
    // O cobrador trota direto até a bola (intent "sprinting" corre sem desacelerar perto do alvo,
    // senão ele engatinharia o último trecho e estouraria o teto de preparo).
    const isTaker = player.profile.id === state.restart.takerId;
    return {
      movementTarget: restartLayoutTarget(player, state),
      burst: false,
      posture: player.team === state.restart.team ? "inPossession" : "outOfPossession",
      intent: isTaker ? "sprinting" : "covering",
      reason: "recoverShape",
      ballAction: { kind: "none" },
    };
  }
  // O goleiro tem cérebro próprio (goalkeeper-system): a posição de guarda, a saída e a defesa saem
  // todas de lá. Ele só entra no fluxo comum quando é ELE que vai jogar a bola — nas mãos, cobrando
  // um reinício ou como destino de um passe do próprio time. Ganhar uma corrida qualquer não o tira
  // do gol: a saída dele tem régua própria, mais estrita.
  const keeperPlaysBall = state.ball.controllerId === player.profile.id
    || (state.pendingPass?.receiverId === player.profile.id && state.pendingPass.team === player.team);
  if (player.profile.position === "goalkeeper" && !keeperPlaysBall) {
    return goalkeeperDecision(player, state);
  }
  if (frame.actualController?.profile.id === player.profile.id) {
    return carrierDecision(player, context.teammates, context.opponents, state);
  }
  // Ir buscar a bola que é sua é COMPROMISSO, não corrida que se desiste: quem empurrou a bola à
  // frente vai atrás dela, e quem foi mirado num passe vai recebê-lo — mesmo com um adversário
  // chegando antes. Quem desiste porque perdeu a corrida não disputa nada, e o passe morre sem
  // ninguém em cima dele.
  const committedToBall = !state.ball.controllerId
    && (state.ball.dribbleOwnerId === player.profile.id
      || state.pendingPass?.receiverId === player.profile.id);
  if (committedToBall || frame.controller?.profile.id === player.profile.id) {
    return pursueBallDecision(player, state, context.team, false);
  }
  if (context.teamHasPossession && frame.controller) {
    const support = supportTarget(player, frame.controller, state);
    return {
      movementTarget: support.target,
      burst: support.burst,
      posture: "inPossession",
      intent: "supporting",
      reason: support.reason,
      ballAction: { kind: "none" },
    };
  }
  // Ir à bola tem duas origens, e uma só forma de andar: ganhar a corrida por ela, ou ter sido
  // mandado sair da linha para dividir (o segundo engajador, que é uma aposta do plano e por isso
  // vai comprometido, mesmo perdendo a corrida).
  const committed = context.stepper === player.profile.id;
  if (committed || context.chasers.includes(player.profile.id)) {
    return pursueBallDecision(player, state, context.team, committed);
  }
  // Por quem ele responde vem da leitura do quadro, não de um id decidido segundos atrás: o vizinho
  // que entrou na faixa dele agora é o problema dele agora.
  const { target, intent, burst, reason, burstDuration } = defensiveTarget(
    player,
    context.marking.get(player.profile.id) ?? null,
    state,
  );
  return { movementTarget: target, burst, burstDuration, posture: "outOfPossession", intent, reason, ballAction: { kind: "none" } };
};

export const decideAll = (state: MatchState): Map<string, AgentDecision> => {
  const decisions = new Map<string, AgentDecision>();
  const frame = readFrame(state);
  for (const team of ["blue", "coral"] as const) {
    const context = readTeam(state, frame, team);
    for (const player of context.teammates) {
      decisions.set(player.profile.id, decideFor(state, frame, context, player));
    }
  }
  return decisions;
};
