import type { GameProfile } from "../../domain/roster/model";

export interface SaveRepository {
  load(): GameProfile;
  save(profile: GameProfile): void;
}
