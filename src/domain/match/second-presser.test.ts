import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig } from "./__fixtures__/reference-match";
import { decideAll } from "./ai";
import { FIELD } from "./config";
import { createMatchState } from "./index";
import { updateTacticalContext } from "./systems/tactics-system";
import type { MatchState, PlayerRuntime } from "./model";

const createTestMatch = (seed = 7) => createMatchState(smallSidedMatchConfig(seed));

const parkOthers = (state: MatchState, keep: PlayerRuntime[]): void => {
  state.players.forEach((player, index) => {
    if (keep.includes(player)) return;
    player.position = { x: FIELD.width - 18, y: 6 + index * 4 };
    player.kickCooldown = 5;
  });
};

describe("segundo engajador na zona de perigo (Item 1)", () => {
  it("manda um zagueiro sair da linha quando a bola entra no terço defensivo sem pressão", () => {
    const state = createTestMatch();
    state.kickoffTimer = 0;
    const carrier = state.players.find((p) => p.team === "coral" && p.profile.position === "centerMid")!;
    const presser = state.players.find((p) => p.team === "blue" && p.profile.position === "striker")!;
    const stepper = state.players.find((p) => p.team === "blue" && p.profile.position === "centerBack")!;
    carrier.position = { x: FIELD.width * 0.24, y: FIELD.height / 2 };
    carrier.velocity = { x: 0, y: 0 };
    // 1º presser (atacante) mais perto da bola, porém fora do raio de pressão
    presser.position = { x: carrier.position.x + 22, y: carrier.position.y };
    presser.profile.mental.aggression = 95;
    presser.profile.mental.intensity = 95;
    presser.profile.mental.anticipation = 95;
    // zagueiro de cobertura dentro do alcance de engajamento
    stepper.position = { x: carrier.position.x + 34, y: carrier.position.y };
    parkOthers(state, [carrier, presser, stepper]);
    state.ball.position = { ...carrier.position };
    state.ball.velocity = { x: 0, y: 0 };
    state.ball.controllerId = carrier.profile.id;
    state.ball.lastTouch = carrier.team;
    state.ball.lastTouchPlayerId = carrier.profile.id;

    updateTacticalContext(state, 0);
    const plan = state.tactics.blue.collectivePlan!;
    expect(plan.presserId).toBe(presser.profile.id);
    expect(plan.secondPresserId).toBe(stepper.profile.id);

    const decision = decideAll(state).get(stepper.profile.id)!;
    expect(decision.intent).toBe("pressing");
    expect(decision.reason).toBe("pressBall");
    expect(decision.burst).toBe(true);
  });

  it("não convoca segundo engajador com a bola no meio-campo", () => {
    const state = createTestMatch();
    state.kickoffTimer = 0;
    const carrier = state.players.find((p) => p.team === "coral" && p.profile.position === "centerMid")!;
    const presser = state.players.find((p) => p.team === "blue" && p.profile.position === "striker")!;
    const stepper = state.players.find((p) => p.team === "blue" && p.profile.position === "centerBack")!;
    carrier.position = { x: FIELD.width * 0.5, y: FIELD.height / 2 };
    presser.position = { x: carrier.position.x + 22, y: carrier.position.y };
    stepper.position = { x: carrier.position.x + 34, y: carrier.position.y };
    parkOthers(state, [carrier, presser, stepper]);
    state.ball.position = { ...carrier.position };
    state.ball.controllerId = carrier.profile.id;

    updateTacticalContext(state, 0);
    expect(state.tactics.blue.collectivePlan!.secondPresserId).toBeNull();
  });
});
