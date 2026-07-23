import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { createMatchState } from "./index";
import { chooseDribbleTouch, evaluateForwardRunway } from "./runtime/dribble-runway";
import { executeBallAction } from "./systems/ball-system";
import { FIELD } from "./config";
import { length } from "../shared/math";
import type { DribbleTouchRange } from "./model";

const createTestMatch = (seed = 5150) => createMatchState(buildMatchConfig(createDefaultProfile(), seed));

const arrangeCarrier = () => {
  const state = createTestMatch();
  state.kickoffTimer = 0;
  const carrier = state.players.find((player) => player.team === "blue" && player.profile.position === "midfielder")!;
  carrier.position = { x: 55, y: FIELD.height / 2 };
  carrier.velocity = { x: 0, y: 0 };
  carrier.sprintEnergy = 1;
  state.players.filter((player) => player.team !== carrier.team).forEach((opponent, index) => {
    opponent.position = { x: 25 - index * 3, y: 10 + index * 18 };
    opponent.velocity = { x: 0, y: 0 };
    opponent.plan = null;
  });
  return { state, carrier };
};

describe("corredor frontal e faixas de pique", () => {
  it("ignora adversarios atras e fora da largura do corredor", () => {
    const { state, carrier } = arrangeCarrier();
    const opponents = state.players.filter((player) => player.team !== carrier.team);
    opponents[0].position = { x: carrier.position.x - 3, y: carrier.position.y };
    opponents[1].position = { x: carrier.position.x + 18, y: carrier.position.y + 12 };

    const runway = evaluateForwardRunway(state, carrier);

    expect(runway.blockerId).toBeNull();
    expect(runway.distance).toBe(45);
  });

  it("antecipa um adversario cruzando a rota", () => {
    const { state, carrier } = arrangeCarrier();
    const crossing = state.players.find((player) => player.team !== carrier.team)!;
    crossing.position = { x: carrier.position.x + 20, y: carrier.position.y + 11 };
    crossing.velocity = { x: 0, y: -25 };

    const runway = evaluateForwardRunway(state, carrier);

    expect(runway.blockerId).toBe(crossing.profile.id);
    expect(runway.distance).toBeLessThan(20);
  });

  it("reduz a faixa conforme a energia volátil sem depender da fase tatica", () => {
    const { state, carrier } = arrangeCarrier();
    state.tactics.blue.phase = "buildUp";

    carrier.sprintEnergy = 0.8;
    expect(chooseDribbleTouch(state, carrier).range).toBe("long");
    carrier.sprintEnergy = 0.45;
    expect(chooseDribbleTouch(state, carrier).range).toBe("medium");
    carrier.sprintEnergy = 0.3;
    expect(chooseDribbleTouch(state, carrier).range).toBe("short");
    carrier.sprintEnergy = 0.2;
    expect(chooseDribbleTouch(state, carrier).range).toBeNull();
  });

  it("reduz um pique longo quando o rival chega perto da mesma janela", () => {
    const { state, carrier } = arrangeCarrier();
    const rival = state.players.find((player) => player.team !== carrier.team)!;
    rival.position = { x: carrier.position.x + 30, y: carrier.position.y + 8 };

    const choice = chooseDribbleTouch(state, carrier);

    expect(choice.range).not.toBe("long");
    expect(choice.reason).toBe("reducedForRace");
  });

  it("faz as tres faixas soltarem a bola com distancia e forca crescentes", () => {
    const perform = (touchRange: DribbleTouchRange, targetDistance: number) => {
      const { state, carrier } = arrangeCarrier();
      state.ball.position = { x: carrier.position.x + carrier.radius + state.ball.radius + 0.15, y: carrier.position.y };
      state.ball.controllerId = carrier.profile.id;
      state.ball.controlStartedAt = state.elapsed - 1;
      executeBallAction(state, carrier, {
        kind: "dribble",
        style: "knockOn",
        touchRange,
        target: { x: carrier.position.x + targetDistance, y: carrier.position.y },
      });
      return { speed: length(state.ball.velocity), duration: carrier.sprintTimer, owner: state.ball.dribbleOwnerId, range: state.ball.dribbleTouchRange };
    };

    const short = perform("short", 11);
    const medium = perform("medium", 20);
    const long = perform("long", 34);

    expect(short.owner).not.toBeNull();
    expect(short.range).toBe("short");
    expect(medium.speed).toBeGreaterThan(short.speed);
    expect(long.speed).toBeGreaterThan(medium.speed);
    expect(medium.duration).toBeGreaterThan(short.duration);
    expect(long.duration).toBeGreaterThan(medium.duration);
  });

  it("nao repete o toque enquanto o cooldown individual estiver ativo", () => {
    const { state, carrier } = arrangeCarrier();
    const action = {
      kind: "dribble" as const,
      style: "knockOn" as const,
      touchRange: "short" as const,
      target: { x: carrier.position.x + 11, y: carrier.position.y },
    };
    state.ball.position = { x: carrier.position.x + carrier.radius + state.ball.radius + 0.15, y: carrier.position.y };
    state.ball.controllerId = carrier.profile.id;
    executeBallAction(state, carrier, action);
    const attempts = state.stats.blue.sprintDribbles;
    state.ball.controllerId = carrier.profile.id;
    state.ball.dribbleOwnerId = null;
    carrier.kickCooldown = 0;

    executeBallAction(state, carrier, action);

    expect(state.stats.blue.sprintDribbles).toBe(attempts);
    expect(state.ball.controllerId).toBe(carrier.profile.id);
  });
});
