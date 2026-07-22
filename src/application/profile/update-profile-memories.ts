import type { GameProfile, PlayerMemory } from "../../domain/roster/model";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const updateProfileMemories = (profile: GameProfile, memories: PlayerMemory[]): GameProfile => {
  const next = clone(profile);
  next.memories = {
    ...next.memories,
    ...Object.fromEntries(memories.map((memory) => [memory.playerId, clone(memory)])),
  };
  return next;
};
