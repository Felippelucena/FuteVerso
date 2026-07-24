import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { FIELD } from "./config";
import { createMatchState, stepMatch } from "./index";

const createTestMatch = (seed?: number) => createMatchState(referenceMatchConfig(seed));

describe("integração do motor", () => {
  it("reproduz a partida quando a semente é igual", () => {
    const first = createTestMatch(12345);
    const second = createTestMatch(12345);
    for (let tick = 0; tick < 2400; tick += 1) {
      stepMatch(first, 1 / 120);
      stepMatch(second, 1 / 120);
    }
    expect(second).toEqual(first);
    // Timeout explícito: são duas partidas de 22 jogadores simuladas em paralelo, e o padrão de
    // 5s estoura quando a suíte roda concorrente. É custo de simulação, não lentidão de teste.
  }, 30_000);

  it("produz trajetorias diferentes quando a semente muda", () => {
    const first = createTestMatch(12_345);
    const second = createTestMatch(54_321);
    for (let tick = 0; tick < 2400; tick += 1) {
      stepMatch(first, 1 / 120);
      stepMatch(second, 1 / 120);
    }
    expect(second.players.map((player) => player.position))
      .not.toEqual(first.players.map((player) => player.position));
  }, 30_000);

  it("simula dez minutos sem valores inválidos nem atletas fugindo do campo", () => {
    const state = createTestMatch(98765);
    for (let tick = 0; tick < 72_000; tick += 1) stepMatch(state, 1 / 120);
    for (const player of state.players) {
      expect(Number.isFinite(player.position.x) && Number.isFinite(player.position.y)).toBe(true);
      // Ninguém foge do campo: dentro das linhas ou, no máximo, na faixa de segurança (runOff) —
      // onde o cobrador do lateral/escanteio fica, do lado de fora.
      expect(player.position.x).toBeGreaterThanOrEqual(-FIELD.runOff);
      expect(player.position.x).toBeLessThanOrEqual(FIELD.width + FIELD.runOff);
      expect(player.position.y).toBeGreaterThanOrEqual(-FIELD.runOff);
      expect(player.position.y).toBeLessThanOrEqual(FIELD.height + FIELD.runOff);
    }
    expect(Number.isFinite(state.ball.position.x) && Number.isFinite(state.ball.position.y)).toBe(true);
  }, 60_000);
});
