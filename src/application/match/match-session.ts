import { FIXED_STEP } from "../../domain/match/config";
import { applyTeamAdjustment, captureMatchSnapshot, createMatchState, restoreMatchSnapshot, stepMatch } from "../../domain/match";
import type { MatchConfig, MatchEvent, MatchSnapshot, MatchState, TeamAdjustment } from "../../domain/match";
import type { Team } from "../../domain/shared/model";

export const SIMULATION_SPEEDS = [0.5, 1, 2, 4, 8] as const;
export type SimulationSpeed = typeof SIMULATION_SPEEDS[number];

const MAX_REAL_DELTA_SECONDS = 0.1;
const MAX_STEPS_PER_ADVANCE = 140;

// Quanto a jogada fica parada no quadro do passe antes do replay correr. É tempo REAL, não de
// jogo: a velocidade da simulação não encurta a leitura de quem assiste.
const OFFSIDE_REPLAY_HOLD_SECONDS = 1;

/**
 * O impedimento revisto como na transmissão: o apito rebobina até o instante do passe — o único
 * em que a linha significa alguma coisa —, segura o quadro enquanto ela é desenhada e solta o
 * replay dali, que reancora ao vivo sozinho ao alcançar a fronteira.
 */
export interface OffsideReplay {
  readonly team: Team;
  readonly offenderId: string;
  readonly lineProgress: number;
  /** 0→1 enquanto a linha cresce na pausa; 1 depois, com o lance correndo. */
  readonly reveal: number;
}

/**
 * Um impedimento apitado e o trecho da linha do tempo em que ele se decidiu: do passe ao apito.
 * A bandeira é DERIVADA daqui, não um efeito disparado uma vez — é o que a faz reaparecer toda vez
 * que o lance é revisto, em vez de existir só na revisão automática.
 */
interface OffsideCallRecord {
  readonly passStep: number;
  readonly callStep: number;
  readonly team: Team;
  readonly offenderId: string;
  readonly lineProgress: number;
}

// Guarda um snapshot a cada 2s de jogo. A simulação é determinística, então qualquer instante
// entre dois keyframes é reconstruído restaurando o keyframe anterior e re-simulando os poucos
// passos que faltam (< 2s ≈ 16ms). 2s @ 120Hz => 240 passos por keyframe; uma partida de vinte
// minutos guarda ~600 deles, e é por isso que o snapshot não carrega o elenco junto
// (ver captureMatchSnapshot).
const KEYFRAME_INTERVAL_STEPS = 240;

type Keyframe = { readonly step: number; readonly snapshot: MatchSnapshot };

export class MatchSession {
  // Fronteira: o estado mais avançado já simulado. Só ele avança no tempo.
  private frontier: MatchState;
  // Estado exibido/renderizado. Igual à fronteira quando estamos "ao vivo";
  // um clone reconstruído do passado quando o usuário rebobina.
  private viewState: MatchState;
  private isPaused = false;
  // Verdadeiro enquanto o usuário arrasta o slider: a reprodução automática cede
  // o controle para o arrasto e volta a rodar quando ele solta.
  private isSeeking = false;
  private currentSpeed: SimulationSpeed = 1;
  private accumulator = 0;
  private liveStepCount = 0;
  private viewStepCount = 0;
  private keyframes: Keyframe[] = [];
  private offsideCalls: OffsideCallRecord[] = [];
  private holdRemaining = 0;
  private lastSeenEventId = 0;

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

  /**
   * A bandeira, quando o quadro exibido cai dentro de um impedimento já apitado — seja na revisão
   * automática, seja rebobinando o lance de novo mais tarde. Fora desses trechos, nula.
   */
  get offsideReplay(): OffsideReplay | null {
    const call = this.offsideCalls.find(
      (record) => this.viewStepCount >= record.passStep && this.viewStepCount <= record.callStep,
    );
    if (!call) return null;
    return {
      team: call.team,
      offenderId: call.offenderId,
      lineProgress: call.lineProgress,
      // A linha só cresce na pausa da revisão; revista depois, ela já está inteira.
      reveal: this.holdRemaining > 0 ? 1 - this.holdRemaining / OFFSIDE_REPLAY_HOLD_SECONDS : 1,
    };
  }

  advance(realDeltaSeconds: number): number {
    // Pausado ou arrastando a linha do tempo: nada avança sozinho.
    if (this.isPaused || this.isSeeking) {
      this.accumulator = 0;
      return 0;
    }
    const safeDelta = Number.isFinite(realDeltaSeconds)
      ? Math.min(Math.max(realDeltaSeconds, 0), MAX_REAL_DELTA_SECONDS)
      : 0;
    // A pausa da bandeira congela tudo: o quadro do passe fica na tela, sem avançar um passo.
    if (this.holdRemaining > 0) {
      this.holdRemaining = Math.max(0, this.holdRemaining - safeDelta);
      return 0;
    }
    this.accumulator += safeDelta * this.currentSpeed;
    // Rebobinado, o play reproduz o passado; ao vivo, avança a fronteira.
    return this.scrubbing ? this.playReplayForward() : this.advanceFrontier();
  }

  // Ao vivo: só a fronteira avança no tempo, ditada por play/pausa e velocidade.
  private advanceFrontier(): number {
    if (this.frontier.finished) {
      this.accumulator = 0;
      return 0;
    }
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_ADVANCE) {
      stepMatch(this.frontier, FIXED_STEP);
      this.liveStepCount += 1;
      if (this.liveStepCount % KEYFRAME_INTERVAL_STEPS === 0) this.recordKeyframe();
      this.accumulator -= FIXED_STEP;
      steps += 1;
      // O apito corta o laço: a fronteira precisa parar NELE para o replay terminar na infração,
      // e não alguns quadros adiante (a 8x, um quadro de tela são ~15 passos de jogo).
      if (this.reviewOffsideIfCalled()) return steps;
    }
    // Ao vivo, a visão acompanha a fronteira (mesma referência, custo zero).
    this.viewStepCount = this.liveStepCount;
    this.viewState = this.frontier;
    return steps;
  }

  /**
   * Abre a revisão quando o motor apita um impedimento. A geometria vem do próprio evento — a
   * linha e o instante do passe são o que descreve a infração —, e o passo é a mesma equivalência
   * que a linha do tempo já usa entre tempo de jogo e passo fixo.
   */
  private reviewOffsideIfCalled(): boolean {
    if (this.frontier.eventCounter === this.lastSeenEventId) return false;
    // O log é curto e vem do mais novo para o mais velho: basta varrer o que entrou desde a
    // última leitura. Como isto roda a cada passo, nenhum apito cabe na folga.
    let called: Extract<MatchEvent, { type: "offside-called" }> | null = null;
    for (const event of this.frontier.events) {
      if (event.id <= this.lastSeenEventId) break;
      if (event.type === "offside-called") called = event;
    }
    this.lastSeenEventId = this.frontier.eventCounter;
    if (!called) return false;
    // Ao menos um passo atrás da fronteira: é o replay chegando nela que devolve o jogo ao vivo,
    // e uma revisão que já nascesse ao vivo nunca sairia da frente.
    const passStep = Math.min(Math.round(called.passAt / FIXED_STEP), this.liveStepCount - 1);
    this.offsideCalls.push({
      passStep,
      callStep: this.liveStepCount,
      team: called.team,
      offenderId: called.playerId,
      lineProgress: called.lineProgress,
    });
    this.holdRemaining = OFFSIDE_REPLAY_HOLD_SECONDS;
    this.seek(passStep);
    return true;
  }

  // Rebobinado: reproduz a história para frente re-simulando o clone exibido. A
  // simulação é determinística, então cada passo reproduz exatamente o que a
  // fronteira fez — sem tocar na fronteira nem nos keyframes.
  private playReplayForward(): number {
    let steps = 0;
    while (
      this.accumulator >= FIXED_STEP
      && steps < MAX_STEPS_PER_ADVANCE
      && this.viewStepCount < this.liveStepCount
    ) {
      stepMatch(this.viewState, FIXED_STEP);
      this.viewStepCount += 1;
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
    // Alcançou a fronteira? Reancora ao vivo (mesma referência, custo zero).
    if (this.viewStepCount >= this.liveStepCount) {
      this.accumulator = 0;
      this.viewStepCount = this.liveStepCount;
      this.viewState = this.frontier;
    }
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
    this.holdRemaining = 0;
    this.seek(this.liveStepCount);
  }

  /** O usuário pegou o slider: suspende a reprodução automática enquanto arrasta. */
  beginSeek(): void {
    // Quem pega a linha do tempo assume o lance: a pausa da revisão sai da frente na hora. A
    // bandeira não — ela pertence ao trecho, e volta sempre que ele for revisto.
    this.holdRemaining = 0;
    this.isSeeking = true;
  }

  /** O usuário soltou o slider: a reprodução automática volta a valer. */
  endSeek(): void {
    this.isSeeking = false;
  }

  private reconstructAt(step: number): MatchState {
    const keyframe = this.keyframeAtOrBefore(step);
    const state = restoreMatchSnapshot(keyframe.snapshot);
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
    this.keyframes.push({ step: this.liveStepCount, snapshot: captureMatchSnapshot(this.frontier) });
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

  /**
   * Ajuste do treinador com a bola rolando. Só faz sentido ao vivo — ordem é para agora —, então
   * a visão volta à fronteira antes de aplicar.
   *
   * O keyframe no fim não é zelo: reconstruir o passado re-simula a partir do keyframe anterior,
   * e isso só reproduz a história enquanto o trecho entre dois keyframes for função pura do
   * primeiro. Mudar o plano quebra essa pureza — abrir um keyframe aqui a restabelece.
   */
  adjust(team: Team, adjustment: TeamAdjustment): void {
    this.resumeLive();
    applyTeamAdjustment(this.frontier, team, adjustment);
    this.recordKeyframe();
  }

  restart(config: MatchConfig): void {
    this.frontier = createMatchState(config);
    this.viewState = this.frontier;
    this.accumulator = 0;
    this.liveStepCount = 0;
    this.viewStepCount = 0;
    this.keyframes = [];
    this.lastSeenEventId = 0;
    this.offsideCalls = [];
    this.holdRemaining = 0;
    this.recordKeyframe();
  }
}
