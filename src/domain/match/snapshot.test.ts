import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { captureMatchSnapshot, createMatchState, restoreMatchSnapshot, stepMatch } from "./index";

describe("snapshot da partida", () => {
  it("restaura um estado independente e equivalente ao clone inteiro", () => {
    const state = createMatchState(referenceMatchConfig(4242));
    for (let tick = 0; tick < 300; tick += 1) stepMatch(state, 1 / 120);

    const restored = restoreMatchSnapshot(captureMatchSnapshot(state));
    expect(restored).toEqual(state);

    // Independente: simular a restauração não pode mexer no original nem no snapshot.
    for (let tick = 0; tick < 60; tick += 1) stepMatch(restored, 1 / 120);
    expect(restored.elapsed).toBeGreaterThan(state.elapsed);
  });

  it("compartilha o perfil em vez de duplicar o elenco a cada keyframe", () => {
    const state = createMatchState(referenceMatchConfig(7));
    const restored = restoreMatchSnapshot(captureMatchSnapshot(state));
    // A economia do rebobinar mora nesta identidade: sem ela nada quebra, só volta a custar o
    // elenco inteiro umas centenas de vezes por partida.
    expect(restored.players[0].profile).toBe(state.players[0].profile);
    // E o que muda no atleta segue clonado, senão o passado andaria junto com o presente.
    expect(restored.players[0]).not.toBe(state.players[0]);
    restored.players[0].stamina = 0.123;
    expect(state.players[0].stamina).toBe(1);
  });
});
