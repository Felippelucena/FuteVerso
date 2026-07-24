import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { FIELD, POSSESSION } from "./config";
import { decideAll, planAll, resolvePlanDecision } from "./ai";
import { createMatchState, stepMatch } from "./index";
import { distance } from "../shared/math";
import { updateTacticalContext } from "./systems/tactics-system";

const createTestMatch = (seed?: number) => createMatchState(referenceMatchConfig(seed));

describe("qualidade coletiva da simulacao", () => {
  it("produz uma partida ativa sem colapso permanente em uma lateral", () => {
    const state = createTestMatch(98_765);
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
      stepMatch(state, 1 / 120);
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
    expect(longestControllerStreak / 120).toBeLessThan(12);
    expect(longestRivalContactStreak / 120).toBeLessThan(3);
    expect(freeDribbleTicks).toBeGreaterThan(120);
    expect(observedPaces).toEqual(new Set(["walk", "run", "burst", "closeControl"]));
    expect(state.finished).toBe(true);
    expect(state.events.some((event) => event.type === "match-finished")).toBe(true);
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
    expect(state.stats.blue.turnoversWon + state.stats.coral.turnoversWon).toBeLessThan(120);
    // Knock-ons empurram a bola à frente com mais frequência que a antiga condução colada,
    // então há um pouco mais de entradas no terço final — comportamento desejado, sem colapso.
    expect(state.stats.blue.finalThirdEntries).toBeLessThan(42);
    expect(state.stats.coral.finalThirdEntries).toBeLessThan(42);
    for (const team of ["blue", "coral"] as const) {
      expect(state.stats[team].shotsOnTarget).toBeLessThanOrEqual(state.stats[team].shots);
      expect(state.stats[team].goalsFromShots + state.stats[team].goalsFromPasses + state.stats[team].goalsFromDribbles)
        .toBe(state.stats[team].goals);
    }
  }, 15_000);

  it("preserva variedade de acoes em oito sementes curtas", () => {
    const totals = { passes: 0, shots: 0, expressiveDribbles: 0 };
    const signatures = new Set<string>();
    for (let seed = 1; seed <= 8; seed += 1) {
      const state = createTestMatch(seed * 997);
      for (let tick = 0; tick < 90 * 120; tick += 1) stepMatch(state, 1 / 120);
      const passes = state.stats.blue.passes + state.stats.coral.passes;
      const shots = state.stats.blue.shots + state.stats.coral.shots;
      const expressiveDribbles = state.stats.blue.feintsAttempted + state.stats.coral.feintsAttempted
        + state.stats.blue.sprintDribbles + state.stats.coral.sprintDribbles;
      totals.passes += passes;
      totals.shots += shots;
      totals.expressiveDribbles += expressiveDribbles;
      signatures.add(`${passes}:${shots}:${expressiveDribbles}:${state.stats.blue.goals}:${state.stats.coral.goals}`);
    }
    const actions = totals.passes + totals.shots + totals.expressiveDribbles;
    expect(Math.max(totals.passes, totals.shots, totals.expressiveDribbles) / actions).toBeLessThan(0.9);
    expect(totals.shots).toBeGreaterThan(0);
    expect(totals.expressiveDribbles).toBeGreaterThan(0);
    expect(signatures.size).toBeGreaterThan(4);
  }, 15_000);

  it("muda a fase e coordena funções ofensivas conforme o contexto", () => {
    const state = createTestMatch(456);
    state.kickoffTimer = 0;
    const carrier = state.players.find((player) => player.team === "blue" && player.profile.role === "playmaker")!;
    carrier.position = { x: FIELD.width * 0.2, y: FIELD.height / 2 };
    state.ball.position = { ...carrier.position };
    state.ball.controllerId = carrier.profile.id;
    state.possessionTeam = "blue";
    state.ballControlTeam = "blue";
    state.lastControlledTeam = "blue";
    updateTacticalContext(state, 0);
    state.elapsed = 0.8;
    updateTacticalContext(state, 0);
    expect(state.tactics.blue.phase).toBe("buildUp");

    carrier.position.x = FIELD.width * 0.78;
    state.ball.position = { ...carrier.position };
    updateTacticalContext(state, 0);
    state.elapsed = 1.6;
    updateTacticalContext(state, 1);
    expect(state.tactics.blue.phase).toBe("finalThird");
    expect(state.stats.blue.finalThirdEntries).toBe(1);

    const decisions = decideAll(state);
    const forward = state.players.find((player) => player.team === "blue" && player.profile.role === "finisher")!;
    const defenders = state.players.filter((player) => player.team === "blue" && player.profile.role === "defender" && player.profile.position !== "goalkeeper");
    expect(decisions.get(forward.profile.id)?.reason).toBe("runInBehind");
    // Com o time avançado, ao menos um defensor segura a retaguarda (rest defense).
    expect(defenders.some((defender) => decisions.get(defender.profile.id)?.reason === "restDefense")).toBe(true);
  });

  it("faz o atacante arrancar para oferecer passe depois de uma retomada defensiva", () => {
    const state = createTestMatch(654);
    state.kickoffTimer = 0;
    state.elapsed = 30;
    const carrier = state.players.find((player) => player.team === "blue" && player.profile.role === "defender" && player.profile.position !== "goalkeeper")!;
    const forward = state.players.find((player) => player.team === "blue" && player.profile.role === "finisher")!;
    carrier.position = { x: FIELD.width * 0.18, y: FIELD.height / 2 };
    carrier.velocity = { x: 1, y: 0 };
    forward.position = { x: FIELD.width * 0.23, y: FIELD.height * 0.62 };
    forward.velocity = { x: 0, y: 0 };
    state.players.forEach((player, index) => {
      if (player.team === "coral") player.position = { x: FIELD.width * 0.68 + index, y: 10 + index * 11 };
    });
    state.ball.position = { ...carrier.position };
    state.ball.controllerId = carrier.profile.id;
    state.ball.controlStartedAt = state.elapsed - 0.4;
    state.possessionTeam = "blue";
    state.lastControlledTeam = "blue";
    state.previousControlledTeam = "coral";
    state.controlChangedAt = state.elapsed - 0.25;
    updateTacticalContext(state, 0);

    const decision = decideAll(state).get(forward.profile.id)!;

    expect(state.tactics.blue.phase).toBe("counterAttack");
    expect(decision.reason).toBe("runInBehind");
    expect(decision.burst).toBe(true);
    expect(decision.movementTarget.x).toBeGreaterThan(forward.position.x + FIELD.width * 0.07);

    stepMatch(state, 1 / 120);
    expect(forward.sprintTimer).toBeGreaterThan(0);
    expect(forward.pace).toBe("burst");
  });

  it("confirma a troca de posse somente depois de controle sustentado", () => {
    const state = createTestMatch(3210);
    state.kickoffTimer = 0;
    state.elapsed = 20;
    state.possessionTeam = "blue";
    state.ballControlTeam = "blue";
    state.lastControlledTeam = "blue";
    state.controlChangedAt = 18;
    const holder = state.players.find((player) => player.team === "coral" && player.profile.position === "centerMid")!;
    state.players.forEach((player, index) => {
      player.position = player === holder ? { x: FIELD.width / 2, y: FIELD.height / 2 } : { x: 8 + index * 18, y: 8 };
      player.velocity = { x: 0, y: 0 };
    });
    holder.kickCooldown = 100;
    state.ball.controllerId = holder.profile.id;
    state.ball.position = { ...holder.position };
    state.ball.controlStartedAt = state.elapsed;

    for (let tick = 0; tick < Math.floor(POSSESSION.confirmationSeconds * 120) - 2; tick += 1) stepMatch(state, 1 / 120);
    expect(state.possessionTeam).toBe("blue");
    expect(state.stats.coral.turnoversWon).toBe(0);

    for (let tick = 0; tick < 6; tick += 1) stepMatch(state, 1 / 120);
    expect(state.possessionTeam).toBe("coral");
    expect(state.stats.coral.turnoversWon).toBe(1);
    expect(state.tactics.coral.phase).toBe("counterAttack");
  });

  it("mantem a posse confirmada durante um passe em transito", () => {
    const state = createTestMatch(411);
    state.kickoffTimer = 0;
    state.elapsed = 12;
    state.possessionTeam = "blue";
    state.ballControlTeam = "blue";
    state.lastControlledTeam = "blue";
    state.ball.controllerId = null;
    state.pendingPass = {
      passerId: "nilo-mid", receiverId: "nilo-fw", team: "blue", startedAt: state.elapsed,
      trajectory: "ground", range: "short", targeting: "space", selectionReason: "progressivePass",
      target: { x: FIELD.width * 0.55, y: FIELD.height * 0.42 },
      landingPoint: { x: FIELD.width * 0.55, y: FIELD.height * 0.42 }, expectedArrivalAt: state.elapsed + 0.8,
      receiverEta: 0.6, opponentEta: 1.2,
    };
    state.ball.position = { x: FIELD.width * 0.45, y: FIELD.height * 0.42 };
    state.ball.velocity = { x: 16, y: 0 };

    for (let tick = 0; tick < 24; tick += 1) stepMatch(state, 1 / 120);

    expect(state.possessionTeam).toBe("blue");
    expect(state.ballControlTeam).toBe("blue");
    expect(state.stats.coral.turnoversWon).toBe(0);
  });

  it("mantem um plano entre ciclos e o invalida quando o controlador muda", () => {
    const state = createTestMatch(701);
    state.kickoffTimer = 0;
    state.elapsed = 8;
    const blue = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
    const coral = state.players.find((player) => player.team === "coral" && player.profile.position === "centerMid")!;
    blue.kickCooldown = 100;
    coral.kickCooldown = 100;
    state.ball.controllerId = blue.profile.id;
    state.ball.position = { ...blue.position };
    state.ball.controlStartedAt = state.elapsed;
    state.possessionTeam = "blue";
    state.ballControlTeam = "blue";
    state.lastControlledTeam = "blue";

    stepMatch(state, 1 / 120);
    const startedAt = blue.plan?.startedAt;
    for (let tick = 0; tick < 8; tick += 1) stepMatch(state, 1 / 120);
    expect(blue.plan?.startedAt).toBe(startedAt);

    state.ball.controllerId = coral.profile.id;
    state.ball.position = { ...coral.position };
    state.ball.controlStartedAt = state.elapsed;
    stepMatch(state, 1 / 120);
    expect(blue.plan?.controllerId).toBe(coral.profile.id);
    expect(blue.plan?.startedAt).toBeGreaterThan(startedAt ?? 0);
  });

  it("mantem o objetivo de apoio e acompanha o portador sem recriar o plano", () => {
    const state = createTestMatch(1701);
    state.kickoffTimer = 0;
    state.elapsed = 18;
    const controller = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
    const supporter = state.players.find((player) => player.team === "blue" && player !== controller && player.profile.position !== "goalkeeper")!;
    state.ball.controllerId = controller.profile.id;
    state.ball.position = { ...controller.position };
    state.possessionTeam = "blue";
    state.ballControlTeam = "blue";
    const plans = planAll(state);
    supporter.plan = plans.get(supporter.profile.id)!;
    const plan = supporter.plan;
    const before = resolvePlanDecision(supporter, state).movementTarget;

    controller.position.x += 9;
    controller.position.y += 4;
    const after = resolvePlanDecision(supporter, state).movementTarget;

    expect(supporter.plan).toBe(plan);
    expect(after.x - before.x).toBeCloseTo(9, 5);
    expect(after.y - before.y).toBeCloseTo(4, 5);
  });

  it("acompanha um alvo marcado sem trocar o plano", () => {
    const state = createTestMatch(901);
    state.kickoffTimer = 0;
    state.elapsed = 15;
    const controller = state.players.find((player) => player.team === "coral" && player.profile.position === "centerMid")!;
    state.ball.controllerId = controller.profile.id;
    state.ball.position = { ...controller.position };
    state.possessionTeam = "coral";
    state.ballControlTeam = "coral";
    state.lastControlledTeam = "coral";
    const blueOutfield = state.players.filter((player) => player.team === "blue" && player.profile.position !== "goalkeeper");
    const blueDefender = blueOutfield.find((player) => player.profile.role === "defender")!;
    blueDefender.position = { x: controller.position.x - 5, y: controller.position.y };
    blueDefender.profile.mental.aggression = 100;
    blueDefender.profile.mental.intensity = 100;
    for (const player of blueOutfield.filter((candidate) => candidate !== blueDefender)) {
      player.position = { x: controller.position.x - 28, y: player.position.y };
      player.profile.mental.aggression = 1;
      player.profile.mental.intensity = 1;
    }
    const plans = planAll(state);
    for (const player of state.players) player.plan = plans.get(player.profile.id)!;
    const marker = state.players.find((player) => player.plan?.target.kind === "player")!;
    const targetId = marker.plan!.target.kind === "player" ? marker.plan!.target.playerId : "";
    const target = state.players.find((player) => player.profile.id === targetId)!;
    const before = resolvePlanDecision(marker, state).movementTarget;
    const startedAt = marker.plan!.startedAt;
    target.position = { x: target.position.x + 5, y: target.position.y - 3 };
    const after = resolvePlanDecision(marker, state).movementTarget;

    expect(after.x - before.x).toBeCloseTo(5, 5);
    expect(after.y - before.y).toBeCloseTo(-3, 5);
    expect(marker.plan!.startedAt).toBe(startedAt);
  });

  it("usa latch e cooldown nas entradas do terco final", () => {
    const state = createTestMatch(1001);
    state.kickoffTimer = 0;
    state.elapsed = 10;
    state.possessionTeam = "blue";
    state.ballControlTeam = "blue";
    state.lastControlledTeam = "blue";
    state.ball.position.x = FIELD.width * 0.7;
    updateTacticalContext(state, 0);
    expect(state.stats.blue.finalThirdEntries).toBe(1);

    state.ball.position.x = FIELD.width * 0.66;
    updateTacticalContext(state, 0);
    state.ball.position.x = FIELD.width * 0.7;
    updateTacticalContext(state, 0);
    expect(state.stats.blue.finalThirdEntries).toBe(1);

    state.ball.position.x = FIELD.width * 0.57;
    updateTacticalContext(state, 0);
    state.elapsed = 10 + POSSESSION.finalThirdEntryCooldown + 0.1;
    state.ball.position.x = FIELD.width * 0.7;
    updateTacticalContext(state, 0);
    expect(state.stats.blue.finalThirdEntries).toBe(2);
  });

  it("aplica lateral para o adversario do ultimo toque", () => {
    const state = createTestMatch(123);
    state.kickoffTimer = 0;
    state.ball.controllerId = null;
    state.ball.lastTouch = "blue";
    state.ball.position = { x: FIELD.width * 0.7, y: -FIELD.ballRadius - 0.1 };
    state.ball.velocity = { x: 0, y: 0 };

    stepMatch(state, 1 / 120);

    expect(state.possessionTeam).toBe("coral");
    expect(state.events[0]).toMatchObject({ type: "restart-awarded", team: "coral", restartKind: "throwIn" });
    expect(state.ball.position.y).toBeGreaterThan(0);
  });

  it("diferencia escanteio de tiro de meta pelo ultimo toque", () => {
    const corner = createTestMatch(321);
    corner.kickoffTimer = 0;
    corner.ball.controllerId = null;
    corner.ball.lastTouch = "coral";
    corner.ball.position = { x: FIELD.width + FIELD.ballRadius + 0.1, y: FIELD.goalTop - 4 };
    corner.ball.velocity = { x: 0, y: 0 };
    stepMatch(corner, 1 / 120);

    const goalKick = createTestMatch(321);
    goalKick.kickoffTimer = 0;
    goalKick.ball.controllerId = null;
    goalKick.ball.lastTouch = "blue";
    goalKick.ball.position = { x: FIELD.width + FIELD.ballRadius + 0.1, y: FIELD.goalTop - 4 };
    goalKick.ball.velocity = { x: 0, y: 0 };
    stepMatch(goalKick, 1 / 120);

    expect(corner.events[0]).toMatchObject({ type: "restart-awarded", team: "blue", restartKind: "corner" });
    expect(goalKick.events[0]).toMatchObject({ type: "restart-awarded", team: "coral", restartKind: "goalKick" });
  });
});
