import { FIXED_STEP } from "../../domain/match/config";
import { createMatchState, stepMatch } from "../../domain/match";
import type { MatchConfig, MatchState } from "../../domain/match";

export const SIMULATION_SPEEDS = [0.5, 1, 2, 4, 8] as const;
export type SimulationSpeed = typeof SIMULATION_SPEEDS[number];

const MAX_REAL_DELTA_SECONDS = 0.1;
const MAX_STEPS_PER_ADVANCE = 140;

// Guarda um snapshot completo a cada 2s de jogo. A simulação é determinística,
// então qualquer instante entre dois keyframes é reconstruído restaurando o
// keyframe anterior e re-simulando os poucos passos que faltam (< 2s ≈ 16ms).
// 2s @ 120Hz => 240 passos por keyframe; ~300 keyframes numa partida de 10min (~6,5MB).
const KEYFRAME_INTERVAL_STEPS = 240;

type Keyframe = { readonly step: number; readonly snapshot: MatchState };

export class MatchSession {
  // Fronteira: o estado mais avançado já simulado. Só ele avança no tempo.
  private frontier: MatchState;
  // Estado exibido/renderizado. Igual à fronteira quando estamos "ao vivo";
  // um clone reconstruído do passado quando o usuário rebobina.
  private viewState: MatchState;
  private isPaused = false;
  private currentSpeed: SimulationSpeed = 1;
  private accumulator = 0;
  private liveStepCount = 0;
  private viewStepCount = 0;
  private keyframes: Keyframe[] = [];

  constructor(config: MatchConfig) {
    this.frontier = createMatchState(config);
    this.viewState = this.frontier;
    this.recordKeyframe();
  }

  get state(): MatchState {
    return this.viewState;
  }

  /** Estado da fronteira ao vivo, independente de onde a linha do tempo está. */
  get liveState(): MatchState {
    return this.frontier;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  get speed(): SimulationSpeed {
    return this.currentSpeed;
  }

  /** Passo (1/120s) mais avançado já simulado. É o `max` da linha do tempo. */
  get liveStep(): number {
    return this.liveStepCount;
  }

  /** Passo atualmente exibido na linha do tempo. */
  get viewStep(): number {
    return this.viewStepCount;
  }

  get liveElapsed(): number {
    return this.liveStepCount * FIXED_STEP;
  }

  get viewElapsed(): number {
    return this.viewStepCount * FIXED_STEP;
  }

  /** Verdadeiro quando o usuário está olhando o passado, não a fronteira ao vivo. */
  get scrubbing(): boolean {
    return this.viewStepCount < this.liveStepCount;
  }

  advance(realDeltaSeconds: number): number {
    // Congela a simulação enquanto o usuário inspeciona o passado.
    if (this.isPaused || this.frontier.finished || this.scrubbing) {
      this.accumulator = 0;
      return 0;
    }
    const safeDelta = Number.isFinite(realDeltaSeconds)
      ? Math.min(Math.max(realDeltaSeconds, 0), MAX_REAL_DELTA_SECONDS)
      : 0;
    this.accumulator += safeDelta * this.currentSpeed;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_ADVANCE) {
      stepMatch(this.frontier, FIXED_STEP);
      this.liveStepCount += 1;
      if (this.liveStepCount % KEYFRAME_INTERVAL_STEPS === 0) this.recordKeyframe();
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
    // Ao vivo, a visão acompanha a fronteira (mesma referência, custo zero).
    this.viewStepCount = this.liveStepCount;
    this.viewState = this.frontier;
    return steps;
  }

  /** Posiciona a linha do tempo em um passo qualquer entre 0 e a fronteira. */
  seek(step: number): void {
    const target = Math.max(0, Math.min(Math.round(step), this.liveStepCount));
    this.accumulator = 0;
    this.viewStepCount = target;
    this.viewState = target === this.liveStepCount ? this.frontier : this.reconstructAt(target);
  }

  /** Reancora a visão na fronteira ao vivo (fim da linha do tempo). */
  resumeLive(): void {
    this.seek(this.liveStepCount);
  }

  private reconstructAt(step: number): MatchState {
    const keyframe = this.keyframeAtOrBefore(step);
    const state = structuredClone(keyframe.snapshot);
    for (let current = keyframe.step; current < step; current += 1) stepMatch(state, FIXED_STEP);
    return state;
  }

  private keyframeAtOrBefore(step: number): Keyframe {
    let result = this.keyframes[0];
    for (const keyframe of this.keyframes) {
      if (keyframe.step > step) break;
      result = keyframe;
    }
    return result;
  }

  private recordKeyframe(): void {
    this.keyframes.push({ step: this.liveStepCount, snapshot: structuredClone(this.frontier) });
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

  setLearningEnabled(enabled: boolean): void {
    this.frontier.learningEnabled = enabled;
  }

  restart(config: MatchConfig): void {
    this.frontier = createMatchState(config);
    this.viewState = this.frontier;
    this.accumulator = 0;
    this.liveStepCount = 0;
    this.viewStepCount = 0;
    this.keyframes = [];
    this.recordKeyframe();
  }
}
