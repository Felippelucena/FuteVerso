import { describe, expect, it } from "vitest";
import { REFERENCE_PLAYERS, referenceMatchConfig } from "../match/__fixtures__/reference-match";
import { decideAll, thinkingInterval } from "../match/ai";
import { FIELD } from "../match/config";
import { createMatchState } from "../match";
import { createInitialPolicy, createMentalAttributes, policyLearningBounds } from "./personality";
import { isValidProfile } from "./rules";

const createTestMatch = (seed: number) => createMatchState(referenceMatchConfig(seed));

describe("personalidade dos jogadores", () => {
  it("faz perfis cerebrais e ousados partirem de preferencias diferentes", () => {
    const profile = REFERENCE_PLAYERS[2];
    const cerebral = { ...profile, mental: createMentalAttributes("cerebral") };
    const bold = { ...profile, mental: createMentalAttributes("bold") };

    expect(createInitialPolicy(cerebral).pass).toBeGreaterThan(createInitialPolicy(bold).pass);
    expect(createInitialPolicy(bold).dribble).toBeGreaterThan(createInitialPolicy(cerebral).dribble);
  });

  it("faz jogadores mais decisivos pensarem em intervalos menores", () => {
    const state = createTestMatch(10);
    const player = state.players[0];
    player.profile.mental = createMentalAttributes("balanced", { decisionMaking: 95, anticipation: 90 });
    const fast = thinkingInterval(player);
    player.profile.mental = createMentalAttributes("balanced", { decisionMaking: 20, anticipation: 20 });

    expect(fast).toBeLessThan(thinkingInterval(player));
  });

  it("prioriza o jogador intenso quando dois defensores podem pressionar", () => {
    const state = createTestMatch(11);
    state.kickoffTimer = 0;
    const candidates = state.players.filter((player) => player.team === "blue" && player.profile.position !== "goalkeeper").slice(0, 2);
    candidates[0].position = { x: FIELD.width * 0.42, y: FIELD.height * 0.45 };
    candidates[1].position = { ...candidates[0].position };
    candidates[0].profile.mental = createMentalAttributes("disciplined", { aggression: 20, intensity: 20 });
    candidates[1].profile.mental = createMentalAttributes("intense");
    candidates[0].memory.policy.press = 0.6;
    candidates[1].memory.policy.press = 0.6;
    const controller = state.players.find((player) => player.team === "coral" && player.profile.position === "centerMid")!;
    controller.position = { x: candidates[0].position.x + 8, y: candidates[0].position.y };
    state.ball.position = { ...controller.position };
    state.ball.controllerId = controller.profile.id;
    state.possessionTeam = "coral";
    state.ballControlTeam = "coral";

    const decisions = decideAll(state);

    expect(decisions.get(candidates[1].profile.id)?.intent).toBe("pressing");
    expect(decisions.get(candidates[0].profile.id)?.intent).not.toBe("pressing");
  });

  it("da mais amplitude de aprendizado a jogadores adaptaveis", () => {
    const profile = REFERENCE_PLAYERS[2];
    const low = { ...profile, mental: createMentalAttributes("balanced", { adaptability: 10 }) };
    const high = { ...profile, mental: createMentalAttributes("balanced", { adaptability: 95 }) };
    const lowBounds = policyLearningBounds(low, "pass");
    const highBounds = policyLearningBounds(high, "pass");

    expect(highBounds.maximum - highBounds.minimum).toBeGreaterThan(lowBounds.maximum - lowBounds.minimum);
  });

  it("rejeita atributos mentais fora da escala", () => {
    const profile = structuredClone(REFERENCE_PLAYERS[0]);
    profile.mental.composure = 101;

    expect(isValidProfile(profile)).toBe(false);
  });
});
