import type { Club } from "../domain/club/model";
import { squadOf } from "../domain/contract/queries";
import { extractPlayerMemories, type MatchState } from "../domain/match";
import type { PlayerProfile } from "../domain/roster/model";
import { createMemory, isValidProfile } from "../domain/roster/rules";
import type { Team } from "../domain/shared/model";
import type { TeamTacticalPlan } from "../domain/tactics/model";
import { inspectPlan } from "../domain/tactics/rules";
import type { World } from "../domain/world/model";
import { repairWorld } from "../domain/world/rules";
import { buildMatchConfig, type MatchSetup } from "./match/build-match-config";
import { MatchSession } from "./match/match-session";
import type { WorldRepository } from "./ports/world-repository";

export type CommandError = "invalid-player" | "player-not-found" | "club-not-found" | "invalid-plan";
export type CommandResult = { ok: true } | { ok: false; reason: CommandError };

const clone = <T>(value: T): T => structuredClone(value);

/** Escolhe dois clubes distintos para a partida de abertura. */
const defaultSetup = (world: World): MatchSetup => {
  const [home, away] = world.clubs;
  if (!home || !away) throw new Error("O catálogo precisa de pelo menos dois clubes.");
  return {
    blue: { clubId: home.id, plan: clone(home.defaultPlan) },
    coral: { clubId: away.id, plan: clone(away.defaultPlan) },
  };
};

export class GameApplication {
  private currentWorld: World;
  private currentSetup: MatchSetup;
  readonly match: MatchSession;

  constructor(world: World, private readonly repository: WorldRepository) {
    this.currentWorld = world;
    this.currentSetup = defaultSetup(world);
    this.match = new MatchSession(buildMatchConfig(this.currentWorld, this.currentSetup));
  }

  get world(): World {
    return this.currentWorld;
  }

  get setup(): MatchSetup {
    return this.currentSetup;
  }

  get state(): MatchState {
    return this.match.state;
  }

  clubOf(team: Team): Club {
    return this.currentWorld.clubs.find(({ id }) => id === this.currentSetup[team].clubId)!;
  }

  squadOfClub(clubId: string): PlayerProfile[] {
    return squadOf(this.currentWorld.players, this.currentWorld.contracts, clubId);
  }

  persistMatchProgress(): void {
    // Sempre persiste a fronteira ao vivo, mesmo que a linha do tempo esteja rebobinada.
    const liveState = this.match.liveState;
    for (const memory of extractPlayerMemories(liveState)) {
      this.currentWorld.memories[memory.playerId] = clone(memory);
    }
    this.currentWorld.settings.learningEnabled = liveState.learningEnabled;
    // Autosave não bloqueia o loop de animação; falha de gravação não pode parar a partida.
    void this.repository.saveProgress(this.currentWorld).catch(() => undefined);
  }

  restartMatch(): void {
    this.persistMatchProgress();
    this.match.restart(buildMatchConfig(this.currentWorld, this.currentSetup));
  }

  /** Troca os clubes em campo. A partida só recebe o elenco novo ao reiniciar. */
  selectClubs(blueClubId: string, coralClubId: string): CommandResult {
    const blue = this.currentWorld.clubs.find(({ id }) => id === blueClubId);
    const coral = this.currentWorld.clubs.find(({ id }) => id === coralClubId);
    if (!blue || !coral) return { ok: false, reason: "club-not-found" };
    const setup: MatchSetup = {
      blue: { clubId: blue.id, plan: clone(blue.defaultPlan) },
      coral: { clubId: coral.id, plan: clone(coral.defaultPlan) },
    };
    if (this.planIssues(setup.blue.plan, blue.id) || this.planIssues(setup.coral.plan, coral.id)) {
      return { ok: false, reason: "invalid-plan" };
    }
    this.currentSetup = setup;
    this.match.restart(buildMatchConfig(this.currentWorld, this.currentSetup));
    return { ok: true };
  }

  setSeed(seed: number): number {
    if (!Number.isFinite(seed)) return this.currentWorld.settings.randomSeed;
    const normalized = Math.min(0xffff_ffff, Math.max(0, Math.trunc(seed)));
    this.persistMatchProgress();
    this.currentWorld.settings.randomSeed = normalized;
    void this.repository.saveProgress(this.currentWorld).catch(() => undefined);
    this.match.restart(buildMatchConfig(this.currentWorld, this.currentSetup));
    return normalized;
  }

  setLearningEnabled(enabled: boolean): void {
    this.match.setLearningEnabled(enabled);
    this.currentWorld.settings.learningEnabled = enabled;
    this.persistMatchProgress();
  }

  resetLearning(): void {
    this.currentWorld.memories = Object.fromEntries(
      this.currentWorld.players.map((player) => [player.id, createMemory(player)]),
    );
    void this.repository.save(this.currentWorld).catch(() => undefined);
    this.match.restart(buildMatchConfig(this.currentWorld, this.currentSetup));
  }

  upsertPlayer(player: PlayerProfile): CommandResult {
    if (!isValidProfile(player)) return { ok: false, reason: "invalid-player" };
    const nextPlayer = clone(player);
    const previous = this.currentWorld.players.find(({ id }) => id === nextPlayer.id);
    this.currentWorld.players = previous
      ? this.currentWorld.players.map((candidate) => candidate.id === nextPlayer.id ? nextPlayer : candidate)
      : [...this.currentWorld.players, nextPlayer];

    if (!this.currentWorld.memories[nextPlayer.id]) {
      this.currentWorld.memories[nextPlayer.id] = createMemory(nextPlayer);
    } else if (previous && (
      previous.role !== nextPlayer.role
      || JSON.stringify(previous.mental) !== JSON.stringify(nextPlayer.mental)
    )) {
      // Função ou personalidade mudaram: a política inicial é recalculada, mas a carreira
      // acumulada continua valendo.
      const previousMemory = this.currentWorld.memories[nextPlayer.id];
      const recalibrated = createMemory(nextPlayer);
      recalibrated.stats = { ...previousMemory.stats };
      recalibrated.version = previousMemory.version + 1;
      this.currentWorld.memories[nextPlayer.id] = recalibrated;
    }
    this.commitWorld();
    return { ok: true };
  }

  deletePlayer(playerId: string): CommandResult {
    if (!this.currentWorld.players.some(({ id }) => id === playerId)) {
      return { ok: false, reason: "player-not-found" };
    }
    this.currentWorld.players = this.currentWorld.players.filter(({ id }) => id !== playerId);
    this.currentWorld.contracts = this.currentWorld.contracts.filter((contract) => contract.playerId !== playerId);
    delete this.currentWorld.memories[playerId];
    // repairWorld recompõe as escalações que perderam o jogador — inclusive a dos clubes em
    // campo, que só entra em vigor no próximo reinício.
    this.commitWorld();
    return { ok: true };
  }

  private planIssues(plan: TeamTacticalPlan, clubId: string): boolean {
    return inspectPlan(plan, this.squadOfClub(clubId)).length > 0;
  }

  private commitWorld(): void {
    this.currentWorld = repairWorld(this.currentWorld);
    this.currentSetup = this.refreshedSetup();
    void this.repository.save(this.currentWorld).catch(() => undefined);
  }

  /** Após uma edição, recarrega os planos em campo a partir dos clubes já reparados. */
  private refreshedSetup(): MatchSetup {
    const rebuild = (team: Team) => {
      const club = this.currentWorld.clubs.find(({ id }) => id === this.currentSetup[team].clubId);
      return club ? { clubId: club.id, plan: clone(club.defaultPlan) } : this.currentSetup[team];
    };
    return { blue: rebuild("blue"), coral: rebuild("coral") };
  }
}
