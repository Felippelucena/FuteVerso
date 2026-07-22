import { describe, expect, it } from "vitest";
import { PHYSICS } from "./config";
import { estimatePassDuration, solvePassTrajectory } from "./runtime/pass-trajectory";
import { distance, length } from "../shared/math";

const positionAfterDrag = (origin: { x: number; y: number }, velocity: { x: number; y: number }, drag: number, time: number) => {
  const displacementFactor = drag > 0 ? (1 - Math.exp(-drag * time)) / drag : time;
  return {
    x: origin.x + velocity.x * displacementFactor,
    y: origin.y + velocity.y * displacementFactor,
  };
};

describe("solver de trajetoria de passe", () => {
  it.each([
    ["ground", "short", "feet", { x: 42, y: 31 }],
    ["ground", "long", "space", { x: 84, y: 54 }],
    ["air", "short", "feet", { x: 46, y: 44 }],
    ["air", "long", "space", { x: 91, y: 58 }],
  ] as const)("faz um passe %s %s chegar ao destino", (trajectory, range, targeting, target) => {
    const origin = { x: 20, y: 20 };
    const solution = solvePassTrajectory(origin, target, trajectory, range, targeting, 0.75);
    const drag = trajectory === "air" ? PHYSICS.airBallDrag : PHYSICS.ballDrag;
    const reached = positionAfterDrag(origin, solution.velocity, drag, solution.duration);

    expect(distance(reached, target)).toBeLessThan(0.02);
    expect(distance(solution.landingPoint, target)).toBeLessThan(0.02);
    if (trajectory === "air") {
      const heightAtArrival = solution.verticalVelocity * solution.duration
        - PHYSICS.gravity * solution.duration ** 2 / 2;
      expect(heightAtArrival).toBeCloseTo(0, 5);
    } else {
      expect(solution.verticalVelocity).toBe(0);
    }
  });

  it("aumenta tempo e forca de forma coerente com a distancia", () => {
    const origin = { x: 20, y: 30 };
    const near = solvePassTrajectory(origin, { x: 42, y: 30 }, "ground", "long", "space", 0.7);
    const far = solvePassTrajectory(origin, { x: 82, y: 30 }, "ground", "long", "space", 0.7);

    expect(far.duration).toBeGreaterThan(near.duration);
    expect(length(far.velocity)).toBeGreaterThan(length(near.velocity));
    expect(estimatePassDuration(62, "ground", "long", "space", 0.7)).toBe(far.duration);
  });

  it("e deterministico para os mesmos parametros", () => {
    const args = [{ x: 18, y: 22 }, { x: 76, y: 48 }, "air", "long", "space", 0.83] as const;
    expect(solvePassTrajectory(...args)).toEqual(solvePassTrajectory(...args));
  });
});
