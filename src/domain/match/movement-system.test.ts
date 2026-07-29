import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { decideAll } from "./decision";
import { perceive } from "./runtime/ball-situation";
import { FIELD, FIXED_STEP, PHYSICS } from "./config";
import { createMatchState, stepMatch } from "./index";
import { playerSpeedLimit, updatePlayers } from "./systems/movement-system";
import { distance, dot, length, subtract } from "../shared/math";
import type { AgentDecision } from "./model";

const createTestMatch = (seed?: number) => createMatchState(smallSidedMatchConfig(seed));

describe("movimento dos jogadores", () => {
  it("chega ao alvo e para, em vez de orbitá-lo", () => {
    const state = createTestMatch(4242);
    startOpenPlay(state);
    const runner = state.players.find((player) => player.profile.position === "centerMid")!;
    runner.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    runner.velocity = { x: 0, y: 0 };
    const spot = { x: runner.position.x + 30, y: runner.position.y };
    // Cada um com alvo na própria posição: mede-se o corredor, não a partida.
    const decisions = new Map(state.players.map((player) => [player.profile.id, {
      movementTarget: player === runner ? spot : { ...player.position },
      burst: false,
      posture: "outOfPossession",
      intent: "covering",
      reason: "holdZone",
      ballAction: { kind: "none" },
    } as AgentDecision]));

    // Ultrapassar o alvo é o sinal do defeito: o vetor até ele inverte de sentido, e o quadro
    // seguinte pede a volta. Mede-se O QUANTO ele passa, não se passa: a acomodação numérica no
    // último milímetro é irrelevante, orbitar meio corpo de distância não é.
    let overshoot = 0;
    for (let tick = 0; tick < 480; tick += 1) {
      const before = subtract(spot, runner.position);
      updatePlayers(state, decisions, FIXED_STEP);
      const after = subtract(spot, runner.position);
      if (dot(before, after) < 0) overshoot = Math.max(overshoot, length(after));
    }

    expect(overshoot).toBeLessThan(runner.radius * 0.1);
    expect(distance(runner.position, spot)).toBeLessThan(runner.radius * 0.5);
    expect(length(runner.velocity)).toBeLessThan(0.5);
  });

  it("mantém a bola colada lenta e diferencia corrida e explosão sem a bola", () => {
    const player = createTestMatch().players[3];
    const walk = playerSpeedLimit(player, false);
    const run = playerSpeedLimit(player, false, true);
    const controlled = playerSpeedLimit(player, true);
    player.sprintTimer = 0.2;
    const controlledWhileSprinting = playerSpeedLimit(player, true);
    const burst = playerSpeedLimit(player, false);
    expect(controlled / walk).toBeCloseTo(PHYSICS.controlledSpeedFactor / PHYSICS.walkSpeedFactor, 5);
    // Conduzir dentro de um pique já lançado é mais rápido que acomodar a bola no pé — e ainda
    // assim mais lento que correr sem ela: conduzir nunca é fugir de quem vem atrás.
    expect(controlledWhileSprinting).toBeGreaterThan(controlled);
    expect(controlledWhileSprinting).toBeLessThan(run);
    expect(controlled).toBeLessThan(run);
    expect(run / walk).toBeCloseTo(PHYSICS.runSpeedFactor / PHYSICS.walkSpeedFactor, 5);
    expect(burst / run).toBeCloseTo(PHYSICS.burstSpeedFactor / PHYSICS.runSpeedFactor, 5);
    expect(burst / run).toBeGreaterThan(1.5);
  });

  it("faz o defensor sustentar a explosão numa disputa por um toque longo", () => {
    const state = createTestMatch(913);
    startOpenPlay(state);
    const attacker = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
    const defender = state.players.find((player) => player.team === "coral" && player.profile.position === "centerBack")!;
    state.ball.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    state.ball.velocity = { x: 30, y: 0 };
    state.ball.controllerId = null;
    state.ball.dribbleOwnerId = attacker.profile.id;
    state.ball.dribbleStyle = "knockOn";
    state.ball.dribbleStartedAt = state.elapsed;
    attacker.position = { x: state.ball.position.x - 5, y: state.ball.position.y };
    defender.position = { x: state.ball.position.x - 24, y: state.ball.position.y };
    // Todo mundo fora do lance: só o portador e o defensor disputam o toque longo. Inclusive os
    // companheiros do portador, que na saída de bola nascem colados na bola.
    state.players.forEach((player, index) => {
      if (player !== attacker && player !== defender) player.position = { x: FIELD.width - 8, y: 8 + index * 14 };
    });

    perceive(state);

    const decision = decideAll(state).get(defender.profile.id)!;

    expect(decision.burst).toBe(true);
    expect(decision.burstDuration).toBeGreaterThan(PHYSICS.burstDuration);
    stepMatch(state, 1 / 120);
    expect(defender.sprintTimer).toBeGreaterThan(PHYSICS.burstDuration);
    expect(defender.pace).toBe("burst");
  });

  it("evita tirar o goleiro do gol para pressionar longe da area", () => {
    const state = createTestMatch();
    startOpenPlay(state);
    state.ball.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    const goalkeeper = state.players.find((player) => player.team === "blue" && player.profile.position === "goalkeeper")!;
    const defender = state.players.find((player) => player.team === "blue" && player.profile.position === "centerBack")!;
    goalkeeper.position = { x: FIELD.width / 2 - 2, y: FIELD.height / 2 };
    defender.position = { x: FIELD.width / 2 + 11, y: FIELD.height / 2 };
    // O resto do time azul recolhido: quem decide a pressão é a distância à bola, e o teste é
    // sobre o goleiro não ser puxado, não sobre quem entre os de linha está mais perto.
    for (const player of state.players) {
      if (player.team === "blue" && player !== goalkeeper && player !== defender) {
        player.position = { x: FIELD.width * 0.2, y: player.position.y };
      }
    }
    perceive(state);
    const decisions = decideAll(state);
    expect(decisions.get(goalkeeper.profile.id)?.intent).toBe("goalkeeping");
    expect(decisions.get(defender.profile.id)?.intent).toBe("pressing");
  });

  it("faz o receptor correr mesmo perto do ponto de recepcao", () => {
    const state = createTestMatch(20260722);
    startOpenPlay(state);
    state.elapsed = 12;
    const receiver = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
    const passer = state.players.find((player) => player.team === receiver.team && player !== receiver)!;
    receiver.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    receiver.velocity = { x: 0, y: 0 };
    // Ninguém mais no corredor: a bola é de quem chega nela, e um companheiro parado no caminho
    // a tomaria com razão — o que se mede aqui é o ritmo de quem vai recebê-la, não quem recebe.
    for (const other of state.players) {
      if (other !== receiver) other.position = { x: 10, y: 6 };
    }
    const target = { x: receiver.position.x + 8, y: receiver.position.y };
    state.ball.position = { x: receiver.position.x - 10, y: receiver.position.y };
    state.ball.velocity = { x: 28, y: 0 };
    state.ball.controllerId = null;
    state.pendingPass = {
      passerId: passer.profile.id,
      receiverId: receiver.profile.id,
      team: receiver.team,
      startedAt: state.elapsed - 0.2,
      trajectory: "ground",
      range: "short",
      targeting: "space",
      selectionReason: "progressivePass",
      target,
      landingPoint: target,
      expectedArrivalAt: state.elapsed + 0.8,
      receiverEta: 0.6,
      opponentEta: 1.4,
    };

    perceive(state);

    const decision = decideAll(state).get(receiver.profile.id)!;
    expect(decision).toMatchObject({ intent: "receiving", reason: "attackReception" });
    stepMatch(state, 1 / 120);
    expect(["run", "burst"]).toContain(receiver.pace);
  });

  it("dispara quando a corrida pela bola esta em aberto", () => {
    const state = createTestMatch(2718);
    startOpenPlay(state);
    state.elapsed = 9;
    const receiver = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
    const passer = state.players.find((player) => player.team === receiver.team && player !== receiver)!;
    const rival = state.players.find((player) => player.team !== receiver.team && player.profile.position === "centerMid")!;
    const target = { x: FIELD.width / 2, y: FIELD.height / 2 };
    receiver.position = { x: target.x - 10, y: target.y };
    // O adversário no páreo pelo MESMO ponto de encontro — que fica onde a bola e o receptor se
    // cruzam, e não no alvo nominal do passe. Medir a corrida até o alvo era o que fazia o motor
    // achar que estava tudo resolvido enquanto o lance era uma dividida. Ele vem lançado: um
    // corpo em movimento chega bem antes de um parado à mesma distância.
    rival.position = { x: target.x - 15, y: target.y + 5 };
    rival.velocity = { x: 10, y: -6 };
    state.players.forEach((player, index) => {
      if (player !== receiver && player !== rival) player.position = { x: 8 + index * 7, y: 8 };
    });
    state.ball.position = { x: target.x - 20, y: target.y };
    state.ball.velocity = { x: 24, y: 0 };
    state.ball.controllerId = null;
    state.pendingPass = {
      passerId: passer.profile.id,
      receiverId: receiver.profile.id,
      team: receiver.team,
      startedAt: state.elapsed - 0.3,
      trajectory: "ground",
      range: "long",
      targeting: "space",
      selectionReason: "progressivePass",
      target,
      landingPoint: target,
      expectedArrivalAt: state.elapsed + 1,
      receiverEta: 0.7,
      opponentEta: 0.9,
    };

    perceive(state);

    const decision = decideAll(state).get(receiver.profile.id)!;
    expect(state.ballSituation.phase).toBe("contested");
    expect(decision.burst).toBe(true);
    stepMatch(state, 1 / 120);
    expect(receiver.pace).toBe("burst");
  });

  it("recalcula o alvo de recepcao depois de um quique ou desvio", () => {
    const state = createTestMatch(31415);
    startOpenPlay(state);
    state.elapsed = 15;
    const receiver = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
    const passer = state.players.find((player) => player.team === receiver.team && player !== receiver)!;
    receiver.position = { x: 48, y: 28 };
    // Campo limpo em volta: quem persegue a bola desviada é quem chega nela, e o teste é sobre
    // o alvo acompanhar a rota nova — não sobre qual companheiro herda o lance.
    for (const other of state.players) {
      if (other !== receiver) other.position = { x: 10, y: 100 };
    }
    const originalLanding = { x: 78, y: 30 };
    state.ball.position = { x: 53, y: 31 };
    state.ball.velocity = { x: 2, y: 24 };
    state.ball.height = 0;
    state.ball.verticalVelocity = 0;
    state.ball.controllerId = null;
    state.pendingPass = {
      passerId: passer.profile.id,
      receiverId: receiver.profile.id,
      team: receiver.team,
      startedAt: state.elapsed - 0.7,
      trajectory: "air",
      range: "long",
      targeting: "space",
      selectionReason: "progressivePass",
      target: originalLanding,
      landingPoint: originalLanding,
      expectedArrivalAt: state.elapsed + 0.8,
      receiverEta: 0.9,
      opponentEta: 1.2,
    };

    perceive(state);

    const decision = decideAll(state).get(receiver.profile.id)!;

    expect(decision.intent).toBe("receiving");
    expect(decision.movementTarget.y).toBeGreaterThan(40);
    expect(decision.movementTarget).not.toEqual(originalLanding);
  });

});
