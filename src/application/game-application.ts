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

export type CommandError =
  | "invalid-player"
  | "player-not-found"
  | "club-not-found"
  | "invalid-plan"
  /** Um clube não tem elenco para os dois lados; a regra é do comando, não da tela. */
  | "same-club";
export type CommandResult = { ok: true } | { ok: false; reason: CommandError };

const clone = <T>(value: T): T => structuredClone(value);

export class GameApplication {
  private currentWorld: World;
  private currentSetup: MatchSetup | null = null;
  private currentMatch: MatchSession | null = null;

  constructor(world: World, private readonly repository: WorldRepository) {
    this.currentWorld = world;
  }

  get world(): World {
    return this.currentWorld;
  }

  /**
   * A partida só existe dentro do fluxo de jogo — num ambiente de edição o catálogo pode nem
   * ter dois clubes. Fora dela, `null` é o estado normal, não um defeito.
   */
  get match(): MatchSession | null {
    return this.currentMatch;
  }

  get setup(): MatchSetup | null {
    return this.currentSetup;
  }

  /** Para as telas que só existem dentro de uma partida; o navegador garante a precondição. */
  requireMatch(): MatchSession {
    if (!this.currentMatch) throw new Error("Nenhuma partida em andamento.");
    return this.currentMatch;
  }

  get state(): MatchState {
    return this.requireMatch().state;
  }

  /** Dois primeiros clubes do catálogo: o palpite que abre o fluxo de Jogo Rápido. */
  suggestedSetup(): MatchSetup | null {
    const [home, away] = this.currentWorld.clubs;
    if (!home || !away) return null;
    return {
      blue: { clubId: home.id, plan: clone(home.defaultPlan) },
      coral: { clubId: away.id, plan: clone(away.defaultPlan) },
    };
  }

  /** Põe uma partida em campo, criando a sessão ou reaproveitando a que existe. */
  startMatch(setup: MatchSetup): CommandResult {
    const blue = this.currentWorld.clubs.find(({ id }) => id === setup.blue.clubId);
    const coral = this.currentWorld.clubs.find(({ id }) => id === setup.coral.clubId);
    if (!blue || !coral) return { ok: false, reason: "club-not-found" };
    if (blue.id === coral.id) return { ok: false, reason: "same-club" };
    if (this.planIssues(setup.blue.plan, blue.id) || this.planIssues(setup.coral.plan, coral.id)) {
      return { ok: false, reason: "invalid-plan" };
    }
    this.currentSetup = setup;
    const config = buildMatchConfig(this.currentWorld, setup);
    if (this.currentMatch) this.currentMatch.restart(config);
    else this.currentMatch = new MatchSession(config);
    return { ok: true };
  }

  /** Sair da partida a congela: ela segue viva e retomável enquanto a aba existir. */
  leaveMatch(): void {
    if (!this.currentMatch) return;
    this.currentMatch.setPaused(true);
    this.persistMatchProgress();
  }

  /** Descarta a partida de vez. O progresso ainda é gravado antes de sumir. */
  endMatch(): void {
    if (!this.currentMatch) return;
    this.persistMatchProgress();
    this.currentMatch = null;
    this.currentSetup = null;
  }

  clubOf(team: Team): Club | null {
    const clubId = this.currentSetup?.[team].clubId;
    return this.currentWorld.clubs.find(({ id }) => id === clubId) ?? null;
  }

  squadOfClub(clubId: string): PlayerProfile[] {
    return squadOf(this.currentWorld.players, this.currentWorld.contracts, clubId);
  }

  persistMatchProgress(): void {
    if (!this.currentMatch) return;
    // Sempre persiste a fronteira ao vivo, mesmo que a linha do tempo esteja rebobinada.
    const liveState = this.currentMatch.liveState;
    for (const memory of extractPlayerMemories(liveState)) {
      this.currentWorld.memories[memory.playerId] = clone(memory);
    }
    this.currentWorld.settings.learningEnabled = liveState.learningEnabled;
    // Autosave não bloqueia o loop de animação; falha de gravação não pode parar a partida.
    void this.repository.saveProgress(this.currentWorld).catch(() => undefined);
  }

  restartMatch(): void {
    this.persistMatchProgress();
    this.rebuildMatch();
  }

  /** Troca os clubes em campo, cada um com seu plano padrão, e recomeça. */
  selectClubs(blueClubId: string, coralClubId: string): CommandResult {
    const blue = this.currentWorld.clubs.find(({ id }) => id === blueClubId);
    const coral = this.currentWorld.clubs.find(({ id }) => id === coralClubId);
    if (!blue || !coral) return { ok: false, reason: "club-not-found" };
    return this.startMatch({
      blue: { clubId: blue.id, plan: clone(blue.defaultPlan) },
      coral: { clubId: coral.id, plan: clone(coral.defaultPlan) },
    });
  }

  setSeed(seed: number): number {
    if (!Number.isFinite(seed)) return this.currentWorld.settings.randomSeed;
    const normalized = Math.min(0xffff_ffff, Math.max(0, Math.trunc(seed)));
    this.persistMatchProgress();
    this.currentWorld.settings.randomSeed = normalized;
    void this.repository.saveProgress(this.currentWorld).catch(() => undefined);
    this.rebuildMatch();
    return normalized;
  }

  setLearningEnabled(enabled: boolean): void {
    this.currentMatch?.setLearningEnabled(enabled);
    this.currentWorld.settings.learningEnabled = enabled;
    this.persistMatchProgress();
  }

  resetLearning(): void {
    this.currentWorld.memories = Object.fromEntries(
      this.currentWorld.players.map((player) => [player.id, createMemory(player)]),
    );
    void this.repository.save(this.currentWorld).catch(() => undefined);
    this.rebuildMatch();
  }

  /** Único ponto que remonta a partida a partir do mundo atual. Sem partida, não faz nada. */
  private rebuildMatch(): void {
    if (!this.currentMatch || !this.currentSetup) return;
    this.currentMatch.restart(buildMatchConfig(this.currentWorld, this.currentSetup));
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
  private refreshedSetup(): MatchSetup | null {
    const setup = this.currentSetup;
    if (!setup) return null;
    const rebuild = (team: Team) => {
      const club = this.currentWorld.clubs.find(({ id }) => id === setup[team].clubId);
      return club ? { clubId: club.id, plan: clone(club.defaultPlan) } : setup[team];
    };
    return { blue: rebuild("blue"), coral: rebuild("coral") };
  }
}
