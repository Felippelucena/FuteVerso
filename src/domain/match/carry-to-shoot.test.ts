import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig } from "./__fixtures__/reference-match";
import { decideAll } from "./ai";
import { FIELD } from "./config";
import { createMatchState } from "./index";
import { evaluateShotOpportunity } from "./runtime/shot-opportunity";

const createTestMatch = (seed = 3) => createMatchState(smallSidedMatchConfig(seed));

describe("lookahead condução→finalização (Item 3)", () => {
  it("avalia o chute a partir de uma posição futura: mais perto e livre supera a atual bloqueada", () => {
    const state = createTestMatch();
    const shooter = state.players.find((p) => p.team === "blue" && p.profile.position === "striker")!;
    const blocker = state.players.find((p) => p.team === "coral" && p.profile.position === "centerBack")!;
    const keeper = state.players.find((p) => p.team === "coral" && p.profile.position === "goalkeeper")!;
    shooter.profile.skills.kickPower = 75;
    shooter.profile.skills.finishing = 80;
    shooter.position = { x: FIELD.width * 0.8, y: FIELD.height / 2 };
    shooter.facing = { x: 1, y: 0 };
    blocker.position = { x: FIELD.width * 0.9, y: FIELD.height * 0.451 }; // na linha do chute atual
    blocker.velocity = { x: 0, y: 0 };
    keeper.position = { x: FIELD.width, y: FIELD.height / 2 };
    const opponents = state.players.filter((p) => p.team === "coral");

    const shotNow = evaluateShotOpportunity(shooter, opponents, state);
    const ahead = { x: FIELD.width * 0.94, y: FIELD.height / 2 };
    const shotAhead = evaluateShotOpportunity(shooter, opponents, state, false, undefined, { position: ahead, facing: { x: 1, y: 0 } });

    expect(shotNow).not.toBeNull();
    expect(shotAhead).not.toBeNull();
    expect(shotAhead!.distance).toBeLessThan(shotNow!.distance);
    expect(shotNow!.blocked).toBe(true);
    expect(shotAhead!.blocked).toBe(false);
    expect(shotAhead!.utility).toBeGreaterThan(shotNow!.utility);
  });

  it("prefere conduzir rumo ao gol a tabelar para trás quando a condução abre um chute muito melhor", () => {
    const state = createTestMatch(11);
    state.kickoffTimer = 0;
    state.elapsed = 8;
    const carrier = state.players.find((p) => p.team === "coral" && p.profile.position === "centerMid")!;
    const outlet = state.players.find((p) => p.team === "coral" && p.profile.position === "striker")!;
    // coral ataca -x (gol em x=0); portador é a ponta de lança
    carrier.position = { x: FIELD.width * 0.28, y: FIELD.height / 2 };
    carrier.velocity = { x: -2, y: 0 };
    carrier.facing = { x: -1, y: 0 };
    carrier.profile.skills.control = 90;
    carrier.profile.skills.burst = 90;
    carrier.profile.skills.kickPower = 35; // chute direto de ~72u fica FORA de alcance (~69u)
    carrier.sprintEnergy = 1;
    carrier.memory.policy.dribble = 0.6;
    carrier.memory.policy.pass = 0.4;
    carrier.profile.mental.creativity = 75;
    outlet.position = { x: FIELD.width * 0.5, y: FIELD.height / 2 }; // atrás → passe recuado disponível
    // corredor à frente livre: azuis para fora da rota ao gol
    state.players.filter((p) => p.team === "blue").forEach((p, i) => {
      p.position = { x: FIELD.width * 0.12, y: i % 2 === 0 ? 8 : FIELD.height - 8 };
    });
    const keeper = state.players.find((p) => p.team === "blue" && p.profile.position === "goalkeeper")!;
    keeper.position = { x: FIELD.width * 0.05, y: FIELD.height / 2 };
    state.ball.position = { x: carrier.position.x - 1.6, y: carrier.position.y };
    state.ball.controllerId = carrier.profile.id;
    state.ball.controlStartedAt = state.elapsed - 1;
    state.ball.lastTouch = carrier.team;
    state.ball.lastTouchPlayerId = carrier.profile.id;

    const decision = decideAll(state).get(carrier.profile.id)!;
    expect(decision.ballAction.kind).toBe("dribble");
  });
});
