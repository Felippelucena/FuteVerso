import type { Club } from "../domain/club/model";
import { isValidClub } from "../domain/club/rules";
import type { Contract } from "../domain/contract/model";
import { activeContractOf, contractsOfClub } from "../domain/contract/queries";
import { extractPlayerMemories, type MatchState } from "../domain/match";
import type { PlayerMemory, PlayerProfile } from "../domain/roster/model";
import { createMemory, isValidProfile } from "../domain/roster/rules";
import type { Team } from "../domain/shared/model";
import { inspectPlan } from "../domain/tactics/rules";
import type { WorldSettings } from "../domain/world/model";
import { repairPlan } from "../domain/world/rules";
import { buildMatchConfig, type MatchContext, type MatchSetup, type MatchSide } from "./match/build-match-config";
import { MatchSession } from "./match/match-session";
import type { Catalog, ReadonlyCatalog } from "./ports/catalog";

export type CommandError =
  | "invalid-player"
  | "invalid-club"
  | "player-not-found"
  | "club-not-found"
  | "invalid-plan"
  /** Um clube não tem elenco para os dois lados; a regra é do comando, não da tela. */
  | "same-club";
export type CommandResult = { ok: true } | { ok: false; reason: CommandError };

const clone = <T>(value: T): T => structuredClone(value);

/** Quantos registros o varredor global processa por vez. Só ações explícitas e raras varrem. */
const SWEEP_SIZE = 500;

export interface Squad {
  players: PlayerProfile[];
  contracts: Contract[];
}

export class GameApplication {
  private currentSetup: MatchSetup | null = null;
  private currentMatch: MatchSession | null = null;
  /** Clubes, elencos e memórias dos 22 em campo. Só isto do catálogo fica em memória. */
  private currentContext: MatchContext | null = null;

  constructor(
    private readonly catalog: Catalog,
    private readonly currentSettings: WorldSettings,
  ) {}

  get settings(): WorldSettings {
    return this.currentSettings;
  }

  /** Leitura do catálogo para as telas. Escrever é privilégio dos comandos daqui. */
  get queries(): ReadonlyCatalog {
    return this.catalog;
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

  clubOf(team: Team): Club | null {
    return this.currentContext?.[team].club ?? null;
  }

  /** Elenco do clube. `Contract` continua a única fonte da verdade; isto só o resolve. */
  async squadOfClub(clubId: string): Promise<Squad> {
    const { rows } = await this.catalog.contracts.page({ filter: { field: "clubId", value: clubId } });
    const contracts = contractsOfClub([...rows], clubId);
    const players = await this.catalog.players.getMany(contracts.map((contract) => contract.playerId));
    return { players, contracts };
  }

  async clubCount(): Promise<number> {
    return (await this.catalog.clubs.page({ limit: 0 })).total;
  }

  /** Dois primeiros clubes por nome: o palpite que abre o fluxo de Jogo Rápido. */
  async suggestedSetup(): Promise<MatchSetup | null> {
    const { rows } = await this.catalog.clubs.page({ sort: "name", limit: 2 });
    const [home, away] = rows;
    if (!home || !away) return null;
    return {
      blue: { clubId: home.id, plan: clone(home.defaultPlan) },
      coral: { clubId: away.id, plan: clone(away.defaultPlan) },
    };
  }

  // --- Partida ---------------------------------------------------------------------------

  /** Põe uma partida em campo, criando a sessão ou reaproveitando a que existe. */
  async startMatch(setup: MatchSetup): Promise<CommandResult> {
    if (setup.blue.clubId === setup.coral.clubId) return { ok: false, reason: "same-club" };
    const context = await this.resolveContext(setup);
    if (!context) return { ok: false, reason: "club-not-found" };
    if (inspectPlan(context.blue.plan, context.blue.squad).length > 0
      || inspectPlan(context.coral.plan, context.coral.squad).length > 0) {
      return { ok: false, reason: "invalid-plan" };
    }
    this.currentSetup = setup;
    this.currentContext = context;
    const config = buildMatchConfig(context);
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
    this.currentContext = null;
  }

  persistMatchProgress(): void {
    if (!this.currentMatch) return;
    // Sempre persiste a fronteira ao vivo, mesmo que a linha do tempo esteja rebobinada.
    const liveState = this.currentMatch.liveState;
    const memories = extractPlayerMemories(liveState);
    if (this.currentContext) {
      for (const memory of memories) this.currentContext.memories[memory.playerId] = clone(memory);
    }
    this.currentSettings.learningEnabled = liveState.learningEnabled;
    // Autosave não bloqueia o laço de animação; falha de gravação não pode parar a partida. São
    // 22 memórias, e não o catálogo inteiro — é isto que torna o autosave barato.
    void this.catalog.memories.put(memories).catch(() => undefined);
    void this.catalog.saveSettings(this.currentSettings).catch(() => undefined);
  }

  restartMatch(): void {
    this.persistMatchProgress();
    this.rebuildMatch();
  }

  /** Troca os clubes em campo, cada um com seu plano padrão, e recomeça. */
  async selectClubs(blueClubId: string, coralClubId: string): Promise<CommandResult> {
    const [blue, coral] = await Promise.all([
      this.catalog.clubs.get(blueClubId),
      this.catalog.clubs.get(coralClubId),
    ]);
    if (!blue || !coral) return { ok: false, reason: "club-not-found" };
    return this.startMatch({
      blue: { clubId: blue.id, plan: clone(blue.defaultPlan) },
      coral: { clubId: coral.id, plan: clone(coral.defaultPlan) },
    });
  }

  setSeed(seed: number): number {
    if (!Number.isFinite(seed)) return this.currentSettings.randomSeed;
    const normalized = Math.min(0xffff_ffff, Math.max(0, Math.trunc(seed)));
    this.persistMatchProgress();
    this.currentSettings.randomSeed = normalized;
    void this.catalog.saveSettings(this.currentSettings).catch(() => undefined);
    this.rebuildMatch();
    return normalized;
  }

  setLearningEnabled(enabled: boolean): void {
    this.currentMatch?.setLearningEnabled(enabled);
    this.currentSettings.learningEnabled = enabled;
    this.persistMatchProgress();
  }

  /**
   * Restaura a memória inicial de todos os jogadores. É varredura do catálogo inteiro, e por
   * isso só acontece em ação explícita do usuário — nunca no caminho de uma edição.
   */
  async resetLearning(): Promise<void> {
    for (let offset = 0; ; offset += SWEEP_SIZE) {
      const { rows, total } = await this.catalog.players.page({ offset, limit: SWEEP_SIZE });
      if (rows.length === 0) break;
      await this.catalog.memories.put(rows.map(createMemory));
      if (offset + rows.length >= total) break;
    }
    if (this.currentContext) {
      for (const team of ["blue", "coral"] as const) {
        for (const player of this.currentContext[team].squad) {
          this.currentContext.memories[player.id] = createMemory(player);
        }
      }
    }
    this.rebuildMatch();
  }

  /** Único ponto que remonta a partida a partir do contexto em memória. */
  private rebuildMatch(): void {
    if (!this.currentMatch || !this.currentContext) return;
    this.currentContext.seed = this.currentSettings.randomSeed;
    this.currentContext.learningEnabled = this.currentSettings.learningEnabled;
    this.currentMatch.restart(buildMatchConfig(this.currentContext));
  }

  private async resolveContext(setup: MatchSetup): Promise<MatchContext | null> {
    const sides: Partial<Record<Team, MatchSide>> = {};
    const memories: Record<string, PlayerMemory> = {};
    for (const team of ["blue", "coral"] as const) {
      const club = await this.catalog.clubs.get(setup[team].clubId);
      if (!club) return null;
      const { players, contracts } = await this.squadOfClub(club.id);
      sides[team] = { club, squad: players, contracts, plan: setup[team].plan };
      for (const memory of await this.catalog.memories.getMany(players.map((player) => player.id))) {
        memories[memory.playerId] = memory;
      }
    }
    return {
      blue: sides.blue!,
      coral: sides.coral!,
      memories,
      seed: this.currentSettings.randomSeed,
      learningEnabled: this.currentSettings.learningEnabled,
    };
  }

  // --- Edição do catálogo ----------------------------------------------------------------
  //
  // Integridade incremental: cada comando repara só o seu raio de alcance. O raio de uma edição
  // de jogador é o clube a que ele está vinculado — no máximo um —, porque um plano só pode
  // escalar quem está no próprio elenco. Varrer o mundo a cada tecla, como antes, era O(clubes ×
  // jogadores) e não sobrevive a um catálogo grande.

  async savePlayer(player: PlayerProfile): Promise<CommandResult> {
    if (!isValidProfile(player)) return { ok: false, reason: "invalid-player" };
    const next = clone(player);
    const previous = await this.catalog.players.get(next.id);
    await this.catalog.players.put([next]);
    await this.syncMemory(next, previous);
    await this.repairClubOfPlayer(next.id);
    return { ok: true };
  }

  async deletePlayer(playerId: string): Promise<CommandResult> {
    if (!(await this.catalog.players.get(playerId))) return { ok: false, reason: "player-not-found" };
    const { rows } = await this.catalog.contracts.page({ filter: { field: "playerId", value: playerId } });
    const clubIds = [...new Set(rows.map((contract) => contract.clubId))];
    await this.catalog.contracts.remove(rows.map((contract) => contract.id));
    await this.catalog.players.remove([playerId]);
    await this.catalog.memories.remove([playerId]);
    for (const clubId of clubIds) await this.repairClubPlan(clubId);
    return { ok: true };
  }

  async saveClub(club: Club): Promise<CommandResult> {
    if (!isValidClub(club)) return { ok: false, reason: "invalid-club" };
    await this.catalog.clubs.put([clone(club)]);
    await this.repairClubPlan(club.id);
    return { ok: true };
  }

  /** Excluir o clube desfaz os vínculos: os jogadores continuam no catálogo, como livres. */
  async deleteClub(clubId: string): Promise<CommandResult> {
    if (!(await this.catalog.clubs.get(clubId))) return { ok: false, reason: "club-not-found" };
    const { rows } = await this.catalog.contracts.page({ filter: { field: "clubId", value: clubId } });
    await this.catalog.contracts.remove(rows.map((contract) => contract.id));
    await this.catalog.clubs.remove([clubId]);
    return { ok: true };
  }

  async saveContracts(contracts: readonly Contract[], removedIds: readonly string[] = []): Promise<CommandResult> {
    const clubIds = new Set(contracts.map((contract) => contract.clubId));
    if (removedIds.length > 0) {
      const existing = await this.catalog.contracts.getMany(removedIds);
      for (const contract of existing) clubIds.add(contract.clubId);
      await this.catalog.contracts.remove(removedIds);
    }
    await this.catalog.contracts.put(contracts.map(clone));
    for (const clubId of clubIds) await this.repairClubPlan(clubId);
    return { ok: true };
  }

  private async syncMemory(player: PlayerProfile, previous: PlayerProfile | null): Promise<void> {
    const stored = await this.catalog.memories.get(player.id);
    if (!stored) {
      await this.catalog.memories.put([createMemory(player)]);
      return;
    }
    if (!previous) return;
    const changed = previous.role !== player.role
      || JSON.stringify(previous.mental) !== JSON.stringify(player.mental);
    if (!changed) return;
    // Função ou personalidade mudaram: a política inicial é recalculada, mas a carreira
    // acumulada continua valendo.
    const recalibrated = createMemory(player);
    recalibrated.stats = { ...stored.stats };
    recalibrated.version = stored.version + 1;
    await this.catalog.memories.put([recalibrated]);
  }

  private async repairClubOfPlayer(playerId: string): Promise<void> {
    const { rows } = await this.catalog.contracts.page({ filter: { field: "playerId", value: playerId } });
    const clubId = activeContractOf([...rows], playerId)?.clubId;
    if (clubId) await this.repairClubPlan(clubId);
  }

  private async repairClubPlan(clubId: string): Promise<void> {
    const club = await this.catalog.clubs.get(clubId);
    if (!club) return;
    const { players } = await this.squadOfClub(clubId);
    await this.catalog.clubs.put([{ ...club, defaultPlan: repairPlan(club.defaultPlan, players) }]);
  }
}
