import { DUEL } from "../config";
import { add, clamp, distance, dot, length, normalize, scale, subtract } from "../../shared/math";
import type { MatchState, PlayerRuntime, Vec2 } from "../model";
import { isEvadedDefender } from "./control";
import { duelStrength } from "./duel";

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
  /** Quanto ele afrouxa o domínio do portador, pelo pé OU pelo corpo. */
  bite: number;
}

/**
 * Duas maneiras de atrapalhar quem tem a bola: chegar nela com o pé, ou chegar no corpo. A
 * primeira empurra a bola numa direção; a segunda só arrebenta o domínio — e é por isso que uma
 * trombada faz o portador perder a bola sem que ninguém a tenha tocado.
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
    bite: duelStrength(challenger, "challenger") * Math.max(reach, charge * DUEL.chargeBite),
  };
};

/** Quem está de fato disputando esta bola agora. Todos entram — 2×1 sai de graça. */
export const activeChallengers = (state: MatchState, holder: PlayerRuntime): PlayerRuntime[] =>
  state.players.filter((player) => player.team !== holder.team
    && player.reactionTimer <= 0
    && player.duelCooldown <= 0
    && !isEvadedDefender(state, player)
    && distance(player.position, holder.position) < holder.radius + player.radius + DUEL.engageMargin);

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
    // força que dura, não um tapa — quem atropela segue empurrando. E é o que separa o portador da
    // bola: ele sai de baixo dela e o domínio, já frouxo, não a acompanha.
    if (contribution.charge > 0) {
      const away = normalize(subtract(holder.position, challenger.position));
      shove = add(shove, scale(away, DUEL.chargeShove * contribution.charge * strength));
    }
    if (contribution.reach <= 0) continue;
    // Chegar em velocidade sobre a bola vale mais que chegar andando.
    const closing = Math.max(0, dot(challenger.velocity, contribution.push) * -1);
    const speedBoost = 1 + clamp(closing / DUEL.closingReference, 0, 1) * DUEL.closingWeight;
    // Só o pé na bola a empurra numa direção; a trombada já entrou na mordida acima.
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
  const hold = duelStrength(holder, "holder");
  return clamp(hold / (hold + bite * DUEL.contestGripBite), DUEL.gripFloor, 1);
};
