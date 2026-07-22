import type { SaveRepository } from "../../application/ports/save-repository";
import type { GameProfile } from "../../domain/roster/model";
import { migrateSaveDocument } from "./migrations";
import { decodeSaveDocument, toGameProfile, toSaveDocument } from "./save-schema";

export const STORAGE_KEY = "autoball.save";

export class LocalStorageSaveRepository implements SaveRepository {
  constructor(
    private readonly storage: Storage | null,
    private readonly createDefaultProfile: () => GameProfile,
  ) {}

  load(): GameProfile {
    if (!this.storage) return this.createDefaultProfile();
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return this.createDefaultProfile();
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && (parsed as { schemaVersion?: unknown }).schemaVersion === 1) {
        this.storage.removeItem(STORAGE_KEY);
        return this.createDefaultProfile();
      }
      const document = decodeSaveDocument(migrateSaveDocument(parsed));
      return document ? toGameProfile(document) : this.createDefaultProfile();
    } catch {
      return this.createDefaultProfile();
    }
  }

  save(profile: GameProfile): void {
    if (!this.storage) return;
    const document = toSaveDocument(profile);
    if (!decodeSaveDocument(document)) return;
    this.storage.setItem(STORAGE_KEY, JSON.stringify(document));
  }
}
