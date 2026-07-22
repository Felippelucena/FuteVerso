import { describe, expect, it } from "vitest";
import { FIELD } from "./config";
import { decideAll } from "./ai";
import { createGameState, stepGame } from "./engine";
import { distance } from "./math";
import { createDefaultSave } from "./roster";
import { updateTacticalContext } from "./tactics";

describe("qualidade coletiva da simulacao", () => {
  it("produz uma partida ativa sem colapso permanente em uma lateral", () => {
    const state = createGameState(createDefaultSave(), 98_765);
    let narrowSnapshots = 0;
    let sampledSnapshots = 0;
    let worstTouchlineCrowd = 0;
    let controllerStreak = 0;
    let longestControllerStreak = 0;
    let rivalContactStreak = 0;
    let longestRivalContactStreak = 0;
    let freeDribbleTicks = 0;
    const observedPaces = new Set<string>();

    for (let tick = 0; tick < 72_000; tick += 1) {
      stepGame(state, 1 / 120);
      const controller = state.players.find((player) => player.profile.id === state.ball.controllerId);
      if (controller) {
        controllerStreak += 1;
        longestControllerStreak = Math.max(longestControllerStreak, controllerStreak);
        const rivalGap = Math.min(...state.players.filter((player) => player.team !== controller.team)
          .map((player) => distance(player.position, controller.position)));
        if (rivalGap < controller.radius * 2 + 0.7) {
          rivalContactStreak += 1;
          longestRivalContactStreak = Math.max(longestRivalContactStreak, rivalContactStreak);
        } else rivalContactStreak = 0;
      } else {
        controllerStreak = 0;
        rivalContactStreak = 0;
      }
      if (state.ball.dribbleOwnerId && !state.ball.controllerId) freeDribbleTicks += 1;
      if (tick % 120 !== 0) continue;
      state.players.forEach((player) => observedPaces.add(player.pace));
      const outfield = state.players.filter((player) => player.profile.position !== "goalkeeper");
      let pairDistance = 0;
      let pairs = 0;
      for (let first = 0; first < outfield.length; first += 1) {
        for (let second = first + 1; second < outfield.length; second += 1) {
          pairDistance += distance(outfield[first].position, outfield[second].position);
          pairs += 1;
        }
      }
      if (pairDistance / pairs < 28) narrowSnapshots += 1;
      worstTouchlineCrowd = Math.max(worstTouchlineCrowd, outfield.filter((player) => Math.min(player.position.y, FIELD.height - player.position.y) < 10).length);
      sampledSnapshots += 1;
    }

    const totalPasses = state.stats.blue.passes + state.stats.coral.passes;
    const totalShots = state.stats.blue.shots + state.stats.coral.shots;
    expect(totalPasses).toBeGreaterThan(8);
    expect(totalShots).toBeGreaterThan(0);
    expect(narrowSnapshots / sampledSnapshots).toBeLessThan(0.25);
    expect(worstTouchlineCrowd).toBeLessThan(6);
    expect(longestControllerStreak / 120).toBeLessThan(2);
    expect(longestRivalContactStreak / 120).toBeLessThan(1.5);
    expect(freeDribbleTicks).toBeGreaterThan(120);
    expect(observedPaces).toEqual(new Set(["walk", "run", "burst", "closeControl"]));
    expect(state.finished).toBe(true);
    expect(state.events.some((event) => event.label === "Fim de partida")).toBe(true);
    expect(state.stats.blue.spatialSeconds).toBeGreaterThan(590);
    expect(state.heatmaps.blue.some((value) => value > 0)).toBe(true);
    expect(Object.keys(state.passNetwork.blue).length + Object.keys(state.passNetwork.coral).length).toBeGreaterThan(0);
    const totals = (key: keyof typeof state.stats.blue): number =>
      Number(state.stats.blue[key]) + Number(state.stats.coral[key]);
    expect(totals("longPasses")).toBeGreaterThan(0);
    expect(totals("aerialPasses")).toBeGreaterThan(0);
    expect(totals("feintsAttempted")).toBeGreaterThan(0);
    expect(totals("sprintDribbles")).toBeGreaterThan(0);
    expect(state.stats.blue.completedLongPasses).toBeLessThanOrEqual(state.stats.blue.longPasses);
    expect(state.stats.coral.completedAerialPasses).toBeLessThanOrEqual(state.stats.coral.aerialPasses);
    for (const team of ["blue", "coral"] as const) {
      expect(state.stats[team].shotsOnTarget).toBeLessThanOrEqual(state.stats[team].shots);
      expect(state.stats[team].goalsFromShots + state.stats[team].goalsFromPasses + state.stats[team].goalsFromDribbles)
        .toBe(state.stats[team].goals);
    }
  }, 15_000);

  it("muda a fase e coordena funções ofensivas conforme o contexto", () => {
    const state = createGameState(createDefaultSave(), 456);
    state.kickoffTimer = 0;
    const carrier = state.players.find((player) => player.team === "blue" && player.profile.role === "playmaker")!;
    carrier.position = { x: FIELD.width * 0.2, y: FIELD.height / 2 };
    state.ball.position = { ...carrier.position };
    state.ball.controllerId = carrier.profile.id;
    state.possessionTeam = "blue";
    state.lastControlledTeam = "blue";
    updateTacticalContext(state, 0);
    expect(state.tactics.blue.phase).toBe("buildUp");

    carrier.position.x = FIELD.width * 0.78;
    state.ball.position = { ...carrier.position };
    updateTacticalContext(state, 1);
    expect(state.tactics.blue.phase).toBe("finalThird");
    expect(state.stats.blue.finalThirdEntries).toBe(1);

    const decisions = decideAll(state);
    const forward = state.players.find((player) => player.team === "blue" && player.profile.role === "finisher")!;
    const defender = state.players.find((player) => player.team === "blue" && player.profile.role === "defender" && player.profile.position !== "goalkeeper")!;
    expect(decisions.get(forward.profile.id)?.reason).toBe("runInBehind");
    expect(decisions.get(defender.profile.id)?.reason).toBe("restDefense");
  });

  it("aplica lateral para o adversario do ultimo toque", () => {
    const state = createGameState(createDefaultSave(), 123);
    state.kickoffTimer = 0;
    state.ball.controllerId = null;
    state.ball.lastTouch = "blue";
    state.ball.position = { x: FIELD.width * 0.7, y: -FIELD.ballRadius - 0.1 };
    state.ball.velocity = { x: 0, y: 0 };

    stepGame(state, 1 / 120);

    expect(state.possessionTeam).toBe("coral");
    expect(state.events[0].label).toContain("Lateral para MAYA");
    expect(state.ball.position.y).toBeGreaterThan(0);
  });

  it("diferencia escanteio de tiro de meta pelo ultimo toque", () => {
    const corner = createGameState(createDefaultSave(), 321);
    corner.kickoffTimer = 0;
    corner.ball.controllerId = null;
    corner.ball.lastTouch = "coral";
    corner.ball.position = { x: FIELD.width + FIELD.ballRadius + 0.1, y: FIELD.goalTop - 4 };
    corner.ball.velocity = { x: 0, y: 0 };
    stepGame(corner, 1 / 120);

    const goalKick = createGameState(createDefaultSave(), 321);
    goalKick.kickoffTimer = 0;
    goalKick.ball.controllerId = null;
    goalKick.ball.lastTouch = "blue";
    goalKick.ball.position = { x: FIELD.width + FIELD.ballRadius + 0.1, y: FIELD.goalTop - 4 };
    goalKick.ball.velocity = { x: 0, y: 0 };
    stepGame(goalKick, 1 / 120);

    expect(corner.events[0].label).toContain("Escanteio para NILO");
    expect(goalKick.events[0].label).toContain("Tiro de meta para MAYA");
  });
});
