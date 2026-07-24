import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig } from "./__fixtures__/reference-match";
import { FIELD } from "./config";
import { createMatchState } from "./index";
import { updatePossession } from "./systems/possession-system";
import type { MatchState, PlayerRuntime } from "./model";

const createTestMatch = (seed = 5) => createMatchState(smallSidedMatchConfig(seed));

// Distância em que os dois corpos engajam o contato (raio + raio + a margem de ombro do motor),
// para o cenário acompanhar o tamanho dos jogadores em vez de fixar um número solto.
const contactGap = (first: PlayerRuntime, second: PlayerRuntime): number => first.radius + second.radius + 0.5;

// Afasta os não-participantes do lance (e deixa espaço atrás do defensor livre).
const park = (state: MatchState, keep: PlayerRuntime[]): void => {
  state.players.forEach((player) => {
    if (keep.includes(player)) return;
    player.position = { x: FIELD.width / 2, y: FIELD.height - 4 };
    player.kickCooldown = 5;
    player.reactionTimer = 5;
  });
};

describe("resolveContact — desfechos de contato (Item 2)", () => {
  it("roubo com agressividade controlada: defensor entra em velocidade, segue com a bola e assume a jogada", () => {
    const state = createTestMatch();
    state.kickoffTimer = 0;
    const holder = state.players.find((p) => p.team === "blue" && p.profile.position === "centerMid")!;
    const challenger = state.players.find((p) => p.team === "coral" && p.profile.position === "centerBack")!;
    holder.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    holder.velocity = { x: 0, y: 0 };
    holder.profile.skills.control = 1;
    holder.profile.skills.burst = 1;
    challenger.position = { x: holder.position.x + contactGap(holder, challenger), y: holder.position.y };
    challenger.velocity = { x: -16, y: 0 }; // pique em cima do portador
    challenger.profile.skills.defending = 100;
    challenger.profile.skills.acceleration = 100;
    challenger.profile.skills.control = 100;
    park(state, [holder, challenger]);
    state.ball.position = { x: holder.position.x + 1.6, y: holder.position.y };
    state.ball.controllerId = holder.profile.id;
    state.ball.lastTouch = holder.team;
    state.ball.lastTouchPlayerId = holder.profile.id;

    updatePossession(state, 1 / 120);

    expect(state.ball.dribbleOwnerId).toBe(challenger.profile.id);
    expect(state.ball.controllerId).toBeNull();
    expect(state.ball.lastTouch).toBe(challenger.team);
    expect(state.ball.velocity.x).toBeLessThan(0); // segue na direção do pique do defensor
    expect(state.stats.coral.tacklesWon).toBe(1);
    expect(holder.reactionTimer).toBeGreaterThan(0);
  });

  it("desfecho neutro (pokeLoose): defensor parado ganha e a bola escapa solta, sem dono", () => {
    const state = createTestMatch();
    state.kickoffTimer = 0;
    const holder = state.players.find((p) => p.team === "blue" && p.profile.position === "centerMid")!;
    const challenger = state.players.find((p) => p.team === "coral" && p.profile.position === "centerBack")!;
    holder.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
    holder.profile.skills.control = 1;
    holder.profile.skills.burst = 1;
    challenger.position = { x: holder.position.x + contactGap(holder, challenger), y: holder.position.y };
    challenger.velocity = { x: 0, y: 0 }; // parado → sem pique → não é roubo limpo
    challenger.profile.skills.defending = 100;
    challenger.profile.skills.acceleration = 100;
    park(state, [holder, challenger]);
    state.ball.position = { x: holder.position.x + 1.6, y: holder.position.y };
    state.ball.controllerId = holder.profile.id;
    state.ball.lastTouch = holder.team;
    state.ball.lastTouchPlayerId = holder.profile.id;

    updatePossession(state, 1 / 120);

    expect(state.ball.controllerId).toBeNull();
    expect(state.ball.dribbleOwnerId).toBeNull();
    expect(state.stats.coral.tacklesWon).toBe(1);
    expect(Math.hypot(state.ball.velocity.x, state.ball.velocity.y)).toBeGreaterThan(0);
  });

  it("balão por cima da dividida: atacante vence o contato com espaço atrás e ergue a bola baixa", () => {
    const state = createTestMatch();
    state.kickoffTimer = 0;
    const holder = state.players.find((p) => p.team === "blue" && p.profile.position === "striker")!;
    const challenger = state.players.find((p) => p.team === "coral" && p.profile.position === "centerBack")!;
    holder.position = { x: FIELD.width * 0.6, y: FIELD.height / 2 };
    holder.velocity = { x: 4, y: 0 };
    holder.profile.skills.control = 100;
    holder.profile.skills.burst = 100;
    holder.sprintEnergy = 1;
    holder.dribbleTouchCooldown = 0;
    challenger.position = { x: holder.position.x + 3.6, y: holder.position.y }; // à frente (goal-side)
    challenger.velocity = { x: -4, y: 0 };
    challenger.profile.skills.defending = 1;
    challenger.profile.skills.acceleration = 1;
    park(state, [holder, challenger]); // demais coral longe → espaço atrás livre
    state.ball.position = { x: holder.position.x + 1.6, y: holder.position.y };
    state.ball.controllerId = holder.profile.id;
    state.ball.lastTouch = holder.team;
    state.ball.lastTouchPlayerId = holder.profile.id;

    updatePossession(state, 1 / 120);

    expect(state.ball.dribbleOwnerId).toBe(holder.profile.id);
    expect(state.ball.controllerId).toBeNull();
    expect(state.ball.verticalVelocity).toBeGreaterThan(0); // balão
    expect(state.ball.velocity.x).toBeGreaterThan(0); // rumo ao gol (blue ataca +x)
    expect(state.stats.coral.tacklesWon).toBe(0);
  });
});
