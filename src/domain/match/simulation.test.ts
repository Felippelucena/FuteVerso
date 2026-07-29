import { describe, expect, it } from "vitest";
import { referenceMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { FIELD, POSSESSION } from "./config";
import { decideAll, planAll, resolvePlanDecision } from "./decision";
import { perceive } from "./runtime/ball-situation";
import { createMatchState, stepMatch } from "./index";
import { distance } from "../shared/math";
import { updateTacticalContext } from "./systems/tactics-system";
import { CALIBRATION } from "./__fixtures__/calibration";

const createTestMatch = (seed?: number) => createMatchState(referenceMatchConfig(seed));

// A medida estatística de partida inteira abaixo é calibragem; fica fora da suíte padrão. Ver
// __fixtures__/calibration (rode com CALIBRATE=1).
describe("qualidade coletiva da simulacao", () => {
  it.runIf(CALIBRATION)("produz uma partida ativa sem colapso permanente em uma lateral", () => {
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

    // Passa do fim nominal para cumprir os acréscimos: a partida encerra entre o tempo nominal e
    // o teto absoluto (nominal + graceCeiling). Para no apito. O limite sai da duração da partida
    // e não de um número cravado, senão o laço acaba antes do jogo quando o regulamento muda.
    const limit = (state.rules.matchDuration + state.rules.stoppage.graceCeiling + 1) * 120;
    for (let tick = 0; tick < limit && !state.finished; tick += 1) {
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
    // Contagem de partida não é invariante à duração — só a taxa é. Os tetos abaixo são por
    // minuto de jogo, senão dobrar o relógio quebra o teste sem que nada tenha piorado.
    const minutes = state.rules.matchDuration / 60;
    const perMinute = (value: number): number => value / minutes;
    // eslint-disable-next-line no-console
    console.info("MATCH_RATES", JSON.stringify({
      minutes,
      goals: state.stats.blue.goals + state.stats.coral.goals,
      shots: totalShots,
      passes: totalPasses,
      turnoversPerMinute: Number(perMinute(state.stats.blue.turnoversWon + state.stats.coral.turnoversWon).toFixed(2)),
      finalThirdPerMinute: Number(perMinute(Math.max(state.stats.blue.finalThirdEntries, state.stats.coral.finalThirdEntries)).toFixed(2)),
      worstTouchlineCrowd,
    }));
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
    expect(state.stats.blue.spatialSeconds).toBeGreaterThan(state.rules.matchDuration * 0.98);
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
    // Teto de troca de posse: o que ele guarda é o jogo não virar pinball. Subiu quando a
    // percepção da bola passou a ser uma corrida (runtime/ball-situation) e o defensor passou a
    // investir na bola adiantada em vez de assistir — mais disputa é mais posse trocando de mão,
    // e é o comportamento pedido. O que continua proibido é o colapso, que os limites de forma,
    // de condução livre e de sequência de posse acima seguem medindo.
    expect(perMinute(state.stats.blue.turnoversWon + state.stats.coral.turnoversWon)).toBeLessThan(15);
    // Knock-ons empurram a bola à frente com mais frequência que a antiga condução colada,
    // então há um pouco mais de entradas no terço final — comportamento desejado, sem colapso.
    expect(perMinute(state.stats.blue.finalThirdEntries)).toBeLessThan(4.2);
    expect(perMinute(state.stats.coral.finalThirdEntries)).toBeLessThan(4.2);
    for (const team of ["blue", "coral"] as const) {
      expect(state.stats[team].shotsOnTarget).toBeLessThanOrEqual(state.stats[team].shots);
      expect(state.stats[team].goalsFromShots + state.stats[team].goalsFromPasses + state.stats[team].goalsFromDribbles)
        .toBe(state.stats[team].goals);
    }
  }, 60_000);

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
  }, 60_000);

  it("muda a fase e coordena funções ofensivas conforme o contexto", () => {
    const state = createTestMatch(456);
    startOpenPlay(state);
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

    perceive(state);

    const decisions = decideAll(state);
    const forward = state.players.find((player) => player.team === "blue" && player.profile.role === "finisher")!;
    const defenders = state.players.filter((player) => player.team === "blue" && player.profile.role === "defender" && player.profile.position !== "goalkeeper");
    expect(decisions.get(forward.profile.id)?.reason).toBe("runInBehind");
    // Com o time avançado, ao menos um defensor segura a retaguarda (rest defense).
    expect(defenders.some((defender) => decisions.get(defender.profile.id)?.reason === "restDefense")).toBe(true);
  });

  it("faz o atacante arrancar para oferecer passe depois de uma retomada defensiva", () => {
    const state = createTestMatch(654);
    startOpenPlay(state);
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

    perceive(state);

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
    startOpenPlay(state);
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
    startOpenPlay(state);
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
    startOpenPlay(state);
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
    // Um quadro de percepção (30 Hz), não um de física: é nele que a troca de portador chega aos
    // vinte e dois. Ver COGNITION.perceptionSeconds.
    for (let tick = 0; tick < 4; tick += 1) stepMatch(state, 1 / 120);
    expect(blue.plan?.controllerId).toBe(coral.profile.id);
    expect(blue.plan?.startedAt).toBeGreaterThan(startedAt ?? 0);
  });

  it("mantem o objetivo de apoio e acompanha o portador sem recriar o plano", () => {
    const state = createTestMatch(1701);
    startOpenPlay(state);
    state.elapsed = 18;
    const controller = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
    const supporter = state.players.find((player) => player.team === "blue" && player !== controller && player.profile.position !== "goalkeeper")!;
    state.ball.controllerId = controller.profile.id;
    state.ball.position = { ...controller.position };
    state.possessionTeam = "blue";
    state.ballControlTeam = "blue";
    updateTacticalContext(state, 0);
    const plans = planAll(state);
    supporter.plan = plans.get(supporter.profile.id)!;
    const plan = supporter.plan;
    const before = resolvePlanDecision(supporter, state).movementTarget;

    controller.position.x += 9;
    controller.position.y += 4;
    const after = resolvePlanDecision(supporter, state).movementTarget;

    // Acompanha o portador em profundidade, mas não é rebocado 1:1: a parte do alvo que veio da
    // célula não viaja com ele. Rebocar tudo era o que soldava o bloco de apoio no portador e
    // fazia o alvo estalar de volta a cada replanejamento.
    expect(after.x - before.x).toBeGreaterThan(0);
    expect(after.x - before.x).toBeLessThan(9);

    // E a outra metade: a âncora é viva. Mexer a colocação do bloco move o alvo, sem plano novo.
    const shifted = (() => {
      state.tactics.blue.collectivePlan!.placement.lineHeight += 6;
      return resolvePlanDecision(supporter, state).movementTarget;
    })();
    expect(Math.abs(shifted.x - after.x)).toBeGreaterThan(1);
    expect(supporter.plan).toBe(plan);
  });

  it("afasta o alvo do companheiro que ja ocupa o palmo de grama, mas nao perto da bola", () => {
    const state = createTestMatch(3311);
    startOpenPlay(state);
    state.elapsed = 20;
    const [first, second] = state.players.filter((player) => player.team === "blue"
      && player.profile.position !== "goalkeeper");
    const spot = { x: FIELD.width * 0.5, y: FIELD.height * 0.5 };
    // Bola bem longe: o que se mede é a ocupação do espaço, não a disputa.
    state.ball.position = { x: FIELD.width * 0.06, y: FIELD.height * 0.9 };
    state.ball.controllerId = null;
    perceive(state);
    // Só os dois no lance: qualquer outro companheiro perto do ponto contaminaria a medida.
    state.players.forEach((player, index) => {
      if (player !== first && player !== second) player.position = { x: FIELD.width * 0.04, y: 4 + index * 6 };
    });
    first.position = { x: spot.x - 20, y: spot.y };
    second.position = { x: FIELD.width * 0.9, y: FIELD.height * 0.1 };
    first.plan = { ...planAll(state).get(first.profile.id)!, target: { kind: "point", position: spot } };

    expect(distance(resolvePlanDecision(first, state).movementTarget, spot)).toBeLessThan(0.001);

    second.position = { x: spot.x + 1, y: spot.y };
    const crowded = resolvePlanDecision(first, state).movementTarget;
    // A colisão sozinha separa exatamente no encosto dos corpos; o espaço pessoal abre MAIS que
    // isso — é esse excedente que distingue posicionar-se de se empurrar.
    expect(distance(crowded, second.position)).toBeGreaterThan(first.radius + second.radius);

    // Alvo ancorado na bola não tem espaço pessoal: disputá-la é o jogo.
    first.plan = { ...first.plan, target: { kind: "ball", offset: { x: 0, y: 0 } }, intent: "pressing" };
    state.ball.position = { ...spot };
    expect(distance(resolvePlanDecision(first, state).movementTarget, spot)).toBeLessThan(0.001);
  });

  it("acompanha um alvo marcado sem trocar o plano", () => {
    const state = createTestMatch(901);
    startOpenPlay(state);
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
    // A marcação sai do plano coletivo (`resolveMarking` lê os deveres): sem ele não há marcador
    // nenhum para medir — e era por isso que este teste achava um APOIADOR coral por acidente.
    updateTacticalContext(state, 0);
    const plans = planAll(state);
    for (const player of state.players) player.plan = plans.get(player.profile.id)!;
    const marker = state.players.find((player) => player.team === "blue" && player.plan?.intent === "marking")!;
    expect(marker).toBeDefined();
    const targetId = marker.plan!.target.kind === "anchored" ? marker.plan!.target.bodyId : null;
    const target = state.players.find((player) => player.profile.id === targetId)!;
    expect(target).toBeDefined();
    const before = resolvePlanDecision(marker, state).movementTarget;
    const startedAt = marker.plan!.startedAt;
    target.position = { x: target.position.x + 5, y: target.position.y - 3 };
    const after = resolvePlanDecision(marker, state).movementTarget;

    // Vai com o homem, ao vivo e sem plano novo. O quanto ele vai junto é a firmeza da marcação
    // (`bodyShare`), que a situação decide — cravar 1:1 aqui amarraria o teste à calibragem dela.
    expect(after.x - before.x).toBeGreaterThan(0);
    expect(after.y - before.y).toBeLessThan(0);
    expect(marker.plan!.startedAt).toBe(startedAt);
  });

  it("usa latch e cooldown nas entradas do terco final", () => {
    const state = createTestMatch(1001);
    startOpenPlay(state);
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

  // Mesmo mecanismo do terço final, aplicado à grande área: a segunda zona existe justamente para
  // provar que a regra é uma só. Contar por quadro daria dezenas de entradas numa investida.
  it("usa latch e cooldown nas entradas da area", () => {
    const state = createTestMatch(1001);
    startOpenPlay(state);
    state.elapsed = 10;
    state.possessionTeam = "blue";
    state.ballControlTeam = "blue";
    state.lastControlledTeam = "blue";
    state.ball.position = { x: FIELD.width - 5, y: FIELD.height / 2 };
    for (let tick = 0; tick < 12; tick += 1) updateTacticalContext(state, 0);
    expect(state.stats.blue.boxEntries).toBe(1);

    // Saiu da área, mas não recuou o bastante para rearmar: voltar não é entrada nova.
    state.ball.position.x = FIELD.width * 0.8;
    updateTacticalContext(state, 0);
    state.ball.position.x = FIELD.width - 5;
    updateTacticalContext(state, 0);
    expect(state.stats.blue.boxEntries).toBe(1);

    state.ball.position.x = FIELD.width * 0.7;
    updateTacticalContext(state, 0);
    state.elapsed = 10 + POSSESSION.boxEntryCooldown + 0.1;
    state.ball.position.x = FIELD.width - 5;
    updateTacticalContext(state, 0);
    expect(state.stats.blue.boxEntries).toBe(2);
  });

  it("aplica lateral para o adversario do ultimo toque", () => {
    const state = createTestMatch(123);
    startOpenPlay(state);
    state.ball.controllerId = null;
    state.ball.lastTouch = "blue";
    state.ball.position = { x: FIELD.width * 0.7, y: -FIELD.ballRadius - 0.1 };
    state.ball.velocity = { x: 0, y: 0 };

    stepMatch(state, 1 / 120);

    // A cobrança é armada para o adversário; a posse só vem quando o cobrador assume (walk-in).
    expect(state.restart).toMatchObject({ kind: "throwIn", team: "coral", ballInPlay: false });
    expect(state.events[0]).toMatchObject({ type: "restart-awarded", team: "coral", restartKind: "throwIn" });
    // A bola volta para a linha lateral (saiu por cima em y<0); o cobrador é quem fica de fora.
    expect(state.ball.position.y).toBeGreaterThanOrEqual(0);
    expect(state.ball.position.y).toBeLessThan(FIELD.height);
  });

  it("diferencia escanteio de tiro de meta pelo ultimo toque", () => {
    const corner = createTestMatch(321);
    startOpenPlay(corner);
    corner.ball.controllerId = null;
    corner.ball.lastTouch = "coral";
    corner.ball.position = { x: FIELD.width + FIELD.ballRadius + 0.1, y: FIELD.goalTop - 4 };
    corner.ball.velocity = { x: 0, y: 0 };
    stepMatch(corner, 1 / 120);

    const goalKick = createTestMatch(321);
    startOpenPlay(goalKick);
    goalKick.ball.controllerId = null;
    goalKick.ball.lastTouch = "blue";
    goalKick.ball.position = { x: FIELD.width + FIELD.ballRadius + 0.1, y: FIELD.goalTop - 4 };
    goalKick.ball.velocity = { x: 0, y: 0 };
    stepMatch(goalKick, 1 / 120);

    expect(corner.events[0]).toMatchObject({ type: "restart-awarded", team: "blue", restartKind: "corner" });
    expect(goalKick.events[0]).toMatchObject({ type: "restart-awarded", team: "coral", restartKind: "goalKick" });
  });
});
