import type { Vec2 } from "./model";

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

export const subtract = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

export const scale = (value: Vec2, factor: number): Vec2 => ({
  x: value.x * factor,
  y: value.y * factor,
});

export const length = (value: Vec2): number => Math.hypot(value.x, value.y);

export const distance = (a: Vec2, b: Vec2): number => length(subtract(a, b));

/** Distância ao quadrado: para comparar contra um raio sem pagar a raiz em laço quente. */
export const distanceSquared = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const normalize = (value: Vec2): Vec2 => {
  const magnitude = length(value);
  return magnitude > 0.0001 ? scale(value, 1 / magnitude) : { x: 0, y: 0 };
};

export const limit = (value: Vec2, maximum: number): Vec2 => {
  const magnitude = length(value);
  return magnitude > maximum ? scale(value, maximum / magnitude) : value;
};

export const lerp = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;

/** `lerp` de vetor: 0 devolve `a`, 1 devolve `b`. */
export const blend = (a: Vec2, b: Vec2, amount: number): Vec2 => ({
  x: a.x * (1 - amount) + b.x * amount,
  y: a.y * (1 - amount) + b.y * amount,
});

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

/** Ângulo com sinal de `from` para `to`, em (−π, π]. Positivo gira no mesmo sentido de `rotate`. */
export const signedAngle = (from: Vec2, to: Vec2): number => Math.atan2(cross(from, to), dot(from, to));

export const rotate = (value: Vec2, angle: number): Vec2 => ({
  x: value.x * Math.cos(angle) - value.y * Math.sin(angle),
  y: value.x * Math.sin(angle) + value.y * Math.cos(angle),
});

/**
 * Ponto do segmento `[start, end]` mais próximo de `point`, com a fração do caminho até ele.
 * `amount` interessa a quem precisa saber QUANDO o encontro acontece — a varredura do contato do
 * goleiro usa a fração para datar o toque dentro do quadro.
 */
export const closestPointOnSegment = (start: Vec2, end: Vec2, point: Vec2): { point: Vec2; amount: number } => {
  const segment = subtract(end, start);
  const squared = dot(segment, segment);
  const amount = squared < 0.0001 ? 1 : clamp(dot(subtract(point, start), segment) / squared, 0, 1);
  return { point: add(start, scale(segment, amount)), amount };
};

export const distanceToSegment = (point: Vec2, start: Vec2, end: Vec2): number =>
  distance(point, closestPointOnSegment(start, end, point).point);
