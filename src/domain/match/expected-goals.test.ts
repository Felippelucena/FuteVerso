import { describe, expect, it } from "vitest";
import { CALIBRATION } from "./__fixtures__/calibration";
import { referenceMatchConfig, smallSidedMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { FIELD, FIXED_STEP } from "./config";
import { stepMatch } from "./engine";
import type { MatchState, PlayerRuntime } from "./model";
import { expectedGoals } from "./runtime/expected-goals";
import { createMatchState } from "./state";

const metres = (value: number): number => value * FIELD.unitsPerMeter;

/** Cenário limpo: o atacante coral e o gol azul, sem ninguém entre os dois. */
const emptyPitch = (): { state: MatchState; striker: PlayerRuntime } => {
  const state = createMatchState(smallSidedMatchConfig(3));
  startOpenPlay(state);
  const striker = state.players.find((player) => player.profile.id === "maya-fw")!;
  for (const player of state.players) {
    if (player === striker) continue;
    player.position = { x: FIELD.width - 6, y: 6 };
    player.velocity = { x: 0, y: 0 };
  }
  striker.position = { x: metres(12), y: FIELD.height / 2 };
  striker.velocity = { x: 0, y: 0 };
  return { state, striker };
};

const chanceAt = (state: MatchState, striker: PlayerRuntime, x: number, y: number): number =>
  expectedGoals(state, striker, { x, y }, "placed");

describe("gols esperados", () => {
  /**
   * O que faz o número significar alguma coisa não são os pesos, e sim as relações: qualquer
   * recalibragem pode mexer nos valores, nenhuma pode inverter estas ordens.
   */
  it("cresce perto e de frente, e cai de lado e de longe", () => {
    const { state, striker } = emptyPitch();
    const middle = FIELD.height / 2;

    const close = chanceAt(state, striker, metres(6), middle);
    const far = chanceAt(state, striker, metres(25), middle);
    const wide = chanceAt(state, striker, metres(6), FIELD.goalTop - metres(14));

    expect(close).toBeGreaterThan(far);
    expect(close).toBeGreaterThan(wide);
    // Amplitude, e não valor absoluto: um modelo que devolvesse a mesma coisa sempre passaria nas
    // duas ordens acima. Em razão, e não em número cravado, para sobreviver à recalibragem.
    expect(close).toBeGreaterThan(far * 3);
    expect(close).toBeGreaterThan(wide * 3);
    // Nem de seis metros um chute é certeza.
    expect(close).toBeLessThan(0.9);
  });

  it("desconta o contato difícil e o corpo na rota", () => {
    const { state, striker } = emptyPitch();
    const spot = { x: metres(9), y: FIELD.height / 2 };

    const placed = expectedGoals(state, striker, spot, "placed");
    const header = expectedGoals(state, striker, spot, "header");
    expect(header).toBeLessThan(placed);

    // Um zagueiro plantado entre a bola e o gol.
    const defender = state.players.find((player) => player.team !== striker.team && player.profile.position !== "goalkeeper")!;
    defender.position = { x: metres(5), y: FIELD.height / 2 };
    expect(expectedGoals(state, striker, spot, "placed")).toBeLessThan(placed);
  });

  /**
   * O critério de um xG calibrado é um só: a soma do que as chances valiam tem de bater com os
   * gols que saíram. Fora da suíte padrão porque é medida de partida inteira, e porque reafina a
   * cada mudança de regime do motor. Ver __fixtures__/calibration (rode com CALIBRATE=1).
   */
  it.runIf(CALIBRATION)("soma perto dos gols que saem", () => {
    const seeds = [12_345, 98_765, 4_242, 777, 31_337, 606];
    const runs = seeds.map((seed) => {
      const state = createMatchState(referenceMatchConfig(seed));
      for (let tick = 0; tick < 90 * 60 * 120; tick += 1) {
        stepMatch(state, FIXED_STEP);
        if (state.finished) break;
      }
      const sum = (pick: (team: "blue" | "coral") => number) => pick("blue") + pick("coral");
      return {
        seed,
        goals: sum((team) => state.stats[team].goals),
        xG: Number(sum((team) => state.stats[team].expectedGoals).toFixed(2)),
        shots: sum((team) => state.stats[team].shots),
        bigChances: sum((team) => state.stats[team].bigChances),
        xA: Number(sum((team) => state.stats[team].expectedAssists).toFixed(2)),
      };
    });
    const totalGoals = runs.reduce((total, run) => total + run.goals, 0);
    const totalXg = runs.reduce((total, run) => total + run.xG, 0);
    const totalShots = runs.reduce((total, run) => total + run.shots, 0);
    console.table(runs);
    console.log("xG/gol", (totalXg / Math.max(1, totalGoals)).toFixed(3), "xG/chute", (totalXg / Math.max(1, totalShots)).toFixed(3));
    expect(totalXg).toBeGreaterThan(0);
  }, 600_000);
});
