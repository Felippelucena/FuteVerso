import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { decideAll } from "./ai";
import { FIELD } from "./config";
import { createMatchState } from "./index";
import { executeBallAction } from "./systems/ball-system";

const createTestMatch = (seed = 1) => createMatchState(referenceMatchConfig(seed));

describe("finta — raio de colisão e posse", () => {
  it("finta que falha NÃO faz o portador perder a posse", () => {
    const state = createTestMatch(1);
    state.kickoffTimer = 0;
    const player = state.players.find((p) => p.team === "blue" && p.profile.position === "centerMid")!;
    const defender = state.players.find((p) => p.team === "coral" && p.profile.position === "centerBack")!;
    player.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    player.facing = { x: 1, y: 0 };
    player.profile.skills.control = 1;
    player.profile.skills.burst = 1;
    defender.position = { x: player.position.x + 4, y: player.position.y }; // no raio de colisão
    defender.profile.skills.defending = 100;
    defender.profile.skills.acceleration = 100;
    state.players.forEach((p) => { if (p !== player && p !== defender) p.position = { x: FIELD.width - 10, y: 6 }; });
    state.ball.position = { x: player.position.x + 2, y: player.position.y };
    state.ball.controllerId = player.profile.id;
    state.ball.controlStartedAt = state.elapsed - 1; // posse assentada

    executeBallAction(state, player, { kind: "dribble", target: { x: player.position.x + 10, y: player.position.y }, style: "feint" });

    expect(state.stats.blue.feintsAttempted).toBe(1); // tentou a finta
    expect(state.stats.blue.feintsCompleted).toBe(0); // e o marcador leu (falhou)
    expect(state.ball.controllerId).toBe(player.profile.id); // MAS mantém a posse (antes: virava bola solta)
  });

  it("não tenta finta contra um marcador em espaço vazio (fora do raio de colisão)", () => {
    const state = createTestMatch(2);
    state.kickoffTimer = 0;
    state.elapsed = 10;
    const carrier = state.players.find((p) => p.team === "blue" && p.profile.position === "centerMid")!;
    const defender = state.players.find((p) => p.team === "coral" && p.profile.position === "centerBack")!;
    carrier.position = { x: FIELD.width * 0.5, y: FIELD.height / 2 };
    carrier.velocity = { x: 2, y: 0 };
    carrier.facing = { x: 1, y: 0 };
    carrier.profile.skills.control = 100;
    carrier.profile.skills.burst = 100;
    carrier.profile.mental.creativity = 90;
    defender.position = { x: carrier.position.x + 10, y: carrier.position.y }; // ~10u: raios NÃO colidem (somam 4,5)
    defender.velocity = { x: -8, y: 0 };
    state.players.forEach((p) => { if (p !== carrier && p !== defender) p.position = { x: 10, y: 10 }; });
    state.ball.position = { x: carrier.position.x + 2, y: carrier.position.y };
    state.ball.controllerId = carrier.profile.id;
    state.ball.controlStartedAt = state.elapsed - 1;

    const decision = decideAll(state).get(carrier.profile.id)!;
    const style = decision.ballAction.kind === "dribble" ? decision.ballAction.style : null;
    expect(style).not.toBe("feint");
  });
});
