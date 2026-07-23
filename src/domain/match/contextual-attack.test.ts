import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { decideAll } from "./ai";
import { FIELD } from "./config";
import { createMatchState } from "./index";
import { emitCognitiveEvent } from "./runtime/cognitive-events";
import { classifyPassPurpose } from "./runtime/pass-purpose";
import { evaluateShotOpportunity } from "./runtime/shot-opportunity";
import { executeBallAction } from "./systems/ball-system";
import { updateCognition } from "./systems/cognition-system";
import { updatePossession } from "./systems/possession-system";
import { updateTacticalContext } from "./systems/tactics-system";

const createTestMatch = (seed = 7401) => createMatchState(buildMatchConfig(createDefaultProfile(), seed));

describe("ataque contextual e eventos cognitivos", () => {
  it("distingue cruzamento, cutback, profundidade e inversao pela geometria", () => {
    const state = createTestMatch();
    const passer = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    const receiver = state.players.find((player) => player.team === "blue" && player.profile.position === "forward")!;
    passer.position = { x: FIELD.width * 0.72, y: FIELD.height * 0.12 };
    receiver.position = { x: FIELD.width * 0.86, y: FIELD.height * 0.5 };
    expect(classifyPassPurpose(passer, receiver, receiver.position, "air", "space")).toBe("cross");
    passer.position.x = FIELD.width * 0.9;
    expect(classifyPassPurpose(passer, receiver, { x: FIELD.width * 0.84, y: FIELD.height * 0.5 }, "ground", "feet")).toBe("cutback");
    passer.position = { x: FIELD.width * 0.3, y: FIELD.height * 0.45 };
    expect(classifyPassPurpose(passer, receiver, { x: FIELD.width * 0.58, y: FIELD.height * 0.5 }, "ground", "space")).toBe("throughBall");
    passer.position = { x: FIELD.width * 0.45, y: FIELD.height * 0.12 };
    expect(classifyPassPurpose(passer, receiver, { x: FIELD.width * 0.5, y: FIELD.height * 0.82 }, "air", "feet")).toBe("switch");
  });

  it("acorda o receptor no passe e encerra receiving quando ele controla", () => {
    const state = createTestMatch(7402);
    state.kickoffTimer = 0;
    state.elapsed = 12;
    const passer = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    const receiver = state.players.find((player) => player.team === "blue" && player.profile.position === "forward")!;
    state.ball.controllerId = passer.profile.id;
    state.ball.position = { ...passer.position };
    state.ball.controlStartedAt = 10;
    state.possessionTeam = "blue";
    executeBallAction(state, passer, {
      kind: "pass", receiverId: receiver.profile.id, target: receiver.position, trajectory: "ground",
      range: "short", targeting: "feet", purpose: "feet", power: 0.65,
    });
    expect(state.cognitiveEvents.at(-1)?.type).toBe("passCommitted");
    updateCognition(state);
    expect(receiver.plan?.intent).toBe("receiving");
    const unrelated = state.players.find((player) => player.team === "blue" && player.profile.position === "goalkeeper")!;
    const unrelatedPlan = unrelated.plan;
    state.ball.controllerId = receiver.profile.id;
    state.pendingPass = null;
    emitCognitiveEvent(state, "controlClaimed", [receiver.profile.id], { controllerId: receiver.profile.id });
    updateCognition(state);
    expect(receiver.plan?.intent).not.toBe("receiving");
    expect(unrelated.plan).toBe(unrelatedPlan);
  });

  it("faz um interceptador alcancavel preparar a continuacao da disputa", () => {
    const state = createTestMatch(7410);
    state.kickoffTimer = 0;
    state.elapsed = 8;
    const receiver = state.players.find((player) => player.team === "blue" && player.profile.position === "forward")!;
    const interceptor = state.players.find((player) => player.team === "coral" && player.profile.position === "centerBack")!;
    receiver.position = { x: FIELD.width * 0.55, y: FIELD.height / 2 };
    interceptor.position = { x: receiver.position.x + 5, y: receiver.position.y };
    state.pendingPass = {
      id: 11, passerId: "nilo-mid", receiverId: receiver.profile.id, team: "blue", startedAt: 7.5,
      trajectory: "ground", range: "short", targeting: "feet", purpose: "feet", selectionReason: "progressivePass",
      target: { ...receiver.position }, landingPoint: { ...receiver.position }, expectedArrivalAt: 8.5,
      receiverEta: 0.4, opponentEta: 0.45, expectedHeight: 0, expectedSpeed: 24,
    };
    emitCognitiveEvent(state, "passCommitted", [receiver.profile.id, interceptor.profile.id], { passId: 11 });
    updateCognition(state);
    expect(interceptor.plan?.preparedReceptionAction).toMatchObject({ passId: 11, kind: "control", fallback: "protectBall" });
  });

  it("finaliza um cruzamento preparado sem criar dominio magnetico", () => {
    const state = createTestMatch(7403);
    state.kickoffTimer = 0;
    state.elapsed = 20;
    const passer = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
    const receiver = state.players.find((player) => player.team === "blue" && player.profile.position === "forward")!;
    receiver.position = { x: FIELD.width * 0.82, y: FIELD.height / 2 };
    receiver.profile.skills.finishing = 100;
    receiver.profile.skills.control = 100;
    receiver.profile.mental.anticipation = 100;
    receiver.profile.mental.composure = 100;
    passer.position = { x: FIELD.width * 0.76, y: FIELD.height * 0.12 };
    state.players.filter((player) => player.team === "coral" && player.profile.position !== "goalkeeper")
      .forEach((player, index) => { player.position = { x: FIELD.width * 0.55, y: 12 + index * 18 }; });
    state.ball.controllerId = null;
    state.ball.position = { x: receiver.position.x - 2.5, y: receiver.position.y };
    state.ball.velocity = { x: 10, y: 0 };
    state.ball.height = 1.25;
    state.ball.verticalVelocity = -1;
    state.pendingPass = {
      id: 9, passerId: passer.profile.id, receiverId: receiver.profile.id, team: "blue", startedAt: 19,
      trajectory: "air", range: "long", targeting: "space", purpose: "cross", selectionReason: "progressivePass",
      target: { ...receiver.position }, landingPoint: { ...receiver.position }, expectedArrivalAt: 20.1,
      receiverEta: 0.1, opponentEta: 0.8, expectedHeight: 1.2, expectedSpeed: 10,
    };
    updateCognition(state);
    expect(["shot", "redirect"]).toContain(receiver.plan?.preparedReceptionAction?.kind);
    state.elapsed = 20.1;
    updatePossession(state, 0);
    expect(state.ball.controllerId).toBeNull();
    expect(state.ball.lastAction).toBe("shot");
    expect(state.stats.blue.firstTimeShots).toBe(1);
    expect(state.ball.height).toBeGreaterThan(0);
  });

  it("leva a linha de seguranca alem do meio quando bola e ameacas permitem", () => {
    const state = createTestMatch(7404);
    state.kickoffTimer = 0;
    state.elapsed = 30;
    const carrier = state.players.find((player) => player.team === "blue" && player.profile.position === "forward")!;
    carrier.position = { x: FIELD.width * 0.88, y: FIELD.height / 2 };
    state.ball.position = { ...carrier.position };
    state.ball.controllerId = carrier.profile.id;
    state.possessionTeam = "blue";
    state.ballControlTeam = "blue";
    state.players.filter((player) => player.team === "coral" && player.profile.position !== "goalkeeper")
      .forEach((player, index) => { player.position = { x: FIELD.width * (0.7 + index * 0.035), y: 20 + index * 22 }; });
    updateTacticalContext(state, 0);
    const safetyId = state.tactics.blue.collectivePlan?.safetyPlayerId;
    const safetyDecision = decideAll(state).get(safetyId!)!;
    expect(safetyDecision.reason).toBe("restDefense");
    expect(safetyDecision.movementTarget.x).toBeGreaterThan(FIELD.width / 2);
    expect(safetyDecision.movementTarget.x).toBeLessThan(carrier.position.x);
  });

  it("sustenta avanco agressivo em campo proprio com corredor livre", () => {
    const state = createTestMatch(7405);
    state.kickoffTimer = 0;
    state.elapsed = 40;
    const carrier = state.players.find((player) => player.team === "blue" && player.profile.position === "forward")!;
    carrier.position = { x: FIELD.width * 0.24, y: FIELD.height / 2 };
    carrier.objective = "aggressiveBreak";
    carrier.objectiveExpiresAt = 42;
    carrier.sprintEnergy = 0.9;
    state.players.filter((player) => player.team === "blue" && player !== carrier)
      .forEach((player, index) => { player.position = { x: 10 + index * 7, y: 10 + index * 25 }; });
    state.players.filter((player) => player.team === "coral")
      .forEach((player, index) => { player.position = { x: FIELD.width * 0.78, y: index % 2 ? 10 : FIELD.height - 10 }; });
    state.ball.position = { ...carrier.position };
    state.ball.controllerId = carrier.profile.id;
    state.ball.controlStartedAt = 38;
    state.possessionTeam = "blue";
    state.ballControlTeam = "blue";
    updateTacticalContext(state, 0);
    const decision = decideAll(state).get(carrier.profile.id)!;
    expect(decision.reason).toBe("aggressiveBreak");
    expect(decision.ballAction.kind).toBe("dribble");
  });

  it("habilita chute distante pela potencia sem liberar o jogador fraco", () => {
    const state = createTestMatch(7406);
    const shooter = state.players.find((player) => player.team === "blue" && player.profile.position === "forward")!;
    shooter.position = { x: FIELD.width - FIELD.width * 0.33, y: FIELD.height / 2 };
    const opponents = state.players.filter((player) => player.team !== shooter.team);
    opponents.filter((player) => player.profile.position !== "goalkeeper")
      .forEach((player, index) => { player.position = { x: FIELD.width * 0.3, y: 10 + index * 20 }; });
    shooter.profile.skills.kickPower = 95;
    expect(evaluateShotOpportunity(shooter, opponents, state)).not.toBeNull();
    shooter.profile.skills.kickPower = 20;
    expect(evaluateShotOpportunity(shooter, opponents, state)).toBeNull();
  });
});
