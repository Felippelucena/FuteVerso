import type { GameApplication } from "../../application/game-application";
import type { GameRenderer } from "../canvas/game-renderer";

const UI_INTERVAL_MS = 140;
const PERSISTENCE_INTERVAL_MS = 5000;

export class AnimationLoop {
  private running = false;
  private frameHandle: number | null = null;
  private previousTime = 0;
  private lastUiUpdate = 0;
  private lastMemorySave = 0;

  constructor(
    private readonly application: GameApplication,
    private readonly renderer: GameRenderer,
    private readonly renderUi: () => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previousTime = performance.now();
    this.lastMemorySave = this.previousTime;
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const realDelta = (now - this.previousTime) / 1000;
    this.previousTime = now;
    const steps = this.application.match.advance(realDelta);
    this.renderer.render(this.application.state);
    // Só reconstrói o painel (roster, timeline, análise…) quando a simulação de
    // fato avançou. Pausado/rebobinando/terminado o estado é idêntico, e reescrever
    // o DOM várias vezes por segundo é puro desperdício. O canvas continua sendo
    // repintado todo frame porque o resize limpa o backing store.
    if (steps > 0 && now - this.lastUiUpdate > UI_INTERVAL_MS) {
      this.renderUi();
      this.lastUiUpdate = now;
    }
    if (now - this.lastMemorySave > PERSISTENCE_INTERVAL_MS) {
      this.application.persistMatchProgress();
      this.lastMemorySave = now;
    }
    this.frameHandle = requestAnimationFrame(this.frame);
  };
}
