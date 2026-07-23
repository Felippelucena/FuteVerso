import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { createMatchState, stepMatch } from "./index";
import { FIELD } from "./config";
import { length } from "../shared/math";
import { applyStamina } from "./systems/movement-system";

const DT = 1 / 120;
// Vão útil de gol a gol no campo atual (com as margens que o jogo usa).
const GOAL_TO_GOAL = FIELD.width - 10;

const outfield = (state = createMatchState(buildMatchConfig(createDefaultProfile()))) =>
  state.players.find((player) => player.team === "blue" && player.profile.position === "forward")!;

describe("estamina volátil (piques)", () => {
  it("gasta ~60% da volátil ao atravessar o campo em disparada", () => {
    const player = outfield();
    player.stamina = 1;
    player.sprintEnergy = 1;
    player.velocity = { x: 24, y: 0 };
    let travelled = 0;
    while (travelled < GOAL_TO_GOAL) {
      applyStamina(player, "burst", DT);
      travelled += length(player.velocity) * DT;
    }
    const spent = 1 - player.sprintEnergy;
    expect(spent).toBeGreaterThan(0.5);
    expect(spent).toBeLessThan(0.72);
  });

  it("recupera do zero ao cheio em torno de 4 a 5 segundos parado", () => {
    const player = outfield();
    player.stamina = 1;
    player.sprintEnergy = 0;
    player.velocity = { x: 0, y: 0 };
    let elapsed = 0;
    while (player.sprintEnergy < 1 && elapsed < 12) {
      applyStamina(player, "walk", DT);
      elapsed += DT;
    }
    expect(elapsed).toBeGreaterThan(3.5);
    expect(elapsed).toBeLessThan(5.5);
  });

  it("o pique não recupera a volátil e o trote/parado recupera", () => {
    const player = outfield();
    player.stamina = 1;
    player.sprintEnergy = 0.5;
    player.velocity = { x: 24, y: 0 };
    applyStamina(player, "burst", DT);
    expect(player.sprintEnergy).toBeLessThan(0.5);
    player.sprintEnergy = 0.5;
    player.velocity = { x: 0, y: 0 };
    applyStamina(player, "walk", DT);
    expect(player.sprintEnergy).toBeGreaterThan(0.5);
  });
});

describe("estamina longa (fôlego de partida)", () => {
  it("nunca sobe durante a partida e termina entre 50% e 60% para o time de linha", () => {
    const finals: number[] = [];
    let maxIncrease = 0;
    for (const seed of [11, 27, 43]) {
      const state = createMatchState(buildMatchConfig(createDefaultProfile(), seed));
      const previous = new Map(state.players.map((player) => [player.profile.id, player.stamina]));
      while (!state.finished) {
        stepMatch(state, DT);
        for (const player of state.players) {
          maxIncrease = Math.max(maxIncrease, player.stamina - previous.get(player.profile.id)!);
          previous.set(player.profile.id, player.stamina);
        }
      }
      for (const player of state.players) {
        if (player.profile.position === "goalkeeper") continue;
        finals.push(player.stamina);
      }
    }
    // A longa nunca sobe durante a partida (bola parada só devolve a volátil).
    expect(maxIncrease).toBeLessThan(1e-9);
    const mean = finals.reduce((sum, value) => sum + value, 0) / finals.length;
    // eslint-disable-next-line no-console
    console.info("STAMINA_FINALS", JSON.stringify({ mean: Number(mean.toFixed(3)), finals: finals.map((value) => Number(value.toFixed(3))) }));
    expect(mean).toBeGreaterThanOrEqual(0.5);
    expect(mean).toBeLessThanOrEqual(0.6);
    // Variância natural em volta da média: zagueiros posicionais terminam mais inteiros,
    // volantes/atacantes que disparam o tempo todo terminam bem mais desgastados.
    expect(Math.min(...finals)).toBeGreaterThan(0.35);
    expect(Math.max(...finals)).toBeLessThan(0.78);
  }, 120_000);

  it("começa cheia por padrão (jogo rápido) e respeita o startingStamina do participante", () => {
    const config = buildMatchConfig(createDefaultProfile());
    const quick = createMatchState(config);
    expect(quick.players.every((player) => player.stamina === 1)).toBe(true);

    config.participants[1].startingStamina = 0.62;
    const carried = createMatchState(config);
    const target = carried.players.find((player) => player.profile.id === config.participants[1].profile.id)!;
    expect(target.stamina).toBeCloseTo(0.62, 5);
  });
});
