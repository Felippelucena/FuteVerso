import type { GameApplication } from "../../application/game-application";
import { find } from "../app/dom";
import { html, type Html } from "../app/html";
import { icon } from "../app/icons";
import type { Navigation, Screen, ScreenDefinition } from "../app/screen";

const menuTemplate = (): Html => html`
  <section data-screen="menu" class="menu-view">
    <div class="menu-hero">
      <span class="eyebrow">SIMULADOR DE FUTEBOL 2D</span>
      <h2>FuteVerso</h2>
      <p>Monte o mundo no editor e ponha os agentes em campo.</p>
    </div>
    <nav class="menu-actions" aria-label="Modos do jogo">
      <button type="button" class="menu-card" id="menu-resume" hidden>
        ${icon("Play")}<strong>Retomar partida</strong><span id="menu-resume-detail">Partida congelada</span>
      </button>
      <button type="button" class="menu-card" id="menu-quick">
        ${icon("Goal")}<strong>Jogo rápido</strong><span>Escolha dois clubes, ajuste o plano tático e assista.</span>
      </button>
      <button type="button" class="menu-card" id="menu-editor">
        ${icon("Pencil")}<strong>Editor</strong><span>Clubes, jogadores e o conteúdo do seu mundo.</span>
      </button>
    </nav>
    <p id="menu-message" class="menu-message" aria-live="polite"></p>
  </section>`;

export const menuScreenDefinition = (application: GameApplication): ScreenDefinition => ({
  id: "menu",
  label: "Início",
  icon: "Goal",
  template: menuTemplate,
  mount: ({ root, navigation }) => new MenuScreen(root, navigation, application),
});

const MISSING_CLUBS = "O catálogo precisa de dois clubes para uma partida. Crie-os no editor.";

export class MenuScreen implements Screen {
  private playable = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly navigation: Navigation,
    private readonly application: GameApplication,
  ) {
    this.find("#menu-quick").addEventListener("click", () => this.startQuickGame());
    this.find("#menu-editor").addEventListener("click", () => {
      this.navigation.push({ screenId: "editor", params: { entity: "clubs" } });
    });
    this.find("#menu-resume").addEventListener("click", () => {
      this.navigation.push({ screenId: "match" });
    });
  }

  render(): void {
    const match = this.application.match;
    const resume = this.find<HTMLButtonElement>("#menu-resume");
    resume.hidden = match === null;
    if (match) {
      const { stats } = match.state;
      this.find("#menu-resume-detail").textContent = `${stats.blue.goals} × ${stats.coral.goals} · congelada`;
    }
    void this.application.clubCount().then((count) => {
      this.playable = count >= 2;
      this.setMessage(this.playable ? "" : MISSING_CLUBS);
    });
  }

  private startQuickGame(): void {
    if (!this.playable) {
      this.setMessage(MISSING_CLUBS, true);
      return;
    }
    this.navigation.push({ screenId: "quick-clubs" });
  }

  private setMessage(message: string, error = false): void {
    const element = this.find("#menu-message");
    element.textContent = message;
    element.classList.toggle("is-error", error);
  }

  private find<T extends HTMLElement>(selector: string): T {
    return find<T>(this.root, selector);
  }
}
