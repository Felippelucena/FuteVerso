import { COGNITION } from "../config";
import { clamp, distance } from "../../shared/math";
import type { MatchState, PlayerRuntime, Vec2 } from "../model";
import { fieldX } from "../runtime/pitch";

/**
 * O que toda decisão individual usa antes de decidir qualquer coisa: quanto o jogador enxerga do
 * quadro, quanto ele erra, e as duas contas de mistura e de vizinhança que aparecem em todas as
 * trilhas. Fica separado porque é o único pedaço compartilhado pelas cinco — pôr no despachante
 * faria as trilhas dependerem de quem as chama.
 */

const PERCEPTION = {
  intervention: fieldX(12),
  support: fieldX(28),
  cooperation: fieldX(47),
} as const;

/**
 * Custo de jogar fora de posição, em cima do encaixe (`positionFit`) que o plano tático
 * calculou. Encaixe 1 (posição natural) não cobra nada; o pior improviso possível hoje é 0,55.
 *
 * A referência é a "familiaridade" do FC IQ, que pesa de 10% a 40% do resultado conforme o
 * contexto: aqui o improviso encarece o erro de decisão em até ~27% e alarga o intervalo de
 * pensamento em até ~14%. Não mexe nas habilidades — um zagueiro improvisado de lateral não
 * fica mais lento, ele lê o jogo pior naquela função.
 */
export const outOfPositionCost = (player: PlayerRuntime): number => clamp(1 - player.positionFit, 0, 1);

export const decisionNoise = (player: PlayerRuntime, state: MatchState, salt: number): number => {
  let hash = (state.randomSeed ^ Math.imul(Math.floor(state.elapsed / COGNITION.teamTickSeconds) + salt, 2654435761)) >>> 0;
  for (let index = 0; index < player.profile.id.length; index += 1) hash = Math.imul(hash ^ player.profile.id.charCodeAt(index), 16777619) >>> 0;
  const normalized = hash / 0xffff_ffff * 2 - 1;
  return normalized * (1 - player.profile.mental.decisionMaking / 100) * 0.34
    * (1 + outOfPositionCost(player) * 0.6);
};

export const nearestPlayer = (origin: Vec2, players: PlayerRuntime[]): PlayerRuntime | null =>
  [...players].sort((a, b) => distance(origin, a.position) - distance(origin, b.position))[0] ?? null;

export const perceptionDepth = (player: PlayerRuntime, ballPosition: Vec2): number =>
  clamp((distance(player.position, ballPosition) - PERCEPTION.intervention) / (PERCEPTION.cooperation - PERCEPTION.intervention), 0, 1);
