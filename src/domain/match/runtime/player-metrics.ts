import type { PlayerRuntime } from "../model";

export const playerSkillSpeed = (player: PlayerRuntime): number => 8.5 + player.profile.skills.sprintSpeed * 0.06;
export const playerSkillAcceleration = (player: PlayerRuntime): number => 22 + player.profile.skills.acceleration * 0.38;
