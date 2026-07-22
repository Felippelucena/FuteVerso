import { describe, expect, it } from "vitest";
import { predictShotPoint, solveShotTrajectory } from "./runtime/shot-trajectory";

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
