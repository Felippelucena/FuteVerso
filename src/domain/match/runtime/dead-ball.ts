import type { MatchState } from "../model";

/**
 * A bola está morta? Verdadeiro durante um impedimento apitado (a "bandeira") e durante a fase de
 * bola parada até a cobrança (bola parada no ponto, cobrador caminhando). Depois de cobrada a bola
 * volta a rolar — viva — e deixa de contar para os acréscimos.
 *
 * É o único ponto de verdade que a bola parada e os acréscimos compartilham: quem quiser saber se
 * o jogo está parado pergunta aqui, e não remexe nos campos de estado diretamente.
 */
export const isBallDead = (state: MatchState): boolean =>
  state.offsideCall !== null || (state.restart !== null && !state.restart.ballInPlay);
