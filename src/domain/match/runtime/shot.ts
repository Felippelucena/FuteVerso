import type { ActiveShot, CountableTeamStat, MatchState, ShotOutcome } from "../model";
import { BIG_CHANCE } from "./expected-goals";
import { recordDeed } from "./player-stats";

/**
 * O ciclo de vida do chute, num lugar só.
 *
 * Antes `state.activeShot = null` aparecia em nove pontos do motor, cada um com a sua ideia do
 * que fazer com a estatística — e `shotsOnTarget` era somado no instante do chute, a partir de uma
 * PREVISÃO da trajetória, e depois **subtraído** quando alguém interceptava a bola no caminho.
 * Corrigir número lançado é remendo: o chute passa a ser lançado quando termina, e aí não há o que
 * desfazer.
 */

/**
 * Cada desfecho soma exatamente um número, e é esta tabela que diz qual. Chute no alvo é o que
 * termina no gol ou nas mãos do goleiro — a definição do futebol, e a única que dispensa
 * previsão. O roçar do goleiro (`glance`) não encerra o chute: a bola segue viva e o desfecho
 * dela é que vale.
 *
 * `dead` fica de fora porque não é desfecho do chute, e sim da jogada em volta dele: o árbitro
 * parou, ou o ataque seguiu com outra bola. Somá-lo em qualquer coluna inventaria finalização
 * que ninguém deu.
 */
const OUTCOME_COUNTER = {
  goal: "shotsOnTarget",
  saved: "shotsOnTarget",
  woodwork: "shotsOnWoodwork",
  blocked: "shotsBlocked",
  off: "shotsOffTarget",
} as const satisfies Partial<Record<ShotOutcome, CountableTeamStat>>;

/**
 * Abre um chute. Um chute em curso quando outro nasce morreu ali — a invariante é que todo chute
 * resolve exatamente uma vez.
 */
export const beginShot = (state: MatchState, shot: Omit<ActiveShot, "id">): ActiveShot => {
  resolveShot(state, "dead");
  state.activeShot = { ...shot, id: ++state.shotCounter };
  return state.activeShot;
};

export const resolveShot = (state: MatchState, outcome: ShotOutcome): void => {
  const shot = state.activeShot;
  if (!shot) return;
  state.activeShot = null;
  // O registro guarda TODO chute, inclusive o que a jogada matou: ele foi dado, já somou em
  // `shots` e no xG, e sumir daqui faria o mapa discordar da tabela ao lado.
  state.shots.push({
    id: shot.id,
    team: shot.team,
    shooterId: shot.shooterId,
    at: state.elapsed,
    origin: shot.origin,
    expectedGoals: shot.expectedGoals,
    outcome,
  });
  const counter = OUTCOME_COUNTER[outcome as keyof typeof OUTCOME_COUNTER];
  if (!counter) return;
  state.stats[shot.team][counter] += 1;
  if (counter === "shotsOnTarget") {
    const shooter = state.players.find((player) => player.profile.id === shot.shooterId);
    if (shooter) recordDeed(shooter, "shotsOnTarget");
  }
  // Perdeu-se a grande chance: ela existia (contada na batida) e o lance terminou sem gol. O
  // `dead` já saiu acima — jogada que o árbitro parou não é chance desperdiçada por ninguém.
  if (outcome !== "goal" && shot.expectedGoals >= BIG_CHANCE) state.stats[shot.team].bigChancesMissed += 1;
};
