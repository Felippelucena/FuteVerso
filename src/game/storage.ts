import type { AutoballSave, PlayerMemory, Team } from "./model";
import { DEFAULT_MATCH_SEED } from "./config";
import { createDefaultSave, createMemory, isValidProfile, validateLineups } from "./roster";

const STORAGE_KEY = "autoball.save";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isValidSave = (value: unknown): value is AutoballSave => {
  if (!value || typeof value !== "object") return false;
  const save = value as AutoballSave;
  if (save.schemaVersion !== 1 || !Array.isArray(save.players) || !save.players.every(isValidProfile)) return false;
  if (new Set(save.players.map((player) => player.id)).size !== save.players.length) return false;
  if (!save.lineups || !validateLineups(save.players, save.lineups)) return false;
  const seedIsValid = save.settings?.randomSeed === undefined
    || (Number.isInteger(save.settings.randomSeed) && save.settings.randomSeed >= 0 && save.settings.randomSeed <= 0xffff_ffff);
  return !!save.memories && typeof save.memories === "object"
    && !!save.settings && typeof save.settings.learningEnabled === "boolean"
    && seedIsValid;
};

export class PlayerRepository {
  constructor(private readonly storage: Storage | null = typeof window === "undefined" ? null : window.localStorage) {}

  load(): AutoballSave {
    if (!this.storage) return createDefaultSave();
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultSave();
      const parsed: unknown = JSON.parse(raw);
      if (!isValidSave(parsed)) return createDefaultSave();
      const save = clone(parsed);
      if (!Number.isInteger(save.settings.randomSeed)) save.settings.randomSeed = DEFAULT_MATCH_SEED;
      for (const player of save.players) {
        if (!save.memories[player.id]) save.memories[player.id] = createMemory(player);
      }
      return save;
    } catch {
      return createDefaultSave();
    }
  }

  save(save: AutoballSave): void {
    if (!this.storage || !isValidSave(save)) return;
    this.storage.setItem(STORAGE_KEY, JSON.stringify(save));
  }
}

export const updateSaveMemories = (save: AutoballSave, memories: PlayerMemory[]): AutoballSave => {
  const next = clone(save);
  next.memories = {
    ...next.memories,
    ...Object.fromEntries(memories.map((memory) => [memory.playerId, clone(memory)])),
  };
  return next;
};

export const lineupIds = (save: AutoballSave, team: Team): string[] => {
  const lineup = save.lineups[team];
  return [lineup.goalkeeperId, ...lineup.fieldPlayerIds];
};
