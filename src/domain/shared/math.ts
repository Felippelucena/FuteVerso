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

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export const rotate = (value: Vec2, angle: number): Vec2 => ({
  x: value.x * Math.cos(angle) - value.y * Math.sin(angle),
  y: value.x * Math.sin(angle) + value.y * Math.cos(angle),
});
