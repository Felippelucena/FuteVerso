import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { DUEL, FIELD } from "./config";
import { createMatchState, stepMatch } from "./index";
import { updateControlledBall } from "./systems/ball-system";
import { updateEngagement } from "./systems/engagement-system";
import { updatePlayers } from "./systems/movement-system";
import { updatePossession } from "./systems/possession-system";
import type { AgentDecision, MatchState, PlayerRuntime } from "./model";

const holdingStill = (player: PlayerRuntime): AgentDecision => ({
  movementTarget: { ...player.position },
  burst: false,
  posture: "inPossession",
  intent: "carrying",
  reason: "carryIntoSpace",
  ballAction: { kind: "none" },
});

interface Challenge {
  state: MatchState;
  holder: PlayerRuntime;
  offender: PlayerRuntime;
}

/** Portador com a bola e um marcador entrando em cima dele, na velocidade e no temperamento pedidos. */
const challenge = (options: { closingSpeed: number; aggression: number; defending: number }): Challenge => {
  const state = createMatchState(smallSidedMatchConfig(11));
  startOpenPlay(state);
  const holder = state.players.find((p) => p.team === "blue" && p.profile.position === "centerMid")!;
  const offender = state.players.find((p) => p.team === "coral" && p.profile.position === "centerBack")!;
  holder.position = { x: FIELD.width / 2, y: FIELD.height / 2 };
  holder.velocity = { x: 0, y: 0 };
  holder.facing = { x: 1, y: 0 };
  holder.profile.skills.control = 30;
  holder.profile.skills.strength = 30;
  offender.position = { x: holder.position.x + holder.radius + offender.radius + 0.2, y: holder.position.y };
  offender.velocity = { x: -options.closingSpeed, y: 0 };
  offender.profile.mental.aggression = options.aggression;
  offender.profile.skills.defending = options.defending;
  offender.profile.skills.strength = 90;
  state.players.forEach((player) => {
    if (player !== holder && player !== offender) {
      player.position = { x: FIELD.width - 5, y: FIELD.height - 5 };
      player.reactionTimer = 9;
      player.kickCooldown = 9;
    }
  });
  // Bola escondida do lado oposto: o marcador entra no corpo, não na bola. É o que define a falta.
  state.ball.position = { x: holder.position.x - holder.radius - state.ball.radius, y: holder.position.y };
  state.ball.controllerId = holder.profile.id;
  state.ball.controlStartedAt = state.elapsed;
  state.ball.lastTouchPlayerId = holder.profile.id;
  return { state, holder, offender };
};

/**
 * Roda a disputa isolada, mantendo o marcador colado e em velocidade sobre o corpo do portador.
 * Inclui o movimento (com decisão fixa de "ficar parado") porque a falta se resolve no corpo: o
 * tranco empurra o portador, e é o corpo dele saindo de baixo da bola que a faz escapar.
 */
const press = (setup: Challenge, seconds: number): void => {
  const dt = 1 / 120;
  const closing = setup.offender.velocity.x;
  // O agressor é conduzido à mão: `updatePlayers` o frearia (a decisão dele é "fique parado") e a
  // entrada desapareceria antes de a bola sentir. Repinar depois do movimento mantém a trombada
  // viva pelos dois leitores dela — quem marca a falta e quem aplica a força.
  const chargeIn = (): void => {
    setup.offender.position = {
      x: setup.holder.position.x + setup.holder.radius + setup.offender.radius + 0.2,
      y: setup.holder.position.y,
    };
    setup.offender.velocity = { x: closing, y: 0 };
  };
  for (let tick = 0; tick < seconds * 120 && !setup.state.foulCall; tick += 1) {
    chargeIn();
    const decisions = new Map(setup.state.players.map((p) => [p.profile.id, holdingStill(p)]));
    updateEngagement(setup.state, dt);
    updatePlayers(setup.state, decisions, dt);
    chargeIn();
    updateControlledBall(setup.state, decisions, dt);
    updatePossession(setup.state, dt);
  }
};

describe("Lei 12 — falta e tiro livre", () => {
  it("entrada em velocidade no corpo, longe da bola, é falta", () => {
    const setup = challenge({ closingSpeed: DUEL.foulClosingSpeed + 4, aggression: 95, defending: 20 });
    press(setup, 3);

    expect(setup.state.foulCall?.team).toBe("coral");
    expect(setup.state.foulCall?.offenderId).toBe(setup.offender.profile.id);
    expect(setup.state.foulCall?.victimId).toBe(setup.holder.profile.id);
    expect(setup.state.stats.coral.fouls).toBe(1);
  });

  it("o mesmo contato, feito por quem sabe defender, não é falta", () => {
    const setup = challenge({ closingSpeed: DUEL.foulClosingSpeed + 4, aggression: 55, defending: 95 });
    press(setup, 3);

    expect(setup.state.foulCall).toBeNull();
  });

  it("chegar devagar não é falta, por mais agressivo que seja o marcador", () => {
    const setup = challenge({ closingSpeed: 1, aggression: 99, defending: 10 });
    press(setup, 3);

    expect(setup.state.foulCall).toBeNull();
  });

  it("a falta apitada vira tiro livre para quem a sofreu, no ponto da infração", () => {
    const setup = challenge({ closingSpeed: DUEL.foulClosingSpeed + 4, aggression: 95, defending: 20 });
    press(setup, 3);
    const spot = { ...setup.state.foulCall!.spot };

    // A jogada fica congelada durante o apito e destrava no tiro livre.
    for (let tick = 0; tick < (DUEL.freezeSeconds + 0.2) * 120 && setup.state.foulCall; tick += 1) {
      stepMatch(setup.state, 1 / 120);
    }

    expect(setup.state.foulCall).toBeNull();
    expect(setup.state.restart?.kind).toBe("freeKick");
    expect(setup.state.restart?.team).toBe("blue"); // o time que sofreu
    expect(setup.state.restart?.spot.x).toBeCloseTo(spot.x, 3);
  });
});
