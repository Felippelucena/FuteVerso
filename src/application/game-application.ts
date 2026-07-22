import { extractPlayerMemories, type MatchState } from "../domain/match";
import type { GameProfile, PlayerProfile } from "../domain/roster/model";
import { createMemory, isValidProfile, validateLineups } from "../domain/roster/rules";
import type { Team } from "../domain/shared/model";
import { buildMatchConfig } from "./match/build-match-config";
import { MatchSession } from "./match/match-session";
import type { SaveRepository } from "./ports/save-repository";
import { updateProfileMemories } from "./profile/update-profile-memories";

export type LineupSlot = "goalkeeper" | 0 | 1 | 2;
export type ProfileCommandError = "invalid-lineup" | "invalid-player" | "player-in-lineup" | "player-not-found";
export type ProfileCommandResult = { ok: true } | { ok: false; reason: ProfileCommandError };

const clone = <T>(value: T): T => structuredClone(value);

export class GameApplication {
  private currentProfile: GameProfile;
  readonly match: MatchSession;

  constructor(private readonly repository: SaveRepository) {
    this.currentProfile = repository.load();
    this.match = new MatchSession(buildMatchConfig(this.currentProfile));
  }

  get profile(): GameProfile {
    return this.currentProfile;
  }

  get state(): MatchState {
    return this.match.state;
  }

  persistMatchProgress(): void {
    // Sempre persiste a fronteira ao vivo, mesmo que a linha do tempo esteja rebobinada.
    const liveState = this.match.liveState;
    this.currentProfile = updateProfileMemories(this.currentProfile, extractPlayerMemories(liveState));
    this.currentProfile.settings.learningEnabled = liveState.learningEnabled;
    this.repository.save(this.currentProfile);
  }

  restartMatch(): void {
    this.persistMatchProgress();
    this.match.restart(buildMatchConfig(this.currentProfile));
  }

  setSeed(seed: number): number {
    if (!Number.isFinite(seed)) return this.currentProfile.settings.randomSeed;
    const normalized = Math.min(0xffff_ffff, Math.max(0, Math.trunc(seed)));
    this.persistMatchProgress();
    this.currentProfile.settings.randomSeed = normalized;
    this.repository.save(this.currentProfile);
    this.match.restart(buildMatchConfig(this.currentProfile));
    return normalized;
  }

  setLearningEnabled(enabled: boolean): void {
    this.match.setLearningEnabled(enabled);
    this.currentProfile.settings.learningEnabled = enabled;
    this.persistMatchProgress();
  }

  resetLearning(): void {
    this.currentProfile.memories = Object.fromEntries(
      this.currentProfile.players.map((player) => [player.id, createMemory(player)]),
    );
    this.repository.save(this.currentProfile);
    this.match.restart(buildMatchConfig(this.currentProfile));
  }

  changeLineup(team: Team, slot: LineupSlot, playerId: string): ProfileCommandResult {
    const nextLineups = clone(this.currentProfile.lineups);
    const replacedId = slot === "goalkeeper"
      ? nextLineups[team].goalkeeperId
      : nextLineups[team].fieldPlayerIds[slot];

    for (const otherTeam of ["blue", "coral"] as const) {
      if (nextLineups[otherTeam].goalkeeperId === playerId) nextLineups[otherTeam].goalkeeperId = replacedId;
      const otherIndex = nextLineups[otherTeam].fieldPlayerIds.indexOf(playerId);
      if (otherIndex >= 0) nextLineups[otherTeam].fieldPlayerIds[otherIndex] = replacedId;
    }
    if (slot === "goalkeeper") nextLineups[team].goalkeeperId = playerId;
    else nextLineups[team].fieldPlayerIds[slot] = playerId;

    if (!validateLineups(this.currentProfile.players, nextLineups)) return { ok: false, reason: "invalid-lineup" };
    this.currentProfile.lineups = nextLineups;
    this.repository.save(this.currentProfile);
    return { ok: true };
  }

  upsertPlayer(player: PlayerProfile): ProfileCommandResult {
    if (!isValidProfile(player)) return { ok: false, reason: "invalid-player" };
    const nextPlayer = clone(player);
    const previousPlayer = this.currentProfile.players.find(({ id }) => id === nextPlayer.id);
    const nextPlayers = previousPlayer
      ? this.currentProfile.players.map((candidate) => candidate.id === nextPlayer.id ? nextPlayer : candidate)
      : [...this.currentProfile.players, nextPlayer];
    if (!validateLineups(nextPlayers, this.currentProfile.lineups)) return { ok: false, reason: "invalid-lineup" };

    this.currentProfile.players = nextPlayers;
    if (!this.currentProfile.memories[nextPlayer.id]) {
      this.currentProfile.memories[nextPlayer.id] = createMemory(nextPlayer);
    } else if (previousPlayer && (
      previousPlayer.role !== nextPlayer.role
      || JSON.stringify(previousPlayer.mental) !== JSON.stringify(nextPlayer.mental)
    )) {
      const previousMemory = this.currentProfile.memories[nextPlayer.id];
      const recalibrated = createMemory(nextPlayer);
      recalibrated.stats = { ...previousMemory.stats };
      recalibrated.version = previousMemory.version + 1;
      this.currentProfile.memories[nextPlayer.id] = recalibrated;
    }
    this.repository.save(this.currentProfile);
    return { ok: true };
  }

  deletePlayer(playerId: string): ProfileCommandResult {
    const playerExists = this.currentProfile.players.some(({ id }) => id === playerId);
    if (!playerExists) return { ok: false, reason: "player-not-found" };
    if (this.usedPlayerIds().includes(playerId)) return { ok: false, reason: "player-in-lineup" };
    this.currentProfile.players = this.currentProfile.players.filter(({ id }) => id !== playerId);
    delete this.currentProfile.memories[playerId];
    this.repository.save(this.currentProfile);
    return { ok: true };
  }

  private usedPlayerIds(): string[] {
    return (["blue", "coral"] as const).flatMap((team) => [
      this.currentProfile.lineups[team].goalkeeperId,
      ...this.currentProfile.lineups[team].fieldPlayerIds,
    ]);
  }
}
