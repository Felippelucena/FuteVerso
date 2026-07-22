import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { FIELD } from "./config";
import { createMatchState, stepMatch } from "./index";
import type { GameProfile } from "../roster/model";

const createTestMatch = (profile: GameProfile = createDefaultProfile(), seed?: number) => createMatchState(buildMatchConfig(profile, seed));

describe("integração do motor", () => {
  it("reproduz a partida quando a semente é igual", () => {
    const save = createDefaultProfile();
    const first = createTestMatch(save, 12345);
    const second = createTestMatch(save, 12345);
    for (let tick = 0; tick < 2400; tick += 1) {
      stepMatch(first, 1 / 120);
      stepMatch(second, 1 / 120);
    }
    expect(second).toEqual(first);
  });

  it("produz trajetorias diferentes quando a semente muda", () => {
    const save = createDefaultProfile();
    const first = createTestMatch(save, 12_345);
    const second = createTestMatch(save, 54_321);
    for (let tick = 0; tick < 2400; tick += 1) {
      stepMatch(first, 1 / 120);
      stepMatch(second, 1 / 120);
    }
    expect(second.players.map((player) => player.position))
      .not.toEqual(first.players.map((player) => player.position));
  });

  it("simula dez minutos sem valores inválidos ou atletas fora do campo", () => {
    const state = createTestMatch(createDefaultProfile(), 98765);
    for (let tick = 0; tick < 72_000; tick += 1) stepMatch(state, 1 / 120);
    for (const player of state.players) {
      expect(Number.isFinite(player.position.x) && Number.isFinite(player.position.y)).toBe(true);
      expect(player.position.x).toBeGreaterThanOrEqual(player.radius);
      expect(player.position.x).toBeLessThanOrEqual(FIELD.width - player.radius);
      expect(player.position.y).toBeGreaterThanOrEqual(player.radius);
      expect(player.position.y).toBeLessThanOrEqual(FIELD.height - player.radius);
    }
    expect(Number.isFinite(state.ball.position.x) && Number.isFinite(state.ball.position.y)).toBe(true);
  }, 15_000);
});
