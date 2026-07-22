import { describe, expect, it } from "vitest";
import { DEFAULT_MATCH_SEED } from "./config";
import { createDefaultSave } from "./roster";
import { PlayerRepository } from "./storage";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

describe("PlayerRepository", () => {
  it("preserva perfis, escalações e memórias", () => {
    const storage = new MemoryStorage();
    const repository = new PlayerRepository(storage);
    const save = createDefaultSave();
    save.memories["nilo-fw"].stats.goals = 9;
    repository.save(save);
    expect(repository.load()).toEqual(save);
  });

  it("restaura os padrões quando o conteúdo está corrompido", () => {
    const storage = new MemoryStorage();
    storage.setItem("autoball.save", "{conteudo-invalido");
    const loaded = new PlayerRepository(storage).load();
    expect(loaded.players).toHaveLength(8);
    expect(loaded.schemaVersion).toBe(1);
  });

  it("migra saves antigos adicionando a semente padrao", () => {
    const storage = new MemoryStorage();
    const legacySave = createDefaultSave();
    delete (legacySave.settings as { learningEnabled: boolean; randomSeed?: number }).randomSeed;
    storage.setItem("autoball.save", JSON.stringify(legacySave));

    const loaded = new PlayerRepository(storage).load();

    expect(loaded.settings.randomSeed).toBe(DEFAULT_MATCH_SEED);
    expect(loaded.players).toHaveLength(8);
  });
});
