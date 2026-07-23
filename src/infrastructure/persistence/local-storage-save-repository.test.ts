import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { DEFAULT_MATCH_SEED } from "../../domain/match/config";
import { LEGACY_STORAGE_KEYS, LocalStorageSaveRepository, STORAGE_KEY } from "./local-storage-save-repository";
import { toSaveDocument } from "./save-schema";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

const createRepository = (storage: Storage | null) => new LocalStorageSaveRepository(storage, createDefaultProfile);

describe("LocalStorageSaveRepository", () => {
  it("preserva perfis, escalações e memórias em um documento v2", () => {
    const storage = new MemoryStorage();
    const repository = createRepository(storage);
    const profile = createDefaultProfile();
    profile.memories["nilo-fw"].stats.goals = 9;

    repository.save(profile);

    expect(repository.load()).toEqual(profile);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).schemaVersion).toBe(3);
  });

  it("migra um save 4x4 (v2, três de linha) para 5x5 completando cada escalação", () => {
    const storage = new MemoryStorage();
    const base = createDefaultProfile();
    // Reconstrói o save antigo: elenco sem o volante e escalações com três jogadores de linha.
    const legacyPlayers = base.players.filter((player) => !player.id.endsWith("-vol"));
    const legacy = {
      ...toSaveDocument({ ...base, players: legacyPlayers }),
      schemaVersion: 2,
      lineups: {
        blue: { goalkeeperId: "nilo-gk", fieldPlayerIds: ["nilo-cb", "nilo-mid", "nilo-fw"] },
        coral: { goalkeeperId: "maya-gk", fieldPlayerIds: ["maya-cb", "maya-mid", "maya-fw"] },
      },
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const loaded = createRepository(storage).load();

    expect(loaded.lineups.blue.fieldPlayerIds).toHaveLength(4);
    expect(loaded.lineups.coral.fieldPlayerIds).toHaveLength(4);
    // Sem reservas no banco, sintetiza um jogador a mais por time (8 → 10).
    expect(loaded.players).toHaveLength(10);
    // O save migrado só é regravado no próximo autosave; ao regravar, sobe para v3.
    createRepository(storage).save(loaded);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).schemaVersion).toBe(3);
  });

  it("restaura os padrões quando o conteúdo está corrompido", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, "{conteudo-invalido");

    expect(createRepository(storage).load().players).toHaveLength(10);
  });

  it("normaliza documentos v2 sem semente", () => {
    const storage = new MemoryStorage();
    const document = toSaveDocument(createDefaultProfile());
    delete (document.settings as { learningEnabled: boolean; randomSeed?: number }).randomSeed;
    storage.setItem(STORAGE_KEY, JSON.stringify(document));

    const loaded = createRepository(storage).load();

    expect(loaded.settings.randomSeed).toBe(DEFAULT_MATCH_SEED);
    expect(loaded.players).toHaveLength(10);
  });

  it("descarta saves v1 e inicia o perfil padrão", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, players: [] }));

    const loaded = createRepository(storage).load();

    expect(loaded.players).toHaveLength(10);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("migra saves da chave antiga para a chave atual", () => {
    const storage = new MemoryStorage();
    const profile = createDefaultProfile();
    profile.memories["nilo-fw"].stats.goals = 4;
    const raw = JSON.stringify(toSaveDocument(profile));
    storage.setItem(LEGACY_STORAGE_KEYS[0], raw);

    const loaded = createRepository(storage).load();

    expect(loaded).toEqual(profile);
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
    expect(storage.getItem(LEGACY_STORAGE_KEYS[0])).toBeNull();
  });

  it("usa o fallback sem uma API de navegador", () => {
    expect(createRepository(null).load()).toEqual(createDefaultProfile());
  });
});
