import { CONTEST } from "../config";
import type { AgentDecision, MatchState } from "../model";
import { chasersFor } from "../runtime/ball-situation";
import { ballHeldByKeeper } from "../runtime/control";
import { resolveMarking } from "../runtime/marking";
import { restartLayoutTarget } from "../runtime/restart";
import { dutyHolders } from "../systems/assignment-system";
import { goalkeeperDecision } from "../systems/goalkeeper-system";
import { carrierDecision } from "./carry";
import { defensiveTarget } from "./defend";
import { pursueBallDecision } from "./pursue";
import { supportTarget } from "./support";

/**
 * O despachante: para cada jogador dos dois times, qual trilha de decisão vale agora. É só a
 * escolha da trilha — nenhuma regra de comportamento mora aqui, e é isso que mantém as trilhas
 * independentes umas das outras.
 */

export const decideAll = (state: MatchState): Map<string, AgentDecision> => {
  const decisions = new Map<string, AgentDecision>();
  // Decidir é LER o quadro, não medi-lo de novo: a leitura da bola é uma só por quadro percebido,
  // escrita pela atualização do contexto tático. Antes esta linha remedia tudo aqui — a mesma
  // pergunta respondida uma terceira vez no mesmo tick, de dentro de uma função de decisão.
  const situation = state.ballSituation;
  const actualController = state.players.find((player) => player.profile.id === state.ball.controllerId) ?? null;
  // Quem manda na bola solta é quem vence a corrida por ela — e só enquanto a corrida tiver um
  // vencedor claro. Em disputa aberta ninguém a tem, e é isso que solta os dois times para ir
  // nela. Antes esta linha era a mesma confusão de `activeBallPlayerId`, reescrita aqui.
  const controller = actualController ?? (situation.phase === "owned" && situation.favourite
    ? state.players.find((player) => player.profile.id === situation.favourite?.playerId) ?? null
    : null);
  const heldByKeeper = ballHeldByKeeper(state);
  for (const team of ["blue", "coral"] as const) {
    const teammates = state.players.filter((player) => player.team === team);
    const opponents = state.players.filter((player) => player.team !== team);
    const teamHasPossession = controller?.team === team;
    const plan = state.tactics[team].collectivePlan;
    // Quem vai à bola sai da CORRIDA, a cada quadro — não de um papel escolhido segundos atrás,
    // quando a bola estava em outro lugar. O plano tático segue mandando no que é dele: gatilho
    // desligado é abrir mão de sair para uma bola que o adversário domina. Bola em aberto,
    // porém, ninguém recusa — é o que "disputa" quer dizer.
    const mayLeaveShape = situation.phase === "contested" || !plan || plan.pressTrigger !== null;
    const slots = situation.phase === "contested" ? CONTEST.contestSlots : CONTEST.pressSlots;
    // Regra 12: bola nas mãos do goleiro adversário não se persegue — ela não pode ser tomada.
    // O time recua e marca as saídas (todos caem no alvo defensivo), em vez de correr para cima
    // de um corpo que ninguém pode disputar.
    const unpressable = heldByKeeper !== null && heldByKeeper.team !== team;
    const chasers = mayLeaveShape && !teamHasPossession && !unpressable ? chasersFor(state, team, slots) : [];
    // O segundo engajador é outra decisão, não um segundo lugar na corrida: é o zagueiro que sai
    // da linha para dividir com um portador sem pressão dentro do nosso terço. Vem do dever.
    const stepper = unpressable ? null : dutyHolders(plan, "press")[1] ?? null;
    // Quem marca quem, resolvido agora e para o time inteiro de uma vez — é aqui que a
    // exclusividade entre defensores cabe, sem ninguém precisar de estado global.
    const marking = resolveMarking(state, team, plan);
    for (const player of teammates) {
      // Bola parada: enquanto a bola está parada no ponto e o cobrador caminha, todos vão para o
      // desenho do reinício (a fonte de incumbência com prioridade sobre a cognição normal, até o
      // goleiro do tiro de meta). Cai fora no instante em que o cobrador assume a posse — daí ele
      // segue no fluxo normal (carrierDecision) e cobra com um passe.
      if (state.restart && !state.restart.ballInPlay && state.ball.controllerId !== player.profile.id) {
        // O cobrador trota direto até a bola (intent "sprinting" corre sem desacelerar perto do
        // alvo, senão ele engatinharia o último trecho e estouraria o teto de preparo). Os demais
        // apenas se reposicionam.
        const isTaker = player.profile.id === state.restart.takerId;
        decisions.set(player.profile.id, {
          movementTarget: restartLayoutTarget(player, state),
          burst: false,
          posture: player.team === state.restart.team ? "inPossession" : "outOfPossession",
          intent: isTaker ? "sprinting" : "covering",
          reason: "recoverShape",
          ballAction: { kind: "none" },
        });
        continue;
      }
      // O goleiro tem cérebro próprio (goalkeeper-system): a posição de guarda, a saída e a defesa
      // saem todas de lá. Ele só entra no fluxo comum quando é ELE que vai jogar a bola — nas
      // mãos, cobrando um reinício ou como destino de um passe do próprio time. Ganhar uma
      // corrida qualquer não o tira do gol: a saída dele tem régua própria, mais estrita.
      const keeperPlaysBall = state.ball.controllerId === player.profile.id
        || (state.pendingPass?.receiverId === player.profile.id && state.pendingPass.team === player.team);
      if (player.profile.position === "goalkeeper" && !keeperPlaysBall) {
        decisions.set(player.profile.id, goalkeeperDecision(player, state));
        continue;
      }
      if (actualController?.profile.id === player.profile.id) {
        decisions.set(player.profile.id, carrierDecision(player, teammates, opponents, state));
        continue;
      }
      // Ir buscar a bola que é sua é COMPROMISSO, não corrida que se desiste: quem empurrou a
      // bola à frente vai atrás dela, e quem foi mirado num passe vai recebê-lo — mesmo com um
      // adversário chegando antes. Quem desiste porque perdeu a corrida não disputa nada, e o
      // passe morre sem ninguém em cima dele.
      const committedToBall = !state.ball.controllerId
        && (state.ball.dribbleOwnerId === player.profile.id
          || state.pendingPass?.receiverId === player.profile.id);
      if (committedToBall || controller?.profile.id === player.profile.id) {
        decisions.set(player.profile.id, pursueBallDecision(player, state, team, false));
        continue;
      }
      if (teamHasPossession && controller) {
        const support = supportTarget(player, controller, state);
        decisions.set(player.profile.id, {
          movementTarget: support.target,
          burst: support.burst,
          posture: "inPossession",
          intent: "supporting",
          reason: support.reason,
          ballAction: { kind: "none" },
        });
        continue;
      }
      // Ir à bola tem duas origens, e uma só forma de andar: ganhar a corrida por ela, ou ter
      // sido mandado sair da linha para dividir (o segundo engajador, que é uma aposta do plano
      // e por isso vai comprometido, mesmo perdendo a corrida).
      const committed = stepper === player.profile.id;
      if (committed || chasers.includes(player.profile.id)) {
        decisions.set(player.profile.id, pursueBallDecision(player, state, team, committed));
        continue;
      }
      // Por quem ele responde vem da leitura do quadro, não de um id decidido segundos atrás:
      // o vizinho que entrou na faixa dele agora é o problema dele agora.
      const { target, intent, burst, reason, burstDuration } = defensiveTarget(
        player,
        marking.get(player.profile.id) ?? null,
        state,
      );
      decisions.set(player.profile.id, { movementTarget: target, burst, burstDuration, posture: "outOfPossession", intent, reason, ballAction: { kind: "none" } });
    }
  }
  return decisions;
};
