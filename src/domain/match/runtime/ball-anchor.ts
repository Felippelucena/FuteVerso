import { SHIELD } from "../config";
import { clamp, distance, normalize, scale, signedAngle, subtract } from "../../shared/math";
import type { MatchState, PlayerRuntime } from "../model";

/**
 * Onde a bola fica no corpo do portador, como ângulo relativo ao rumo dele (0 = à frente).
 *
 * Antes a bola vivia cravada no nariz — `position + facing · raio` — e por isso não existia
 * proteção de bola nem drible de corpo: sem geometria variável, não há lance onde o corpo entre
 * entre a bola e o marcador. Aqui ela desliza para o lado oposto ao pressionador, tanto mais
 * quanto mais perto ele estiver, até o limite do que o portador ainda alcança com o pé.
 */
export const desiredBallAnchor = (state: MatchState, carrier: PlayerRuntime, shielding: boolean): number => {
  // Quem já decidiu passar ou chutar recompõe a bola à frente: não se bate numa bola escondida
  // atrás do próprio corpo. Proteger é o que se faz enquanto ainda se está olhando.
  if (!shielding) return 0;
  let nearest: PlayerRuntime | null = null;
  let nearestGap = Infinity;
  for (const opponent of state.players) {
    if (opponent.team === carrier.team) continue;
    const gap = distance(opponent.position, carrier.position);
    if (gap < nearestGap) {
      nearestGap = gap;
      nearest = opponent;
    }
  }
  if (!nearest) return 0;
  const bodyGap = carrier.radius + nearest.radius;
  const shieldStrength = clamp(1 - (nearestGap - bodyGap) / SHIELD.range, 0, 1);
  if (shieldStrength <= 0) return 0;
  const away = scale(normalize(subtract(nearest.position, carrier.position)), -1);
  return clamp(signedAngle(carrier.facing, away), -SHIELD.maxAnchor, SHIELD.maxAnchor) * shieldStrength;
};
