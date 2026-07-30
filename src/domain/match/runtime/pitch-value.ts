import { FIELD } from "../config";
import { clamp } from "../../shared/math";
import type { Team, Vec2 } from "../model";
import { attackDirection } from "./formation-geometry";
import { positionalGoalChance } from "./expected-goals";

/**
 * **Quanto vale ter a bola aqui**, em probabilidade de gol.
 *
 * Existe para o motor medir valor numa unidade só. A nota do passe era uma soma de oito termos à mão
 * — progresso, espaço, centralidade, inversão, dever, propósito — em que progresso mandava, e o piso
 * do progresso era negativo: um passe seguro de 20 m para trás entrava valendo **−0,75** e saía com
 * nota ~zero mesmo completando 97%, enquanto uma bola à frente de 45% de acerto saía com 0,27. O
 * motor estava *certo dentro da própria função-objetivo*; ela é que não pagava por manter a bola.
 *
 * Aqui recuar vale o que recuar vale: quase nada, e não um prejuízo. E o custo de perder a bola é a
 * **mesma superfície lida do outro lado** — que é o que `turnoverCost * (1 - attackingProgress)`
 * aproximava à mão.
 *
 * ## A conta
 *
 * É a equação de Bellman do lance: de um palmo de grama, o melhor que se pode fazer é chutar, ou
 * mover a bola para um palmo melhor e tentar de lá.
 *
 * ```
 * V(c) = max( xG_posicional(c),  max sobre c' de  p(dist) · V(c') )
 * ```
 *
 * `p` é a chance de a bola sobreviver a **uma** ação. Duas propriedades dela importam, e as duas têm
 * razão de futebol:
 *
 * - **cai mais rápido que exponencial** (é gaussiana), então dois toques curtos valem mais que um
 *   longo — que é o que o futebol paga e o que este motor não pagava;
 * - **tem um custo por ação** (`ACTION_SURVIVAL`), senão o ótimo seria uma cadeia infinita de toques
 *   infinitesimais de graça, e a superfície colapsaria em "xG em todo lugar".
 *
 * Dois números calibráveis no lugar de seis termos somados à mão. A tabela é resolvida **uma vez**,
 * no carregamento do módulo: determinística, sem RNG, e em jogo custa uma leitura com interpolação.
 */

/** Resolução da grade. Ímpar nos dois eixos para haver uma célula exatamente no meio do campo. */
const COLUMNS = 21;
const ROWS = 13;

/**
 * Alcance de uma ação, em metros: a distância em que ela ainda sobrevive com ~60% de chance
 * (`exp(-1)`). Larga o bastante para uma bola de 30 m ser uma opção real, curta o bastante para a de
 * 60 m ser aposta.
 */
const ACTION_REACH = 34;

/**
 * O que sobra da posse a cada ação, independente da distância — o desconto por toque.
 *
 * Duas funções: dá à superfície um tamanho de passo ótimo (sem ele, mover a bola em passos
 * infinitesimais seria grátis e a superfície colapsaria em "xG em todo lugar"), e encaixa o
 * gradiente na escala do futebol. Não é só "a bola não é interceptada": é a posse seguir viva E
 * progredindo, com o adversário também jogando. Uma posse de futebol dura três ou quatro ações, e é
 * essa a ordem de grandeza que este número expressa.
 *
 * Calibrado pela razão medida na superfície: com 0,86 o meio-campo valia um terço da pequena área;
 * o futebol paga cerca de um décimo.
 */
const ACTION_SURVIVAL = 0.6;

/** Passos de relaxação. O operador é uma contração (p < 1), então converge rápido. */
const ITERATIONS = 40;

/** Só vizinhas dentro deste raio (m) entram no máximo — além disso `p` já é desprezível. */
const NEIGHBOUR_RANGE = 60;

const cellCentre = (column: number, row: number): Vec2 => ({
  x: (column + 0.5) / COLUMNS * FIELD.width,
  y: (row + 0.5) / ROWS * FIELD.height,
});

/** Chance de a bola sobreviver a uma ação que a leva `metres` adiante. */
const actionSurvival = (metres: number): number => {
  const reach = metres / ACTION_REACH;
  return ACTION_SURVIVAL * Math.exp(-reach * reach);
};

/**
 * A tabela, resolvida para quem ataca o gol da DIREITA (x = FIELD.width). O outro lado é a mesma
 * tabela espelhada — um time não joga um futebol diferente por atacar para a esquerda.
 */
const solve = (): number[] => {
  const goalX = FIELD.width;
  const centres: Vec2[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) centres.push(cellCentre(column, row));
  }
  const shoot = centres.map((centre) => positionalGoalChance(centre, goalX));
  // Vizinhança e sobrevivência pré-computadas: o laço de relaxação roda 40 vezes por cima delas.
  const neighbours = centres.map((from, index) => {
    const reachable: { index: number; survival: number }[] = [];
    centres.forEach((to, other) => {
      if (other === index) return;
      const metres = Math.hypot(to.x - from.x, to.y - from.y) / FIELD.unitsPerMeter;
      if (metres > NEIGHBOUR_RANGE) return;
      reachable.push({ index: other, survival: actionSurvival(metres) });
    });
    return reachable;
  });

  let value = [...shoot];
  for (let pass = 0; pass < ITERATIONS; pass += 1) {
    const next = value.map((_, index) => {
      let best = shoot[index];
      for (const { index: other, survival } of neighbours[index]) {
        const moved = survival * value[other];
        if (moved > best) best = moved;
      }
      return best;
    });
    value = next;
  }
  return value;
};

const VALUE = solve();

/** Menor e maior valor da tabela — servem para normalizar diagnóstico, não a conta. */
export const PITCH_VALUE_RANGE = {
  lowest: Math.min(...VALUE),
  highest: Math.max(...VALUE),
} as const;

/**
 * Quanto vale, para `team`, ter a bola em `point` — probabilidade de esta posse virar gol no gol que
 * ele ataca. Interpola bilinearmente entre as células para ser **contínua**: uma superfície em
 * degraus faria a nota do passe saltar quando o alvo cruzasse uma borda de célula, e alvo que salta
 * é alvo que treme (ver `crowdShift`).
 */
export const pitchValue = (team: Team, point: Vec2): number => {
  // Espelha para o referencial de quem ataca a direita.
  const x = attackDirection(team) > 0 ? point.x : FIELD.width - point.x;
  const column = clamp(x / FIELD.width * COLUMNS - 0.5, 0, COLUMNS - 1);
  const row = clamp(point.y / FIELD.height * ROWS - 0.5, 0, ROWS - 1);
  const columnLow = Math.floor(column);
  const rowLow = Math.floor(row);
  const columnHigh = Math.min(columnLow + 1, COLUMNS - 1);
  const rowHigh = Math.min(rowLow + 1, ROWS - 1);
  const columnFraction = column - columnLow;
  const rowFraction = row - rowLow;
  const at = (c: number, r: number): number => VALUE[r * COLUMNS + c];
  const top = at(columnLow, rowLow) * (1 - columnFraction) + at(columnHigh, rowLow) * columnFraction;
  const bottom = at(columnLow, rowHigh) * (1 - columnFraction) + at(columnHigh, rowHigh) * columnFraction;
  return top * (1 - rowFraction) + bottom * rowFraction;
};
