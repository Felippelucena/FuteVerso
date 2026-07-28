import { COGNITION } from "../config";
import { add, clamp, distance, distanceSquared, limit, scale, subtract } from "../../shared/math";
import type { MatchState, PlayerRuntime, Team, Vec2 } from "../model";
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

/**
 * Afastar um ponto de um conjunto de corpos — a conta de vizinhança do motor, em um lugar só.
 *
 * **SOMA, nunca escolhe o pior.** Um termo que pergunta "quem é o mais próximo?" troca de vencedor
 * sem aviso, e o alvo salta no quadro em que a resposta muda. Medido: o `argmax` que o apoio usava
 * respondia por 38% de todo o tremor do alvo (4,11 → 2,56 m/s ao removê-lo), e foi o que fez uma
 * tentativa de dar inteligência ao posicionamento sem bola piorar TODAS as métricas que ela existia
 * para melhorar. Uma soma de núcleos que morrem em `room` é contínua em todas as entradas — e
 * continuidade é o que permite acrescentar inteligência sem acrescentar tremor.
 *
 * Dois usos, a mesma conta: espaço pessoal entre companheiros (no plano, sobre o alvo já resolvido)
 * e fuga da cobertura adversária (no apoio, sobre o bolsão candidato).
 */
export const crowdShift = (
  point: Vec2,
  bodies: readonly PlayerRuntime[],
  room: number,
  cap: number,
  team: Team,
  skipId?: string,
): Vec2 => {
  const roomSquared = room * room;
  let shift: Vec2 = { x: 0, y: 0 };
  for (const body of bodies) {
    if (body.team !== team || body.profile.id === skipId) continue;
    const squared = distanceSquared(point, body.position);
    if (squared >= roomSquared || squared < 0.0001) continue;
    const gap = Math.sqrt(squared);
    shift = add(shift, scale(subtract(point, body.position), (room - gap) / gap));
  }
  return limit(shift, cap);
};

export const perceptionDepth = (player: PlayerRuntime, ballPosition: Vec2): number =>
  clamp((distance(player.position, ballPosition) - PERCEPTION.intervention) / (PERCEPTION.cooperation - PERCEPTION.intervention), 0, 1);
