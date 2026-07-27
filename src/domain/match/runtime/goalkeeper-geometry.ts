import { FIELD, GOALKEEPING } from "../config";
import { add, clamp, length, normalize, scale, subtract } from "../../shared/math";
import type { PlayerRuntime, Vec2 } from "../model";
import { attackDirection, goalCenter } from "./formation-geometry";

/**
 * Onde o goleiro fica quando não está indo buscar a bola — a geometria pura da posição, separada
 * do sistema que decide sair. Vive aqui porque a bola parada também precisa dela: o goleiro que
 * não cobra o reinício não tem "desenho de reinício", tem posição de goleiro.
 *
 * A posição é a **bissetriz do ângulo bola–postes**, que na prática é o segmento da bola até o
 * centro do gol: de lá os dois cantos ficam à mesma distância. A profundidade é uma fração do
 * caminho até a bola — fecha o ângulo quando ela chega e devolve o corpo para trás quando ela se
 * afasta, sem nunca abrir as costas. Não existe termo lateral separado: a bissetriz já leva ao
 * poste próximo quando a bola abre. O ponto é preso na caixa de guarda (entre o piso de avanço e
 * a borda da área, entre os postes) para ele não terminar dentro do gol nem na linha de fundo.
 */
export const goalkeeperGuardPost = (goalkeeper: PlayerRuntime, ball: Vec2): Vec2 => {
  const goal = goalCenter(goalkeeper.team, true);
  const toBall = subtract(ball, goal);
  const range = length(toBall);
  const post = range < 0.001
    ? goal
    : add(goal, scale(normalize(toBall), range * GOALKEEPING.guardAdvanceFraction));
  const direction = attackDirection(goalkeeper.team);
  const advance = clamp(
    direction > 0 ? post.x : FIELD.width - post.x,
    GOALKEEPING.guardRestingDepth,
    FIELD.penaltyDepth - goalkeeper.radius,
  );
  return {
    x: direction > 0 ? advance : FIELD.width - advance,
    y: clamp(post.y, FIELD.goalTop, FIELD.goalBottom),
  };
};

/**
 * Onde o goleiro se coloca para distribuir a bola que está nas mãos. Mesma pergunta da posição de
 * guarda — onde ele fica —, e por isso mora aqui.
 *
 * Ele sai de perto da própria linha e leva a bola até a frente da pequena área. Com um adversário
 * dentro do alcance de ameaça, vai para o canto da pequena área **oposto** a ele: é o passo que
 * abre o ângulo de saída, e é geometria do campo, não uma distância inventada. Sem ameaça por
 * perto, apenas avança na própria faixa.
 */
export const goalkeeperReleasePost = (keeper: PlayerRuntime, opponents: readonly PlayerRuntime[]): Vec2 => {
  const direction = attackDirection(keeper.team);
  const advance = FIELD.goalAreaDepth;
  const top = (FIELD.height - FIELD.goalAreaWidth) / 2;
  const bottom = top + FIELD.goalAreaWidth;
  const nearest = opponents.reduce<PlayerRuntime | null>(
    (closest, opponent) => !closest || length(subtract(opponent.position, keeper.position)) < length(subtract(closest.position, keeper.position))
      ? opponent
      : closest,
    null,
  );
  const threatened = nearest !== null
    && length(subtract(nearest.position, keeper.position)) <= GOALKEEPING.looseClaimThreatRange;
  return {
    x: direction > 0 ? advance : FIELD.width - advance,
    y: threatened
      ? (nearest!.position.y > FIELD.height / 2 ? top : bottom)
      : clamp(keeper.position.y, top, bottom),
  };
};
