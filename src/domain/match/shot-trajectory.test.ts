import { describe, expect, it } from "vitest";
import { FIELD, PHYSICS } from "./config";
import type { PlayerSkills } from "../roster/model";
import { GOAL_MOUTH } from "./runtime/goal-frame";
import { highestAimUnderCrossbar, predictShotPoint, shotLaunchSpeed, solveShotTrajectory } from "./runtime/shot-trajectory";

describe("solver tridimensional de chutes", () => {
  it.each([0.35, 1.8, 3.8])("cruza o alvo na altura %.2f", (height) => {
    const origin = { x: 28, y: 42 };
    const target = { x: 180, y: 57 };
    const solution = solveShotTrajectory(origin, target, 0, height, 102);
    const arrival = predictShotPoint(origin, solution.velocity, 0, solution.verticalVelocity, solution.duration);

    expect(arrival.position.x).toBeCloseTo(target.x, 5);
    expect(arrival.position.y).toBeCloseTo(target.y, 5);
    expect(arrival.height).toBeCloseTo(height, 5);
    expect(solution.arrivalSpeed).toBeGreaterThan(0);
  });

  it("exige mais impulso vertical para um alvo mais alto e permanece deterministico", () => {
    const low = solveShotTrajectory({ x: 40, y: 54 }, { x: 180, y: 54 }, 0, 0.35, 96);
    const high = solveShotTrajectory({ x: 40, y: 54 }, { x: 180, y: 54 }, 0, 3.8, 96);
    const repeated = solveShotTrajectory({ x: 40, y: 54 }, { x: 180, y: 54 }, 0, 3.8, 96);

    expect(high.verticalVelocity).toBeGreaterThan(low.verticalVelocity);
    expect(repeated).toEqual(high);
  });
});

/**
 * A regressão que dói: a mira alta virava um morteiro. A bola subia acima do travessão, passava
 * por cima do goleiro adiantado e descia na linha na altura que ele não alcança — e quanto mais
 * longe o chute, mais impossível ficava a defesa.
 */
describe("trava fisica da mira", () => {
  const skills = (values: Partial<PlayerSkills>): PlayerSkills => ({
    acceleration: 65, sprintSpeed: 65, burst: 65, stamina: 70, control: 65, strength: 65,
    passing: 65, vision: 65, finishing: 60, defending: 60, kickPower: 65, goalkeeping: 20, ...values,
  });
  const headerSpeed = shotLaunchSpeed(skills({}), 0.7, "header");

  const apexOf = (travelDistance: number, originHeight: number, aim: number, speed: number): number => {
    const solution = solveShotTrajectory({ x: 0, y: 0 }, { x: travelDistance, y: 0 }, originHeight, aim, speed);
    const apexTime = Math.min(Math.max(0, solution.verticalVelocity / PHYSICS.gravity), solution.duration);
    return predictShotPoint({ x: 0, y: 0 }, solution.velocity, originHeight, solution.verticalVelocity, apexTime).height;
  };

  it("nunca deixa a rota passar por cima da boca do gol", () => {
    for (const travelDistance of [20, 40, 60, 80, 100]) {
      const aim = highestAimUnderCrossbar(travelDistance, 1.4, headerSpeed);
      if (aim === null) continue;
      expect(apexOf(travelDistance, 1.4, aim, headerSpeed)).toBeLessThanOrEqual(GOAL_MOUTH.ceiling + 1e-6);
    }
  });

  it("faz o cabeceio alcancar o gol de dentro da area, e nao de fora", () => {
    expect(highestAimUnderCrossbar(FIELD.penaltyDepth * 0.7, 1.4, headerSpeed)).not.toBeNull();
    expect(highestAimUnderCrossbar(FIELD.penaltyDepth * 1.3, 1.4, headerSpeed)).toBeNull();
  });

  it("recusa o cabeceio de longe e libera o de perto", () => {
    expect(highestAimUnderCrossbar(27, 1.4, headerSpeed)).toBeGreaterThan(2.9);
    expect(highestAimUnderCrossbar(81, 1.4, headerSpeed)).toBeNull();
    // O morteiro que a trava mata: mirar 2,9 de 30 m punha a bola muito acima do travessão no meio
    // do caminho — por cima do goleiro adiantado, para descer na linha onde ele não alcança.
    expect(apexOf(81, 1.4, 2.9, headerSpeed)).toBeGreaterThan(GOAL_MOUTH.ceiling);
  });

  it("devolve mira mais alta a quem bate mais forte, na mesma distancia", () => {
    const weak = highestAimUnderCrossbar(70, 0.35, shotLaunchSpeed(skills({ kickPower: 40 }), 0.8, "placed"));
    const strong = highestAimUnderCrossbar(70, 0.35, shotLaunchSpeed(skills({ kickPower: 95 }), 0.8, "placed"));
    expect(strong!).toBeGreaterThan(weak!);
  });

  it("tira a forca do cabeceio do tronco, nao da perna", () => {
    const strong = shotLaunchSpeed(skills({ strength: 90, kickPower: 30 }), 0.7, "header");
    const weak = shotLaunchSpeed(skills({ strength: 30, kickPower: 90 }), 0.7, "header");
    expect(strong).toBeGreaterThan(weak);
  });
});
