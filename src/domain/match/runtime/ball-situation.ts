import { CONTEST, PHYSICS } from "../config";
import type { BallContender, BallPhase, BallSituation, MatchState, PlayerRuntime, Team, Vec2 } from "../model";
import { isEvadedDefender } from "./control";
import { insidePenaltyArea } from "./formation-geometry";
import { etaToPoint } from "./player-metrics";
import { predictBallPosition } from "./prediction";
import { restartForbidsTouch } from "./restart";

/**
 * A leitura de bola do motor: **quem chega no próximo toque, e com que folga?**
 *
 * Uma pergunta só, no lugar dos três estados que o motor confundia num id de "ator" — bola no
 * pé, bola adiantada num pique, bola viajando num passe. A diferença entre eles nunca foi de
 * rótulo: é uma corrida, e é a folga do vencedor que diz se o lance está resolvido ou em aberto.
 *
 * Daí caem sozinhos os casos que antes precisariam de tratamento próprio: a bola que o driblador
 * empurrou para dentro do alcance do zagueiro deixa de ser dele porque ele perdeu a corrida, e o
 * passe desviado deixa de ser passe porque o destinatário deixou de chegar primeiro. Nenhum dos
 * dois precisa ser reconhecido como "pique" ou "desvio".
 */

/** Quem tem alguma chance de disputar esta bola. Só o que impede de vez entra aqui. */
const canReachBall = (state: MatchState, player: PlayerRuntime): boolean =>
  !isEvadedDefender(state, player)
  && !restartForbidsTouch(state, player.profile.id)
  // O goleiro vai à bola pela régua dele (goalkeeper-system), que é mais estrita e exige a
  // própria área. Fora dela ele não sai, e contá-lo aqui daria ao time a impressão de que
  // alguém resolveu um lance que ninguém foi resolver.
  && (player.profile.position !== "goalkeeper" || insidePenaltyArea(player.team, state.ball.position, true));

/**
 * Quanto tempo até este jogador alcançar o ponto — contando a perna. Os cooldowns são **atraso**,
 * não impedimento: quem acabou de chutar chega junto da bola sem poder tocá-la, e tratá-lo como
 * o dono do lance faria o passador correr atrás do próprio passe.
 */
const ballEta = (player: PlayerRuntime, point: Vec2): number => Math.max(
  etaToPoint(player, point),
  player.kickCooldown,
  player.controlCooldown,
  player.reactionTimer,
);

const rankByEta = (players: PlayerRuntime[], point: Vec2): BallContender[] =>
  players
    .map((player) => ({ playerId: player.profile.id, team: player.team, eta: ballEta(player, point) }))
    .sort((first, second) => first.eta - second.eta || first.playerId.localeCompare(second.playerId));

/**
 * O primeiro instante da rota em que a bola é alcançável e alguém consegue estar onde ela
 * estará. Quem não alcança dentro do horizonte não some da conta: o encontro passa a ser o fim
 * do horizonte, e vale quem estiver mais perto — é a bola longa, que ninguém pega agora mas
 * alguém vai pegar.
 */
const meetingPoint = (state: MatchState, contenders: PlayerRuntime[]): { point: Vec2; at: number } => {
  let last: { point: Vec2; at: number } = {
    point: predictBallPosition(state, CONTEST.horizonSeconds),
    at: CONTEST.horizonSeconds,
  };
  for (let seconds = 0; seconds <= CONTEST.horizonSeconds; seconds += CONTEST.searchStep) {
    const height = state.ball.height + state.ball.verticalVelocity * seconds
      - PHYSICS.gravity * seconds * seconds / 2;
    if (height > PHYSICS.reachableBallHeight) continue;
    const point = predictBallPosition(state, seconds);
    if (contenders.some((player) => ballEta(player, point) <= seconds)) return { point, at: seconds };
    last = { point, at: seconds };
  }
  return last;
};

export const readBallSituation = (state: MatchState): BallSituation => {
  const controller = state.players.find((player) => player.profile.id === state.ball.controllerId) ?? null;
  const able = state.players.filter((player) => canReachBall(state, player) && player !== controller);
  if (controller) {
    // A bola é dele até alguém tirá-la — quem faz isso é a disputa (`engagement-system`), não
    // esta corrida. Os demais seguem ranqueados: "quanto tempo até eu chegar nele" é justamente
    // a pergunta de quem vai pressionar.
    const held = { playerId: controller.profile.id, team: controller.team, eta: 0 };
    const others = rankByEta(able, state.ball.position);
    return {
      phase: "controlled",
      contactPoint: { ...state.ball.position },
      contactIn: 0,
      contenders: [held, ...others],
      favourite: held,
      rival: others.find((contender) => contender.team !== controller.team) ?? null,
      margin: Number.POSITIVE_INFINITY,
    };
  }
  const { point, at } = meetingPoint(state, able);
  const contenders = rankByEta(able, point);
  const favourite = contenders[0] ?? null;
  const rival = favourite ? contenders.find((contender) => contender.team !== favourite.team) ?? null : null;
  const margin = favourite && rival ? rival.eta - favourite.eta : Number.POSITIVE_INFINITY;
  // Histerese: sair da disputa custa mais caro do que entrar nela. Sem isso uma corrida
  // equilibrada trocaria de dono a cada quadro, e o plano de todo mundo iria junto.
  const settled = state.ballSituation.phase === "contested" ? CONTEST.settleMargin : CONTEST.openMargin;
  // Sem ninguém apto a tocá-la, a bola não é de ninguém — nunca "de um dono" por falta de rival.
  const phase: BallPhase = favourite && margin >= settled ? "owned" : "contested";
  return { phase, contactPoint: point, contactIn: at, contenders, favourite, rival, margin };
};

/**
 * Refaz o quadro que os vinte e dois enxergam. **Único escritor de `state.ballSituation`**: todo o
 * resto do motor é leitor, inclusive a decisão individual, que antes remedia tudo por conta
 * própria — a mesma pergunta respondida três vezes por tick, de dentro de uma função de decisão.
 *
 * A cadência é do motor (`COGNITION.perceptionSeconds`), não da física. Quem monta um cenário na
 * mão precisa chamar isto antes de decidir, como o tick faz.
 */
export const perceive = (state: MatchState): void => {
  state.ballSituation = readBallSituation(state);
};

/** A bola de ninguém: o estado com que a partida nasce, antes do primeiro quadro medido. */
export const unclaimedBall = (position: Vec2): BallSituation => ({
  phase: "contested",
  contactPoint: { ...position },
  contactIn: 0,
  contenders: [],
  favourite: null,
  rival: null,
  margin: Number.POSITIVE_INFINITY,
});

/** Quanto a vontade de ir à bola adianta o jogador na fila da disputa, em segundos. */
const appetite = (player: PlayerRuntime): number =>
  (player.profile.mental.aggression + player.profile.mental.intensity + player.profile.mental.anticipation)
  / 300 * CONTEST.pressAppetite;

/**
 * Quem deste time vai à bola agora: os primeiros da fila, e só os que têm chance real — a mesma
 * folga que separa uma disputa de um lance resolvido. Quem está a três segundos dela não corre
 * atrás: sustenta a posição, que é onde ele serve.
 *
 * A fila é a corrida mais a vontade de cada um, e não a distância crua: entre dois igualmente
 * postados, quem sai é o mais agressivo. É a **mesma** função que o plano coletivo usa para
 * escolher o dever de pressão — o dever diz quem deveria sair, e isto, a cada quadro, quem pode.
 *
 * O goleiro fica de fora: ele vai à bola pela régua dele, e pô-lo na fila esvaziaria o gol.
 */
export const chasersFor = (state: MatchState, team: Team, slots: number): string[] => {
  const byId = new Map(state.players.map((player) => [player.profile.id, player]));
  const queue = state.ballSituation.contenders
    .flatMap((contender) => {
      const player = byId.get(contender.playerId);
      if (!player || player.team !== team || player.profile.position === "goalkeeper") return [];
      return [{ id: contender.playerId, eagerness: contender.eta - appetite(player) }];
    })
    .sort((first, second) => first.eagerness - second.eagerness || first.id.localeCompare(second.id));
  const best = queue[0];
  if (!best) return [];
  return queue
    .filter((entry) => entry.eagerness <= best.eagerness + CONTEST.openMargin)
    .slice(0, slots)
    .map((entry) => entry.id);
};
