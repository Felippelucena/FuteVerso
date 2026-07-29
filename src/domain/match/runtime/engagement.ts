import { DUEL, PHYSICS } from "../config";
import { add, clamp, distance, dot, length, normalize, scale, subtract } from "../../shared/math";
import type { MatchState, PlayerRuntime, Vec2 } from "../model";
import { isEvadedDefender } from "./control";
import { duelStrength } from "./duel";
import { playerSkillSpeed } from "./player-metrics";

// As forças de uma disputa (ver `Engagement` em model). Os desfechos que antes eram quatro
// funções — roubo limpo, cutucada, repelir — agora saem da geometria: se a bola escapou, o
// caminho normal de bola solta decide quem fica com ela.

/** Contribuição de um desafiante: o quanto ele atrapalha o portador, e por onde empurra a bola. */
interface Reach {
  /** Direção em que ele empurra a bola: para longe dele. Só o pé na bola empurra. */
  push: Vec2;
  /** 0 = longe demais para disputar, 1 = pé na bola. */
  reach: number;
  /** Entrada no corpo do portador, em velocidade: 0 = nenhuma, 1 = trombada cheia. */
  charge: number;
  /** Velocidade bruta (u/s) com que ele entra no corpo do portador. `charge` satura; esta não. */
  bodyClosing: number;
  /** Quanto ele afrouxa o domínio do portador. Só o pé na bola morde. */
  bite: number;
}

/**
 * Duas maneiras de atrapalhar quem tem a bola, e só uma delas desarma: **chegar nela com o pé**. A
 * trombada tira o portador de cima da bola — empurra o CORPO, e é por isso que ela existe —, mas
 * quem afrouxa o domínio e dá direção à saída é o pé.
 *
 * A trombada já mordeu o domínio, a 75% do que morde um pé na bola. Medido em três partidas, isso
 * punha 46% dos desarmes com NINGUÉM ao alcance da bola e mandava a sobra para lado nenhum: sem
 * `push`, a bola escapava sem que ninguém a tivesse mirado. A posição da bola não entrava na conta
 * de quem ficava com ela — que é o contrário do que "desarme" quer dizer.
 *
 * A proteção de bola entra aqui SEM termo próprio: esconder a bola do outro lado do corpo aumenta
 * a distância do marcador até ela, e é só isso que a conta precisa saber. Ter também um
 * multiplicador de "corpo na frente" contava o mesmo fato duas vezes e tornava o escudo
 * intransponível — e, pior, premiava duas vezes quem já estava protegido.
 */
const reachOf = (state: MatchState, holder: PlayerRuntime, challenger: PlayerRuntime): Reach => {
  const toBall = subtract(state.ball.position, challenger.position);
  const gap = length(toBall);
  const reach = clamp(1 - (gap - challenger.radius - state.ball.radius) / DUEL.reachFalloff, 0, 1);
  const toHolder = subtract(holder.position, challenger.position);
  const bodyGap = length(toHolder) - holder.radius - challenger.radius;
  const closingOnBody = bodyGap < DUEL.foulBodyGap && length(toHolder) > 0.001
    ? Math.max(0, dot(challenger.velocity, normalize(toHolder)))
    : 0;
  const charge = clamp(closingOnBody / DUEL.closingReference, 0, 1);
  return {
    push: gap > 0.001 ? scale(toBall, 1 / gap) : { x: 0, y: 0 },
    reach,
    charge,
    bodyClosing: closingOnBody,
    bite: duelStrength(challenger, "challenger") * reach,
  };
};

/**
 * Quem está de fato disputando esta bola agora. Todos entram — 2×1 sai de graça.
 *
 * Duas portas, uma por canal do contato, e as duas saem das constantes que já definem os canais: o
 * pé ao alcance da BOLA (`reachFalloff`, onde `reach` deixa de ser zero) ou o corpo em cima do
 * PORTADOR (`engageMargin`, onde a trombada alcança). Quem não tem nenhum dos dois não contribui
 * com nada, e estar na lista não muda nada — a força de cada um já é proporcional ao que ele
 * alcança.
 *
 * Perguntar só pelo corpo do portador punha a geometria contra si mesma: quem está ganhando a bola
 * segue a BOLA, que por definição se afasta do portador, e caía fora da disputa justamente por
 * estar vencendo. Medido, o duelo empacava num ciclo — a bola parava a 4,5 u do portador (o
 * controle só cai em 4,85) e o desafiante piscava dentro e fora para sempre.
 */
export const activeChallengers = (state: MatchState, holder: PlayerRuntime): PlayerRuntime[] =>
  state.players.filter((player) => player.team !== holder.team
    && player.reactionTimer <= 0
    && player.duelCooldown <= 0
    && !isEvadedDefender(state, player)
    && (distance(player.position, state.ball.position) < player.radius + state.ball.radius + DUEL.reachFalloff
      || distance(player.position, holder.position) < player.radius + holder.radius + DUEL.engageMargin));

/**
 * Lei 12 — entrada imprudente. A falta é chegar no CORPO e não na bola: velocidade alta contra o
 * portador, com o pé longe da bola. As duas medidas já existem na disputa (`reach` e a velocidade
 * de aproximação), então o árbitro não precisa de geometria própria — só de um limiar.
 *
 * Devolve o infrator, ou nulo quando ninguém passou do ponto. Jogador agressivo arrisca mais;
 * jogador que sabe defender erra menos.
 */
export const recklessChallenger = (
  state: MatchState,
  holder: PlayerRuntime,
  challengers: readonly PlayerRuntime[],
): PlayerRuntime | null => {
  for (const challenger of challengers) {
    const contact = reachOf(state, holder, challenger);
    // Quem chegou na bola não cometeu falta, por mais forte que tenha sido a entrada.
    if (contact.reach > DUEL.foulBallReach) continue;
    if (contact.bodyClosing < DUEL.foulClosingSpeed) continue;
    // A imprudência é do lance, não só do temperamento: chegar mais atrasado (longe da bola) e
    // mais rápido do que o mínimo pesa junto. Só com o temperamento, o critério virava um
    // precipício — faltava ou sobrava falta conforme quem estivesse escalado, não pelo que
    // aconteceu no lance.
    const temperament = (challenger.profile.mental.aggression - challenger.profile.skills.defending) / 100;
    const lateness = 1 - contact.reach / DUEL.foulBallReach;
    const overSpeed = clamp((contact.bodyClosing - DUEL.foulClosingSpeed) / DUEL.closingReference, 0, 1);
    const recklessness = temperament + lateness * DUEL.foulLatenessWeight + overSpeed * DUEL.foulSpeedWeight;
    if (recklessness > DUEL.foulRestraint) return challenger;
  }
  return null;
};

export interface ContestForces {
  /** Velocidade que a disputa imprime à bola, para fora do pé. */
  pressure: Vec2;
  /** Aceleração que as trombadas imprimem ao PORTADOR, empurrando-o para longe de quem entrou. */
  shove: Vec2;
  /** Quanto os desafiantes mordem o controle do portador (0 = ninguém perto). */
  bite: number;
}

/**
 * As duas forças do contato. A pressão arranca a bola; a mordida afrouxa a mão do portador —
 * que é o que um desarme faz de verdade: tira a bola e tira o domínio, ao mesmo tempo.
 */
export const contestForces = (state: MatchState, holder: PlayerRuntime, challengers: readonly PlayerRuntime[]): ContestForces => {
  let pressure: Vec2 = { x: 0, y: 0 };
  let shove: Vec2 = { x: 0, y: 0 };
  let bite = 0;
  for (const challenger of challengers) {
    const contribution = reachOf(state, holder, challenger);
    const strength = duelStrength(challenger, "challenger");
    bite += contribution.bite;
    // Trombada: enquanto o corpo dele estiver entrando, o portador é empurrado para longe. É uma
    // força que dura, não um tapa — quem atropela segue empurrando. Ela CRIA a chance, tirando o
    // portador de cima da bola; quem a converte em posse é o pé de alguém.
    if (contribution.charge > 0) {
      const away = normalize(subtract(holder.position, challenger.position));
      shove = add(shove, scale(away, DUEL.chargeShove * contribution.charge * strength));
    }
    if (contribution.reach <= 0) continue;
    // Chegar em velocidade sobre a bola vale mais que chegar andando.
    const closing = Math.max(0, dot(challenger.velocity, contribution.push) * -1);
    const speedBoost = 1 + clamp(closing / DUEL.closingReference, 0, 1) * DUEL.closingWeight;
    // Só o pé na bola a empurra numa direção — e é a mesma condição que a mordida exige. Por isso
    // toda bola arrancada sai com um autor: quem afrouxou o domínio é quem escolheu para onde.
    pressure = add(pressure, scale(contribution.push, DUEL.pressureRate * strength * contribution.reach * speedBoost));
  }
  return { pressure, shove, bite };
};

/**
 * Quanto o portador ainda segura a bola. A mola de controle é a mão dele: forte quando está
 * sozinho, frouxa quando tem gente mordendo. Sem isto o contato precisaria de velocidades
 * absurdas para vencer uma mola rígida, e a bola sairia voando em vez de ser arrancada.
 */
export const gripFactor = (holder: PlayerRuntime, bite: number): number => {
  const hold = duelStrength(holder, "holder") * carrySteadiness(holder);
  return clamp(hold / (hold + bite * DUEL.contestGripBite), DUEL.gripFloor, 1);
};

/**
 * O preço de conduzir em disparada. Correr com a bola custa DOMÍNIO, não velocidade: a bola vai
 * mais solta no pé de quem corre — e é a mesma mão frouxa que a deixa mais fácil de alcançar para
 * quem chega dividindo. Sem isto, o pique que sobrevive ao toque sairia de graça.
 */
const carrySteadiness = (holder: PlayerRuntime): number => {
  const pace = length(holder.velocity) / Math.max(1, playerSkillSpeed(holder));
  const overControl = clamp(
    (pace - PHYSICS.controlledSpeedFactor) / (PHYSICS.sprintCarrySpeedFactor - PHYSICS.controlledSpeedFactor),
    0,
    1,
  );
  return 1 - overControl * DUEL.carryPaceGripCost;
};
