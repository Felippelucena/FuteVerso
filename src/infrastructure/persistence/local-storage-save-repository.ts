import type { SaveRepository } from "../../application/ports/save-repository";
import type { GameProfile } from "../../domain/roster/model";
import { migrateSaveDocument } from "./migrations";
import { decodeSaveDocument, toGameProfile, toSaveDocument } from "./save-schema";

export const STORAGE_KEY = "futeverso.save";

// Chaves de versões anteriores do jogo, lidas apenas para migrar o save existente.
export const LEGACY_STORAGE_KEYS = ["autoball.save"] as const;

export class LocalStorageSaveRepository implements SaveRepository {
  constructor(
    private readonly storage: Storage | null,
    private readonly createDefaultProfile: () => GameProfile,
  ) {}

  load(): GameProfile {
    if (!this.storage) return this.createDefaultProfile();
    try {
      const key = this.resolveKey(this.storage);
      if (!key) return this.createDefaultProfile();
      const raw = this.storage.getItem(key);
      if (!raw) return this.createDefaultProfile();
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && (parsed as { schemaVersion?: unknown }).schemaVersion === 1) {
        this.storage.removeItem(key);
        return this.createDefaultProfile();
      }
      const document = decodeSaveDocument(migrateSaveDocument(parsed));
      if (!document) return this.createDefaultProfile();
      if (key !== STORAGE_KEY) {
        this.storage.setItem(STORAGE_KEY, raw);
        this.storage.removeItem(key);
      }
      return toGameProfile(document);
    } catch {
      return this.createDefaultProfile();
    }
  }

  private resolveKey(storage: Storage): string | null {
    if (storage.getItem(STORAGE_KEY) !== null) return STORAGE_KEY;
    return LEGACY_STORAGE_KEYS.find((key) => storage.getItem(key) !== null) ?? null;
  }

  save(profile: GameProfile): void {
    if (!this.storage) return;
    const document = toSaveDocument(profile);
    if (!decodeSaveDocument(document)) return;
    this.storage.setItem(STORAGE_KEY, JSON.stringify(document));
  }
}
