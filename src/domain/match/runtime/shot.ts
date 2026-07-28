import type { ActiveShot, MatchState } from "../model";

/**
 * O ciclo de vida do chute, num lugar só.
 *
 * Antes `state.activeShot = null` aparecia em nove pontos do motor, cada um com a sua ideia do
 * que fazer com a estatística — e `shotsOnTarget` era somado no instante do chute, a partir de uma
 * PREVISÃO da trajetória, e depois **subtraído** quando alguém interceptava a bola no caminho.
 * Corrigir número lançado é remendo: o chute passa a ser lançado quando termina, e aí não há o que
 * desfazer.
 */

/** Como um chute acaba. É a pergunta que decide a estatística. */
export type ShotOutcome =
  /** Entrou. */
  | "goal"
  /** O goleiro resolveu: pegou, espalmou ou socou. */
  | "saved"
  /** Bateu na madeira. */
  | "woodwork"
  /** Alguém que não o goleiro alcançou a bola antes da meta. */
  | "blocked"
  /** Morreu sem ninguém tocá-la: passou por fora, por cima, ou parou no gramado. */
  | "off"
  /** A jogada acabou por outro motivo — o árbitro parou, ou o ataque seguiu com outra bola. */
  | "dead";

/**
 * Chute no alvo é o que termina no gol ou nas mãos do goleiro. É a definição do futebol, e a
 * única que dispensa previsão: bola na trave e bola bloqueada por um defensor não contam, como
 * nas estatísticas de verdade. O roçar do goleiro (`glance`) não encerra o chute — a bola segue
 * viva e o desfecho dela é que vale.
 */
const COUNTS_ON_TARGET: ReadonlySet<ShotOutcome> = new Set<ShotOutcome>(["goal", "saved"]);

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
  if (COUNTS_ON_TARGET.has(outcome)) state.stats[shot.team].shotsOnTarget += 1;
};
