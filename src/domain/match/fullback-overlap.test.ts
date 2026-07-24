import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { decideAll } from "./ai";
import { FIELD } from "./config";
import { createMatchState } from "./index";
import { updateTacticalContext } from "./systems/tactics-system";

const createTestMatch = (seed = 9) => createMatchState(referenceMatchConfig(seed));

describe("zagueiro-ofensivo moderado + recomposição (Item 4)", () => {
  it("libera o lateral a sobrepor no ataque; nenhum outro jogador recebe overlapRun", () => {
    const state = createTestMatch();
    state.kickoffTimer = 0;
    const fb = state.players.find((p) => p.team === "blue" && p.profile.position === "centerBack")!;
    fb.profile.position = "rightBack"; // vira lateral (mantém role "defender")
    fb.profile.skills.defending = 40; // não é o melhor candidato a segurança
    const mid = state.players.find((p) => p.team === "blue" && p.profile.position === "centerMid")!;
    mid.profile.skills.defending = 99; // será o jogador de segurança (rest defense)
    const fwd = state.players.find((p) => p.team === "blue" && p.profile.position === "striker")!;
    // personalidade arrojada → risco alto o bastante para liberar a sobreposição
    state.players.filter((p) => p.team === "blue").forEach((p) => {
      p.profile.mental.creativity = 80;
      p.profile.mental.aggression = 80;
      p.profile.mental.composure = 80;
      p.sprintEnergy = 1;
    });
    fwd.position = { x: FIELD.width * 0.78, y: FIELD.height / 2 };
    fb.position = { x: FIELD.width * 0.55, y: FIELD.height / 2 };
    mid.position = { x: FIELD.width * 0.3, y: FIELD.height / 2 }; // recuado → segurança
    state.ball.position = { ...fwd.position };
    state.ball.controllerId = fwd.profile.id;
    state.possessionTeam = "blue";
    state.lastControlledTeam = "blue";
    state.tactics.blue.phase = "finalThird";
    state.tactics.blue.phaseStartedAt = state.elapsed;

    updateTacticalContext(state, 0);
    const plan = state.tactics.blue.collectivePlan!;
    expect(plan.overlapFullBackId).toBe(fb.profile.id);

    const decisions = decideAll(state);
    expect(decisions.get(fb.profile.id)!.reason).toBe("overlapRun");
    expect(decisions.get(mid.profile.id)!.reason).not.toBe("overlapRun");
    expect(decisions.get(fwd.profile.id)!.reason).not.toBe("overlapRun");
  });

  it("zagueiro adiantado recompõe em disparada garantida ao perder a posse", () => {
    const state = createTestMatch();
    state.kickoffTimer = 0;
    state.elapsed = 20;
    const fb = state.players.find((p) => p.team === "blue" && p.profile.position === "centerBack")!;
    fb.profile.position = "rightBack";
    fb.position = { x: FIELD.width * 0.44, y: FIELD.height / 2 }; // bem à frente do anchor
    fb.sprintEnergy = 1;
    fb.sprintCooldown = 0;
    const carrier = state.players.find((p) => p.team === "coral" && p.profile.position === "centerMid")!;
    carrier.position = { x: FIELD.width * 0.24, y: FIELD.height / 2 };
    const closeBlue = state.players.find((p) => p.team === "blue" && p.profile.position === "centerMid")!;
    closeBlue.position = { x: carrier.position.x + 6, y: carrier.position.y }; // presser mais próximo
    state.players.filter((p) => p.team === "coral" && p !== carrier).forEach((p, i) => {
      p.position = { x: FIELD.width * 0.2, y: 8 + i * 40 };
    });
    state.ball.position = { ...carrier.position };
    state.ball.controllerId = carrier.profile.id;
    // acabou de perder a posse
    state.possessionTeam = "coral";
    state.previousControlledTeam = "blue";
    state.lastControlledTeam = "coral";
    state.controlChangedAt = state.elapsed;

    const decision = decideAll(state).get(fb.profile.id)!;
    expect(decision.reason).toBe("recoverShape");
    expect(decision.burst).toBe(true);
  });
});
