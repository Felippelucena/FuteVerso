import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { FIELD, PHYSICS } from "./config";
import { createMatchState } from "./index";
import { updateControlledBall } from "./systems/ball-system";
import { updateEngagement } from "./systems/engagement-system";
import { updatePossession } from "./systems/possession-system";
import type { AgentDecision, MatchState, PlayerRuntime } from "./model";

const createTestMatch = (seed = 5) => createMatchState(smallSidedMatchConfig(seed));

/** Afasta quem não participa do lance e deixa o espaço atrás do marcador livre. */
const park = (state: MatchState, keep: PlayerRuntime[]): void => {
  state.players.forEach((player) => {
    if (keep.includes(player)) return;
    player.position = { x: FIELD.width / 2, y: FIELD.height - 4 };
    player.kickCooldown = 5;
    player.reactionTimer = 5;
  });
};

interface Duel {
  state: MatchState;
  holder: PlayerRuntime;
  challengers: PlayerRuntime[];
}

/** Portador parado no centro com `challengerCount` marcadores colados pelo mesmo lado. */
const duel = (options: { holderControl: number; challengerDefending: number; challengerCount?: number }): Duel => {
  const state = createTestMatch();
  startOpenPlay(state);
  const holder = state.players.find((p) => p.team === "blue" && p.profile.position === "centerMid")!;
  const coral = state.players.filter((p) => p.team === "coral" && p.profile.position !== "goalkeeper");
  const challengers = coral.slice(0, options.challengerCount ?? 1);
  holder.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
  holder.velocity = { x: 0, y: 0 };
  holder.facing = { x: 1, y: 0 };
  holder.profile.skills.control = options.holderControl;
  holder.profile.skills.strength = options.holderControl;
  challengers.forEach((challenger, index) => {
    challenger.position = {
      x: holder.position.x + holder.radius + challenger.radius + 0.4,
      y: holder.position.y + (index === 0 ? 0 : (index % 2 === 1 ? 1 : -1) * 0.9),
    };
    challenger.velocity = { x: 0, y: 0 };
    challenger.profile.skills.defending = options.challengerDefending;
    challenger.profile.skills.strength = options.challengerDefending;
    challenger.reactionTimer = 0;
    challenger.duelCooldown = 0;
  });
  park(state, [holder, ...challengers]);
  state.ball.position = { x: holder.position.x + holder.radius + state.ball.radius + 0.15, y: holder.position.y };
  state.ball.controllerId = holder.profile.id;
  state.ball.controlStartedAt = state.elapsed;
  state.ball.lastTouch = holder.team;
  state.ball.lastTouchPlayerId = holder.profile.id;
  return { state, holder, challengers };
};

const holdingStill = (player: PlayerRuntime): AgentDecision => ({
  movementTarget: { ...player.position },
  burst: false,
  posture: "inPossession",
  intent: "carrying",
  reason: "carryIntoSpace",
  ballAction: { kind: "none" },
});

/**
 * Roda só a disputa e a bola, sem cognição nem movimento próprio. É a física do duelo isolada:
 * com o motor inteiro, um portador muito técnico decide fintar e solta a bola por vontade própria,
 * o que não é perder a bola — mediria a IA, não o contato.
 *
 * Os marcadores acompanham a bola a cada quadro (`chase`), que é o que um defensor faz de verdade.
 * Parado ao lado do portador ele nunca ganharia a bola — e isso está certo: quem só fica perto não
 * desarma ninguém. Sem persegui-la, o teste mediria a proteção de bola, não a força do duelo.
 */
const drive = (setup: Duel, seconds: number, onTick?: () => void, chase = true): void => {
  const dt = 1 / 120;
  const decisions = new Map(setup.state.players.map((player) => [player.profile.id, holdingStill(player)]));
  for (let tick = 0; tick < seconds * 120; tick += 1) {
    if (chase) {
      setup.challengers.forEach((challenger, index) => {
        const ball = setup.state.ball.position;
        const side = index === 0 ? 0 : (index % 2 === 1 ? 1 : -1) * 0.9;
        challenger.position = { x: ball.x + challenger.radius * 0.9, y: ball.y + side };
      });
    }
    updateEngagement(setup.state, dt);
    updateControlledBall(setup.state, decisions, dt);
    updatePossession(setup.state, dt);
    onTick?.();
    if (setup.state.ball.controllerId !== setup.holder.profile.id) return;
  }
};

/** Quantos segundos até a bola sair do controle do portador, ou `null` se ele aguentou. */
const secondsUntilLoss = (setup: Duel, limit = 3): number | null => {
  let elapsed = 0;
  const dt = 1 / 120;
  drive(setup, limit, () => { elapsed += dt; });
  return setup.state.ball.controllerId === setup.holder.profile.id ? null : elapsed;
};

describe("disputa pela bola — o duelo é um processo, não um quadro", () => {
  it("o desarme leva tempo: a bola é arrancada ao longo de vários quadros, sem saltar", () => {
    const setup = duel({ holderControl: 20, challengerDefending: 95 });
    const dt = 1 / 120;
    let previous = { ...setup.state.ball.position };
    let largestStep = 0;
    let ticks = 0;
    drive(setup, 3, () => {
      largestStep = Math.max(largestStep, Math.hypot(
        setup.state.ball.position.x - previous.x,
        setup.state.ball.position.y - previous.y,
      ));
      previous = { ...setup.state.ball.position };
      ticks += 1;
    });

    // Durou mais de um quadro — o duelo antigo resolvia tudo num `if` só.
    expect(ticks).toBeGreaterThan(1);
    expect(setup.state.ball.controllerId).not.toBe(setup.holder.profile.id);
    // E nenhum quadro teve um salto: a bola nunca é reposicionada, só acelerada. O teto é o que
    // a maior velocidade concebível da bola percorre num tick.
    expect(largestStep).toBeLessThan(PHYSICS.maxBallSpeed * dt);
  });

  it("dois marcadores arrancam a bola mais rápido que um", () => {
    const alone = secondsUntilLoss(duel({ holderControl: 55, challengerDefending: 70, challengerCount: 1 }));
    const swarmed = secondsUntilLoss(duel({ holderControl: 55, challengerDefending: 70, challengerCount: 2 }));

    expect(swarmed).not.toBeNull();
    expect(alone === null || swarmed! < alone).toBe(true);
  });

  it("um portador forte segura a bola que um fraco perde", () => {
    const weak = secondsUntilLoss(duel({ holderControl: 15, challengerDefending: 90 }));
    const strong = secondsUntilLoss(duel({ holderControl: 99, challengerDefending: 90 }));

    expect(weak).not.toBeNull();
    expect(strong === null || strong > weak!).toBe(true);
  });

  it("a disputa fica registrada enquanto dura, e some quando o contato acaba", () => {
    const setup = duel({ holderControl: 95, challengerDefending: 30 });
    drive(setup, 1 / 120, undefined, false);
    expect(setup.state.engagement?.holderId).toBe(setup.holder.profile.id);
    expect(setup.state.stats.coral.tacklesAttempted).toBe(1);

    // O marcador desiste e sai de perto: a disputa morre sem desfecho, e a bola segue sendo dele.
    setup.challengers[0].position = { x: 4, y: 4 };
    drive(setup, 1 / 120, undefined, false);
    expect(setup.state.engagement).toBeNull();
    expect(setup.state.ball.controllerId).toBe(setup.holder.profile.id);
  });

  it("a tentativa de desarme é contada uma vez por disputa, não a cada quadro", () => {
    const setup = duel({ holderControl: 99, challengerDefending: 20 });
    drive(setup, 0.5, undefined, false);
    expect(setup.state.stats.coral.tacklesAttempted).toBe(1);
  });

  it("proteger a bola compra tempo: com o corpo entre a bola e o marcador, o desarme demora", () => {
    // Mesmo duelo, dois cenários: um marcador que persegue a bola e um que fica no lugar. O
    // segundo é justamente contra quem a proteção funciona — e ela funciona por geometria, não
    // por um multiplicador de "corpo na frente".
    const chased = secondsUntilLoss(duel({ holderControl: 45, challengerDefending: 90 }));
    const shielded = duel({ holderControl: 45, challengerDefending: 90 });
    drive(shielded, 3, undefined, false);

    expect(chased).not.toBeNull();
    expect(shielded.state.ball.controllerId).toBe(shielded.holder.profile.id);
    expect(Math.abs(shielded.holder.ballAnchor)).toBeGreaterThan(0.5); // pôs o corpo na frente
  });
});
