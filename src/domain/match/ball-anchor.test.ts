import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { FIELD, SHIELD } from "./config";
import { createMatchState } from "./index";
import { updateControlledBall } from "./systems/ball-system";
import type { AgentDecision, MatchState, PlayerRuntime } from "./model";

const createTestMatch = (seed = 7) => createMatchState(smallSidedMatchConfig(seed));

const holdingStill = (player: PlayerRuntime): AgentDecision => ({
  movementTarget: { ...player.position },
  burst: false,
  posture: "inPossession",
  intent: "carrying",
  reason: "carryIntoSpace",
  ballAction: { kind: "none" },
});

/** Põe o portador no centro olhando para +x, com um marcador colado no lado pedido. */
const scenario = (markerSide: number): { state: MatchState; carrier: PlayerRuntime } => {
  const state = createTestMatch();
  startOpenPlay(state);
  const carrier = state.players.find((p) => p.team === "blue" && p.profile.position === "centerMid")!;
  const marker = state.players.find((p) => p.team === "coral" && p.profile.position === "centerBack")!;
  carrier.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
  carrier.velocity = { x: 0, y: 0 };
  carrier.facing = { x: 1, y: 0 };
  marker.position = { x: carrier.position.x, y: carrier.position.y + markerSide * (carrier.radius + marker.radius + 0.4) };
  state.players.forEach((player) => {
    if (player !== carrier && player !== marker) player.position = { x: FIELD.width - 6, y: 4 };
  });
  state.ball.position = { x: carrier.position.x + carrier.radius + state.ball.radius + 0.15, y: carrier.position.y };
  state.ball.controllerId = carrier.profile.id;
  state.ball.lastTouchPlayerId = carrier.profile.id;
  return { state, carrier };
};

const settleAnchor = (state: MatchState, seconds = 0.6): void => {
  const decisions = new Map(state.players.map((player) => [player.profile.id, holdingStill(player)]));
  for (let tick = 0; tick < seconds * 120; tick += 1) updateControlledBall(state, decisions, 1 / 120);
};

describe("proteção de bola — a âncora tira a bola do nariz", () => {
  it("com um marcador colado de um lado, a bola assenta do lado oposto do corpo", () => {
    const above = scenario(1); // marcador em +y
    settleAnchor(above.state);
    const below = scenario(-1); // marcador em −y
    settleAnchor(below.state);

    // O corpo fica entre a bola e quem pressiona: bola para o lado contrário ao marcador.
    expect(above.state.ball.position.y).toBeLessThan(above.carrier.position.y);
    expect(below.state.ball.position.y).toBeGreaterThan(below.carrier.position.y);
    expect(Math.abs(above.carrier.ballAnchor)).toBeGreaterThan(0.5);
    expect(above.carrier.ballAnchor).toBeCloseTo(-below.carrier.ballAnchor, 6);
  });

  it("sem ninguém por perto a bola continua à frente, como sempre esteve", () => {
    const { state, carrier } = scenario(1);
    state.players.forEach((player) => {
      if (player !== carrier) player.position = { x: FIELD.width - 6, y: 4 };
    });
    settleAnchor(state);

    expect(carrier.ballAnchor).toBeCloseTo(0, 6);
    expect(state.ball.position.x).toBeGreaterThan(carrier.position.x);
  });

  it("a bola contorna o corpo em velocidade finita, sem saltar para a âncora", () => {
    const { state, carrier } = scenario(1);
    const decisions = new Map(state.players.map((player) => [player.profile.id, holdingStill(player)]));
    const dt = 1 / 120;
    let previous = { ...state.ball.position };
    let largestStep = 0;
    for (let tick = 0; tick < 0.6 * 120; tick += 1) {
      updateControlledBall(state, decisions, dt);
      largestStep = Math.max(largestStep, Math.hypot(state.ball.position.x - previous.x, state.ball.position.y - previous.y));
      previous = { ...state.ball.position };
    }
    // Um passo de âncora não pode passar do que a taxa de giro permite no raio de condução.
    const anchorRadius = carrier.radius + state.ball.radius + 0.15;
    expect(largestStep).toBeLessThan(SHIELD.turnRate * dt * anchorRadius * 2);
  });
});
