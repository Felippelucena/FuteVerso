import { describe, expect, it } from "vitest";
import type { GameProfile, PlayerProfile } from "../domain/roster/model";
import type { SaveRepository } from "./ports/save-repository";
import { createDefaultProfile } from "./profile/create-default-profile";
import { GameApplication } from "./game-application";

class MemoryRepository implements SaveRepository {
  readonly saved: GameProfile[] = [];

  constructor(private source: GameProfile = createDefaultProfile()) {}

  load(): GameProfile {
    return structuredClone(this.source);
  }

  save(profile: GameProfile): void {
    this.source = structuredClone(profile);
    this.saved.push(structuredClone(profile));
  }
}

const reservePlayer = (id = "reserve"): PlayerProfile => ({
  ...structuredClone(createDefaultProfile().players.find(({ id: playerId }) => playerId === "nilo-mid")!),
  id,
  name: "Reserva",
  number: 18,
});

describe("GameApplication", () => {
  it("carrega o perfil e cria uma partida isolada", () => {
    const repository = new MemoryRepository();
    const application = new GameApplication(repository);

    application.profile.players[0].name = "Perfil";

    expect(application.state.players[0].profile.name).toBe("Caio");
  });

  it("persiste memorias e configuracao de aprendizado", () => {
    const repository = new MemoryRepository();
    const application = new GameApplication(repository);
    application.state.players[0].memory.stats.goals = 3;
    application.state.learningEnabled = false;

    application.persistMatchProgress();

    expect(repository.saved.at(-1)?.memories["nilo-gk"].stats.goals).toBe(3);
    expect(repository.saved.at(-1)?.settings.learningEnabled).toBe(false);
  });

  it("normaliza a seed, salva o progresso e reinicia", () => {
    const repository = new MemoryRepository();
    const application = new GameApplication(repository);
    application.state.players[0].memory.stats.goals = 2;

    expect(application.setSeed(0x1_0000_0005)).toBe(0xffff_ffff);

    expect(application.profile.settings.randomSeed).toBe(0xffff_ffff);
    expect(application.state.randomSeed).toBe(0xffff_ffff);
    expect(application.profile.memories["nilo-gk"].stats.goals).toBe(2);
  });

  it("altera aprendizado e restaura as memorias sem mudar controles da sessao", () => {
    const application = new GameApplication(new MemoryRepository());
    application.match.setSpeed(4);
    application.match.setPaused(true);
    application.state.players[0].memory.stats.goals = 9;

    application.setLearningEnabled(false);
    application.resetLearning();

    expect(application.profile.settings.learningEnabled).toBe(false);
    expect(application.profile.memories["nilo-gk"].stats.goals).toBe(0);
    expect(application.match.speed).toBe(4);
    expect(application.match.paused).toBe(true);
  });

  it("troca jogadores entre escalacoes e mantem a partida atual intacta", () => {
    const application = new GameApplication(new MemoryRepository());
    const previousCurrentPlayer = application.state.players[1].profile.id;

    const result = application.changeLineup("blue", 0, "maya-cb");

    expect(result).toEqual({ ok: true });
    expect(application.profile.lineups.blue.fieldPlayerIds[0]).toBe("maya-cb");
    expect(application.profile.lineups.coral.fieldPlayerIds[0]).toBe("nilo-cb");
    expect(application.state.players[1].profile.id).toBe(previousCurrentPlayer);
  });

  it("rejeita uma troca de escalacao invalida", () => {
    const application = new GameApplication(new MemoryRepository());

    expect(application.changeLineup("blue", 0, "nilo-gk")).toEqual({ ok: false, reason: "invalid-lineup" });
    expect(application.profile.lineups.blue.fieldPlayerIds[0]).toBe("nilo-cb");
  });

  it("cria e recalibra jogadores preservando estatisticas", () => {
    const application = new GameApplication(new MemoryRepository());
    const reserve = reservePlayer();
    expect(application.upsertPlayer(reserve)).toEqual({ ok: true });
    expect(application.profile.memories.reserve).toBeDefined();

    application.profile.memories.reserve.stats.goals = 4;
    const edited = { ...reserve, role: "finisher" as const };
    expect(application.upsertPlayer(edited)).toEqual({ ok: true });

    expect(application.profile.memories.reserve.stats.goals).toBe(4);
    expect(application.profile.memories.reserve.version).toBe(2);
  });

  it("impede excluir atleta escalado e remove uma reserva", () => {
    const application = new GameApplication(new MemoryRepository());
    application.upsertPlayer(reservePlayer());

    expect(application.deletePlayer("nilo-gk")).toEqual({ ok: false, reason: "player-in-lineup" });
    expect(application.deletePlayer("reserve")).toEqual({ ok: true });
    expect(application.profile.players.some(({ id }) => id === "reserve")).toBe(false);
    expect(application.profile.memories.reserve).toBeUndefined();
  });
});
