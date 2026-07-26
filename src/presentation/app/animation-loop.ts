import type { GameApplication } from "../../application/game-application";
import type { Screen } from "./screen";

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
    private readonly activeScreen: () => Screen,
    private readonly renderSessionStatus: () => void,
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
    // Fora do fluxo de jogo não há partida; o laço segue vivo só para repintar a tela ativa.
    const steps = this.application.match?.advance(realDelta) ?? 0;
    const screen = this.activeScreen();
    // O canvas é repintado todo frame porque o resize limpa o backing store.
    screen.frame?.();
    if (now - this.lastUiUpdate > UI_INTERVAL_MS) {
      this.lastUiUpdate = now;
      // O status da sessão vai mesmo parado: é ele que mostra a pausa.
      this.renderSessionStatus();
      // O painel da tela, não: pausado/rebobinando/terminado o estado é idêntico,
      // e reescrever o DOM várias vezes por segundo é puro desperdício.
      if (steps > 0) screen.tick?.();
    }
    if (now - this.lastMemorySave > PERSISTENCE_INTERVAL_MS) {
      this.application.persistMatchProgress();
      this.lastMemorySave = now;
    }
    this.frameHandle = requestAnimationFrame(this.frame);
  };
}
