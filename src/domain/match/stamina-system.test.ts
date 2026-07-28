import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { createMatchState, stepMatch } from "./index";
import { GOAL_TO_GOAL_SPRINT } from "./config";
import { length } from "../shared/math";
import type { MovementPace } from "./model";
import { applyStamina } from "./systems/movement-system";
import { CALIBRATION } from "./__fixtures__/calibration";
import { createMatchRules } from "./rules";
import type { MatchRules } from "./model";

const DT = 1 / 120;
// Mesma corrida de referência que calibra o custo do pique: se as duas divergissem, o
// teste passaria a medir outra coisa que não a calibragem.
const GOAL_TO_GOAL = GOAL_TO_GOAL_SPRINT;

// As medidas de PARTIDA INTEIRA abaixo são calibragem (dependem do equilíbrio bola-rolando/bola-
// parada); ficam fora da suíte padrão. Ver __fixtures__/calibration (rode com CALIBRATE=1).

const outfield = (state = createMatchState(referenceMatchConfig())) =>
  state.players.find((player) => player.team === "blue" && player.profile.position === "striker")!;

describe("estamina volátil (piques)", () => {
  // O custo do pique é derivado da travessia gol a gol, então o alcance de uma barra cheia é
  // uma fração fixa do campo, qualquer que seja o tamanho do gramado. Sair da faixa significa
  // que alguém desamarrou volatileBurstCostPerUnit de GOAL_TO_GOAL_SPRINT.
  //
  // O teto é MEIA travessia, e é aritmética, não calibragem: a barra cheia paga
  // 1/VOLATILE_BURST_PER_CROSSING do campo. Quem chega lá é o atleta inteiro; durante a partida a
  // fadiga longa encarece o pique e encurta o alcance, e é daí que vem o piso da faixa.
  it("a barra cheia banca de um terço a metade do campo em disparada contínua", () => {
    const player = outfield();
    player.stamina = 1;
    player.sprintEnergy = 1;
    player.velocity = { x: 24, y: 0 };
    let travelled = 0;
    while (player.sprintEnergy > 0 && travelled < GOAL_TO_GOAL) {
      applyStamina(player, "burst", DT);
      travelled += length(player.velocity) * DT;
    }
    const share = travelled / GOAL_TO_GOAL;
    expect(share).toBeGreaterThan(0.33);
    expect(share).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  // O mínimo da partida sozinho não diz nada: tocar o fundo uma vez em dez minutos é
  // compatível tanto com a barra viva quanto com ela grudada no topo. O que descreve o
  // regime é quanto TEMPO o jogador passa cheio, esgotado e a média entre os dois.
  it.runIf(CALIBRATION)("fica longe do topo e longe do fundo ao longo da partida", () => {
    const state = createMatchState(referenceMatchConfig(12_345));
    const track = new Map<string, { sum: number; full: number; empty: number; burst: number }>();
    let ticks = 0;

    while (!state.finished) {
      stepMatch(state, DT);
      ticks += 1;
      for (const player of state.players) {
        const seen = track.get(player.profile.id) ?? { sum: 0, full: 0, empty: 0, burst: 0 };
        seen.sum += player.sprintEnergy;
        if (player.sprintEnergy > 0.9) seen.full += 1;
        if (player.sprintEnergy < 0.1) seen.empty += 1;
        if (player.pace === "burst") seen.burst += 1;
        track.set(player.profile.id, seen);
      }
    }

    const outfielders = state.players.filter((player) => player.profile.position !== "goalkeeper");
    const share = (pick: (seen: { sum: number; full: number; empty: number; burst: number }) => number) =>
      outfielders.map((player) => pick(track.get(player.profile.id)!) / ticks);
    const means = share((seen) => seen.sum);
    const fullShare = share((seen) => seen.full);
    const emptyShare = share((seen) => seen.empty);
    const duty = share((seen) => seen.burst);
    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    // eslint-disable-next-line no-console
    console.info("VOLATILE_CALIBRATION", JSON.stringify({
      mean: Number(average(means).toFixed(3)),
      fullShare: Number(average(fullShare).toFixed(3)),
      emptyShare: Number(average(emptyShare).toFixed(3)),
      maxEmptyShare: Number(Math.max(...emptyShare).toFixed(3)),
      maxDuty: Number(Math.max(...duty).toFixed(3)),
      means: means.map((value) => Number(value.toFixed(2))),
    }));

    // A média do elenco é a régua do regime: perto de 1 o pique virou decoração (era ~0,97
    // quando o ciclo pique/espera era lucrativo) e no fundo o jogo vira caminhada.
    expect(average(means)).toBeLessThan(0.85);
    expect(average(means)).toBeGreaterThan(0.5);
    // Ninguém pode viver sem pique: barra no fundo tira o jogador do jogo em vez de custar.
    expect(Math.max(...emptyShare)).toBeLessThan(0.12);
    // Disparar precisa ser parte do jogo, não um evento raro.
    expect(Math.max(...duty)).toBeGreaterThan(0.15);
  }, 120_000);

  it("recupera do zero ao cheio em torno de 8 segundos parado", () => {
    const player = outfield();
    player.stamina = 1;
    player.sprintEnergy = 0;
    player.velocity = { x: 0, y: 0 };
    let elapsed = 0;
    while (player.sprintEnergy < 1 && elapsed < 20) {
      applyStamina(player, "walk", DT);
      elapsed += DT;
    }
    expect(elapsed).toBeGreaterThan(6.5);
    expect(elapsed).toBeLessThan(11);
  });


  // Os três regimes em ordem: o pique drena, o trote recupera pouco (a corrida cobra por
  // cima da recarga) e só parado/andando a barra volta cheia. Se o trote deixar de recuperar,
  // a barra espirala para zero só de jogar — é este o piso que o teste protege.
  it("o pique drena, o trote recupera devagar e parado recupera rápido", () => {
    const player = outfield();
    player.stamina = 1;
    const delta = (pace: MovementPace, speed: number): number => {
      player.sprintEnergy = 0.5;
      player.velocity = { x: speed, y: 0 };
      applyStamina(player, pace, DT);
      return player.sprintEnergy - 0.5;
    };
    expect(delta("burst", 24)).toBeLessThan(0);
    expect(delta("run", 16)).toBeGreaterThan(0);
    expect(delta("run", 16)).toBeLessThan(delta("walk", 0));
  });
});

describe("estamina longa (fôlego de partida)", () => {
  it.runIf(CALIBRATION)("nunca sobe durante a partida e termina entre 50% e 60% para o time de linha", () => {
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

  /**
   * O item que a régua derivada resolve: a calibragem valia só para a partida em que foi medida.
   * Os custos são por segundo em campo e por unidade percorrida, e os dois crescem com a duração —
   * numa partida longa todo mundo ia ao piso só de estar em pé. Agora o desgaste é medido em
   * fração de partida, e o fim de jogo é o mesmo em qualquer relógio.
   */
  it.runIf(CALIBRATION)("termina na mesma faixa numa partida de dez e numa de vinte minutos", () => {
    const meanFinal = (rules: MatchRules): number => {
      const state = createMatchState({ ...referenceMatchConfig(11), rules });
      while (!state.finished) stepMatch(state, DT);
      const outfielders = state.players.filter((player) => player.profile.position !== "goalkeeper");
      return outfielders.reduce((sum, player) => sum + player.stamina, 0) / outfielders.length;
    };

    const short = meanFinal(createMatchRules({ halves: 2, halfDuration: 5 * 60 }));
    const long = meanFinal(createMatchRules({ halves: 2, halfDuration: 10 * 60 }));

    // eslint-disable-next-line no-console
    console.info("STAMINA_BY_DURATION", JSON.stringify({ short: Number(short.toFixed(3)), long: Number(long.toFixed(3)) }));
    for (const mean of [short, long]) {
      expect(mean).toBeGreaterThanOrEqual(0.5);
      expect(mean).toBeLessThanOrEqual(0.6);
    }
  }, 180_000);

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
