import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { createMatchState, stepMatch } from "./index";
import { GOAL_TO_GOAL_SPRINT } from "./config";
import { length } from "../shared/math";
import { applyStamina } from "./systems/movement-system";

const DT = 1 / 120;
// Mesma corrida de referência que calibra o custo do pique: se as duas divergissem, o
// teste passaria a medir outra coisa que não a calibragem.
const GOAL_TO_GOAL = GOAL_TO_GOAL_SPRINT;

const outfield = (state = createMatchState(referenceMatchConfig())) =>
  state.players.find((player) => player.team === "blue" && player.profile.position === "striker")!;

describe("estamina volátil (piques)", () => {
  // A travessia gol a gol é a régua de calibragem do custo do pique, não uma corrida que
  // acontece em jogo: burstDuration cobre só ~8% do gramado. O teste seguinte mede o que o
  // jogador de fato sente ao longo de uma partida.
  it("gasta ~70% da volátil ao atravessar o campo em disparada", () => {
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
    // Faixa estreita porque o custo é derivado do campo: sair dela significa que alguém
    // desamarrou volatileBurstCostPerUnit de GOAL_TO_GOAL_SPRINT.
    expect(spent).toBeGreaterThan(0.65);
    expect(spent).toBeLessThan(0.78);
  });

  it("é usada de verdade numa partida, sem nunca esgotar", () => {
    const state = createMatchState(referenceMatchConfig(12_345));
    const lowest = new Map<string, number>();
    const burstTicks = new Map<string, number>();
    let ticks = 0;

    while (!state.finished) {
      stepMatch(state, DT);
      ticks += 1;
      for (const player of state.players) {
        lowest.set(player.profile.id, Math.min(lowest.get(player.profile.id) ?? 1, player.sprintEnergy));
        if (player.pace === "burst") {
          burstTicks.set(player.profile.id, (burstTicks.get(player.profile.id) ?? 0) + 1);
        }
      }
    }

    const outfielders = state.players.filter((player) => player.profile.position !== "goalkeeper");
    const minima = outfielders.map((player) => lowest.get(player.profile.id) ?? 1);
    const duty = outfielders.map((player) => (burstTicks.get(player.profile.id) ?? 0) / ticks);
    // eslint-disable-next-line no-console
    console.info("VOLATILE_CALIBRATION", JSON.stringify({
      minima: minima.map((value) => Number(value.toFixed(3))),
      duty: duty.map((value) => Number(value.toFixed(3))),
    }));

    // O jogador mais acionado precisa sentir a barra: se todos terminarem perto de 100%, o
    // pique virou decoração e não há decisão nenhuma em disparar.
    expect(Math.min(...minima)).toBeLessThan(0.8);
    // E ninguém pode ficar sem pique: zerar a barra tira o jogador do jogo em vez de custar.
    expect(Math.min(...minima)).toBeGreaterThan(0.3);
    // Disparar precisa ser parte do jogo, não um evento raro.
    expect(Math.max(...duty)).toBeGreaterThan(0.15);
  }, 120_000);

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
      const state = createMatchState(referenceMatchConfig(seed));
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
    const config = referenceMatchConfig();
    const quick = createMatchState(config);
    expect(quick.players.every((player) => player.stamina === 1)).toBe(true);

    config.participants[1].startingStamina = 0.62;
    const carried = createMatchState(config);
    const target = carried.players.find((player) => player.profile.id === config.participants[1].profile.id)!;
    expect(target.stamina).toBeCloseTo(0.62, 5);
  });
});
