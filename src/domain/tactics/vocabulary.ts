// Vocabulário tático compartilhado entre o plano editável e o motor. Fica aqui, e não em
// domain/match/model.ts, porque o plano é quem define as opções; o motor as consome e
// reexporta para não mudar sua superfície pública.

export type AttackChannel = "left" | "center" | "right";
export type BuildUpStyle = "short" | "balanced" | "direct";
export type DefensiveBlock = "high" | "mid" | "low";
export type PressTrigger = "looseBall" | "counterPress" | "touchline" | "compact";

export const BUILD_UP_STYLES: readonly BuildUpStyle[] = ["short", "balanced", "direct"];
export const DEFENSIVE_BLOCKS: readonly DefensiveBlock[] = ["high", "mid", "low"];
export const PRESS_TRIGGERS: readonly PressTrigger[] = ["looseBall", "counterPress", "touchline", "compact"];
