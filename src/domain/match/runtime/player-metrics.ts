import { PHYSICS } from "../config";
import { clamp, dot, length, subtract } from "../../shared/math";
import type { PlayerRuntime, Vec2 } from "../model";

export const playerSkillSpeed = (player: PlayerRuntime): number => 8.5 + player.profile.skills.sprintSpeed * 0.06;
export const playerSkillAcceleration = (player: PlayerRuntime): number => 22 + player.profile.skills.acceleration * 0.38;

/**
 * Quanto tempo este jogador leva até um ponto do gramado. É a régua de **toda** corrida do motor
 * — quem chega antes na bola, no passe, no espaço atrás da linha —, e estava reescrita em meia
 * dúzia de lugares com fórmulas que divergiam entre si.
 *
 * Conta o corpo em movimento, e não só a distância: quem já vem lançado para lá chega bem antes
 * de quem está parado, e quem corre para o outro lado ainda tem de frear e voltar. Sem isso o
 * driblador perdia a corrida pela própria bola adiantada para um zagueiro parado ao lado dela.
 */
export const etaToPoint = (player: PlayerRuntime, point: Vec2): number => {
  const delta = subtract(point, player.position);
  const gap = length(delta);
  if (gap < 0.001) return 0;
  const top = playerSkillSpeed(player)
    * (player.sprintTimer > 0 ? PHYSICS.burstSpeedFactor : PHYSICS.runSpeedFactor);
  const closing = clamp(dot(player.velocity, delta) / gap, -top, top);
  // Velocidade média do trecho: parte da que ele já tem naquela direção e termina no topo dele.
  // O piso impede que correr para o lado oposto vire um tempo praticamente infinito.
  return gap / Math.max((closing + top) / 2, top * 0.25);
};
