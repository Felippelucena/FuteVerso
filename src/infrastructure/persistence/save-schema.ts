import { DEFAULT_MATCH_SEED } from "../../domain/match/config";
import type { GameProfile } from "../../domain/roster/model";
import { createMemory, isValidProfile, validateLineups } from "../../domain/roster/rules";

export const CURRENT_SAVE_SCHEMA_VERSION = 2 as const;

export interface SaveDocumentV2 extends GameProfile {
  schemaVersion: 2;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isValidSaveDocument = (value: unknown): value is SaveDocumentV2 => {
  if (!value || typeof value !== "object") return false;
  const save = value as SaveDocumentV2;
  if (save.schemaVersion !== CURRENT_SAVE_SCHEMA_VERSION || !Array.isArray(save.players) || !save.players.every(isValidProfile)) return false;
  if (new Set(save.players.map((player) => player.id)).size !== save.players.length) return false;
  if (!save.lineups || !validateLineups(save.players, save.lineups)) return false;
  const seedIsValid = Number.isInteger(save.settings?.randomSeed)
    && save.settings.randomSeed >= 0
    && save.settings.randomSeed <= 0xffff_ffff;
  return !!save.memories && typeof save.memories === "object"
    && !!save.settings && typeof save.settings.learningEnabled === "boolean"
    && seedIsValid;
};

export const decodeSaveDocument = (value: unknown): SaveDocumentV2 | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = clone(value) as SaveDocumentV2;
  if (candidate.schemaVersion !== CURRENT_SAVE_SCHEMA_VERSION) return null;
  if (!candidate.settings || typeof candidate.settings !== "object") return null;
  if (!Number.isInteger(candidate.settings.randomSeed)) candidate.settings.randomSeed = DEFAULT_MATCH_SEED;
  if (!isValidSaveDocument(candidate)) return null;
  for (const player of candidate.players) {
    if (!candidate.memories[player.id]) candidate.memories[player.id] = createMemory(player);
  }
  return candidate;
};

export const toGameProfile = (document: SaveDocumentV2): GameProfile => {
  const { schemaVersion: _schemaVersion, ...profile } = clone(document);
  return profile;
};

export const toSaveDocument = (profile: GameProfile): SaveDocumentV2 => ({
  ...clone(profile),
  schemaVersion: CURRENT_SAVE_SCHEMA_VERSION,
});
