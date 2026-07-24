import { MATCH_HALVES } from "../config";
import type { MatchState, Team } from "../model";

/**
 * Regra 8 (pontapé de saída), a parte que é decisão e não geometria — a geometria de onde cada
 * um se posiciona vive em `formation-geometry`. Aqui ficam as duas restrições que sobrevivem ao
 * apito e valem enquanto `state.kickoff` existir:
 *
 * 1. **Bola parada na marca central.** Até o cobrador chutar, ninguém mais pode tocá-la — os
 *    adversários estão fora do círculo central e no próprio campo, e os companheiros esperam.
 * 2. **Toque duplo.** Depois de cobrada, o cobrador não pode tocá-la outra vez antes de outro
 *    jogador tocar. É esta que faz do primeiro toque obrigatoriamente um passe: sair driblando
 *    a própria saída é infração, não estilo.
 */

/** Quem cobra a saída do primeiro tempo. Nos seguintes, alterna. */
export const OPENING_KICKOFF_TEAM: Team = "blue";

export const opposingTeam = (team: Team): Team => (team === "blue" ? "coral" : "blue");

/** Regra 8: a saída do 2º tempo é do time que não cobrou a do 1º, e assim por diante. */
export const kickoffTeamOfHalf = (half: number): Team =>
  half % 2 === 1 ? OPENING_KICKOFF_TEAM : opposingTeam(OPENING_KICKOFF_TEAM);

/** Último tempo da partida: depois dele o apito é final, não intervalo. */
export const isFinalHalf = (half: number): boolean => half >= MATCH_HALVES;

/** Verdadeiro enquanto a bola está parada na marca central esperando o primeiro toque. */
export const awaitingKickoffTouch = (state: MatchState): boolean =>
  state.kickoff !== null && !state.kickoff.ballInPlay;

/** Verdadeiro quando este jogador é quem deve dar o primeiro toque da saída. */
export const isKickoffTaker = (state: MatchState, playerId: string): boolean =>
  awaitingKickoffTouch(state) && state.kickoff?.takerId === playerId;

/**
 * A Regra 8 proíbe este jogador de encostar na bola agora? Antes da cobrança, todo mundo menos
 * o cobrador; depois dela, só o cobrador.
 */
export const kickoffForbidsTouch = (state: MatchState, playerId: string): boolean => {
  const kickoff = state.kickoff;
  if (!kickoff) return false;
  return kickoff.ballInPlay ? playerId === kickoff.takerId : playerId !== kickoff.takerId;
};

/** O cobrador chutou: a bola entrou em jogo, mas ele segue impedido de tocá-la de novo. */
export const registerKickoffKick = (state: MatchState, playerId: string): void => {
  if (state.kickoff && !state.kickoff.ballInPlay && state.kickoff.takerId === playerId) {
    state.kickoff.ballInPlay = true;
  }
};

/**
 * A restrição do cobrador cai no instante em que outro jogador toca a bola. Ler o último toque
 * em vez de instrumentar cada ponto de contato mantém a regra num lugar só: qualquer caminho que
 * encoste na bola (controle, colisão, defesa do goleiro) já registra quem tocou.
 */
export const updateKickoffRestriction = (state: MatchState): void => {
  const kickoff = state.kickoff;
  if (!kickoff || !kickoff.ballInPlay) return;
  const lastTouch = state.ball.lastTouchPlayerId;
  if (lastTouch !== null && lastTouch !== kickoff.takerId) state.kickoff = null;
};
