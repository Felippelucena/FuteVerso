import { FIXED_STEP } from "../../domain/match/config";
import { createMatchState, stepMatch } from "../../domain/match";
import type { MatchConfig, MatchState } from "../../domain/match";

export const SIMULATION_SPEEDS = [0.5, 1, 2, 4, 8] as const;
export type SimulationSpeed = typeof SIMULATION_SPEEDS[number];

const MAX_REAL_DELTA_SECONDS = 0.1;
const MAX_STEPS_PER_ADVANCE = 140;

export class MatchSession {
  private currentState: MatchState;
  private isPaused = false;
  private currentSpeed: SimulationSpeed = 1;
  private accumulator = 0;

  constructor(config: MatchConfig) {
    this.currentState = createMatchState(config);
  }

  get state(): MatchState {
    return this.currentState;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  get speed(): SimulationSpeed {
    return this.currentSpeed;
  }

  advance(realDeltaSeconds: number): number {
    if (this.isPaused || this.currentState.finished) return 0;
    const safeDelta = Number.isFinite(realDeltaSeconds)
      ? Math.min(Math.max(realDeltaSeconds, 0), MAX_REAL_DELTA_SECONDS)
      : 0;
    this.accumulator += safeDelta * this.currentSpeed;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_ADVANCE) {
      stepMatch(this.currentState, FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
    return steps;
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  togglePaused(): void {
    this.isPaused = !this.isPaused;
  }

  setSpeed(speed: SimulationSpeed): void {
    if (!SIMULATION_SPEEDS.includes(speed)) throw new RangeError(`Velocidade de simulacao invalida: ${speed}`);
    this.currentSpeed = speed;
  }

  restart(config: MatchConfig): void {
    this.currentState = createMatchState(config);
    this.accumulator = 0;
  }
}
