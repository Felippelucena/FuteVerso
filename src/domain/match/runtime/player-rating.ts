import { clamp } from "../../shared/math";
import type { PlayerRuntime } from "../model";

/**
 * A nota do jogador nesta partida, de 4,0 a 10,0.
 *
 * Não existe nota "certa": ela é uma opinião sobre o que pesa num desempenho, e os números abaixo
 * são essa opinião, escrita num lugar só para poder ser discutida. O que NÃO é opinião é a escala
 * — 6,0 é a partida anônima, o elenco em torno de 6,5, e passar de 9 exige decidir o jogo — nem os
 * volumes contra os quais ela foi calibrada.
 *
 * Medido em três partidas inteiras (30 jogadores de linha, 3 goleiros), por jogador:
 *
 *   passes certos   mediana 13   p90 21   max 23
 *   desarmes        mediana  6   p90 12   max 17
 *   interceptações  mediana 24   p90 38   max 51
 *   defesas (GOL)   mediana 17   p90 35   max 35
 *   chutes no alvo  mediana  0   p90  5   max 11
 *   gols            mediana  0   p90  1   max  3
 *
 * Os pesos saem daí: o jogador mediano soma ~0,5 sobre a base e fica em 6,5; o de p90 chega a
 * ~7,5. Interceptação vale pouco por unidade porque o motor produz vinte e quatro delas por
 * jogador — nesta regra de jogo ela é rotina, não feito.
 *
 * **Nada de fatia do time.** A primeira versão media envolvimento como "share dos passes do time
 * vezes o número de jogadores", e aos noventa segundos de partida um jogador com dois dos cinco
 * passes já valia nota 10: com amostra pequena, fatia é ruído multiplicado. Contagem simples
 * cresce junto com a partida, que é o comportamento que se quer.
 */

const BASE = 6;

const WEIGHTS = {
  goal: 1.1,
  assist: 0.75,
  /** Finalização certa que não virou gol — o gol já paga o resto. */
  shotOnTarget: 0.12,
  /** Chance criada e não convertida: apareceu no lugar, não fez. */
  chance: 0.5,
  completedPass: 0.01,
  tackle: 0.03,
  interception: 0.008,
  save: 0.03,
  /** Aproveitamento de passe, em torno dos 75% que o motor entrega. */
  passing: 1.2,
} as const;

/** Abaixo disto o aproveitamento não diz nada: três passes certos não fazem uma partida. */
const MINIMUM_PASSES = 8;

export const playerRating = (player: PlayerRuntime): number => {
  const stats = player.match;
  const attempted = stats.completedPasses + stats.failedPasses;
  const accuracy = attempted > 0 ? stats.completedPasses / attempted : 0;
  const accuracyBonus = attempted >= MINIMUM_PASSES
    ? clamp(accuracy - 0.75, -0.3, 0.25) * WEIGHTS.passing
    : 0;

  const score = BASE
    + stats.goals * WEIGHTS.goal
    + stats.assists * WEIGHTS.assist
    + Math.max(0, stats.shotsOnTarget - stats.goals) * WEIGHTS.shotOnTarget
    + Math.max(0, stats.expectedGoals - stats.goals) * WEIGHTS.chance
    + stats.completedPasses * WEIGHTS.completedPass
    + stats.tacklesWon * WEIGHTS.tackle
    + stats.interceptions * WEIGHTS.interception
    + stats.saves * WEIGHTS.save
    + accuracyBonus;

  return clamp(Number(score.toFixed(1)), 4, 10);
};
