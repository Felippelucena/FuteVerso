import { FIELD } from "../config";
import { clamp, distance } from "../../shared/math";
import type { MatchState, PlayerRuntime, ShotTechnique, Vec2 } from "../model";
import { pressureAt } from "./control";
import { GOAL_MOUTH } from "./goal-frame";
import { estimateBallTravelTime, interceptionThreat } from "./prediction";

/**
 * **Quanto valia a chance** — a probabilidade de aquele chute virar gol, medida só pelo lance.
 *
 * Não confundir com `evaluateShotOpportunity().utility`, que é a nota da DECISÃO: aquela soma
 * inclui a ousadia aprendida do jogador, a política dele e o contexto tático, porque serve para
 * escolher entre chutar e passar. Usá-la como xG faria o número refletir a personalidade do
 * elenco em vez da qualidade da chance — dois times com as mesmas chances teriam xG diferentes
 * por serem feitos de gente diferente.
 *
 * Aqui não entra nada do atirador além de onde ele bateu e como. É o que torna o número
 * comparável entre times, entre partidas e entre formatos.
 *
 * O ângulo é o de verdade (o que os postes abrem a partir do ponto da batida), e não o proxy
 * normalizado que `shot-opportunity` usa na soma de utilidade — aquele é um termo calibrado à mão
 * dentro de outra conta, e igualar os dois mexeria em como o motor JOGA para arrumar como ele
 * MEDE. Quando a camada de decisão for reescrita, os dois viram um.
 */

/** Acima disto o lance era para ser gol: é a "grande chance" das estatísticas de transmissão. */
export const BIG_CHANCE = 0.3;

/**
 * Pesos da regressão logística. Distância em metros e ângulo em radianos, para os números serem
 * lidos por quem entende de futebol e não da escala interna do gramado.
 */
const MODEL = {
  /**
   * Ajustado à conversão REAL do motor, não à do futebol de verdade: a bateria de calibragem
   * (CALIBRATE=1) mede xG somado contra gols saídos, e o intercepto é o que faz os dois baterem.
   * Com -0,35 o modelo previa um terço dos gols; +1,13 (= ln 3,1) fechou a conta.
   */
  intercept: 0.78,
  /** Por radiano de boca de gol visível. */
  angle: 1.1,
  /** Por logaritmo do metro: o primeiro metro longe do gol custa muito mais que o vigésimo. */
  logDistance: -0.95,
  pressure: -0.9,
  /** Corpo na rota, somado por adversário — a mesma conta que mede ameaça de interceptação. */
  obstruction: -0.7,
} as const;

/** O que cada contato tira da chance. Bola no pé, parada e olhando o gol, é a referência. */
const TECHNIQUE_PENALTY: Record<ShotTechnique, number> = {
  placed: 0,
  power: 0,
  redirect: -0.3,
  volley: -0.35,
  header: -0.55,
};

const logistic = (value: number): number => 1 / (1 + Math.exp(-value));

/**
 * Ângulo que a boca do gol abre a partir do ponto da batida. Medido sobre a distância ABSOLUTA
 * até a linha, então vale igual para os dois lados sem um `if` por time.
 */
const openGoalAngle = (origin: Vec2, goalX: number): number => {
  const depth = Math.abs(goalX - origin.x);
  const toTop = Math.atan2(GOAL_MOUTH.top - origin.y, depth);
  const toBottom = Math.atan2(GOAL_MOUTH.bottom - origin.y, depth);
  return Math.abs(toBottom - toTop);
};

export interface ChanceGeometry {
  /** Distância até o meio do gol, em metros. */
  readonly metres: number;
  readonly angle: number;
  readonly pressure: number;
  readonly obstruction: number;
}

export const chanceGeometry = (state: MatchState, shooter: PlayerRuntime, origin: Vec2): ChanceGeometry => {
  const goalX = shooter.team === "blue" ? FIELD.width : 0;
  const mouth = { x: goalX, y: FIELD.height / 2 };
  const gap = distance(origin, mouth);
  const defenders = state.players.filter((player) =>
    player.team !== shooter.team && player.profile.position !== "goalkeeper");
  return {
    // Um metro é o piso: bola em cima da linha daria logaritmo negativo e um xG maior que a certeza.
    metres: Math.max(1, gap / FIELD.unitsPerMeter),
    angle: openGoalAngle(origin, goalX),
    pressure: pressureAt(state, shooter),
    obstruction: interceptionThreat(origin, mouth, defenders, estimateBallTravelTime(gap)),
  };
};

/**
 * A probabilidade de gol do lance, entre 0 e 1. Pura: não sorteia nada e não escreve no estado, e
 * por isso pode ser chamada tanto na execução do chute quanto por uma ferramenta de calibragem.
 */
export const expectedGoals = (
  state: MatchState,
  shooter: PlayerRuntime,
  origin: Vec2,
  technique: ShotTechnique,
): number => {
  const { metres, angle, pressure, obstruction } = chanceGeometry(state, shooter, origin);
  const score = MODEL.intercept
    + MODEL.angle * angle
    + MODEL.logDistance * Math.log(metres)
    + MODEL.pressure * pressure
    + MODEL.obstruction * obstruction
    + TECHNIQUE_PENALTY[technique];
  return clamp(logistic(score), 0.001, 0.99);
};
