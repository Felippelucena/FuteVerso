import { find, findAll, render } from "./dom";
import { html } from "./html";
import { icon } from "./icons";
import type { Screen, ScreenDefinition } from "./screen";

export class AppShell {
  /** Faixa no topo, sempre visível: quem a preenche é o compositor, não o shell. */
  readonly statusSlot: HTMLElement;
  private readonly screens = new Map<string, Screen>();
  private readonly roots = new Map<string, HTMLElement>();
  private currentId: string;

  constructor(private readonly root: HTMLElement, definitions: readonly ScreenDefinition[]) {
    const first = definitions[0];
    if (!first) throw new Error("O shell precisa de ao menos uma tela.");
    render(root, html`
      <main class="app-shell">
        <header class="topbar">
          <div class="brand-lockup"><span class="brand-mark" aria-hidden="true"></span><div><h1>FuteVerso</h1><p class="eyebrow">SIMULADOR de Futebol 2D</p></div></div>
          <div class="session-status" id="session-status"></div>
        </header>
        <nav class="view-tabs" aria-label="Áreas do simulador">
          ${definitions.map((definition) => html`<button type="button" data-view="${definition.id}">${icon(definition.icon)}${definition.label}</button>`)}
        </nav>
        ${definitions.map((definition) => definition.template())}
      </main>
      <div class="dialog-host">${definitions.map((definition) => definition.dialogs?.())}</div>`);

    this.statusSlot = find<HTMLElement>(root, "#session-status");
    const dialogs = find<HTMLElement>(root, ".dialog-host");
    for (const definition of definitions) {
      const screenRoot = find<HTMLElement>(root, `[data-screen="${definition.id}"]`);
      this.roots.set(definition.id, screenRoot);
      this.screens.set(definition.id, definition.mount({ root: screenRoot, dialogs }));
    }
    for (const tab of findAll<HTMLButtonElement>(root, "[data-view]")) {
      tab.addEventListener("click", () => this.setView(tab.dataset.view!));
    }
    this.currentId = first.id;
    this.setView(first.id);
  }

  get activeScreen(): Screen {
    return this.screens.get(this.currentId)!;
  }

  setView(id: string): void {
    this.currentId = id;
    for (const tab of findAll<HTMLElement>(this.root, "[data-view]")) {
      tab.classList.toggle("is-active", tab.dataset.view === id);
    }
    for (const [screenId, element] of this.roots) element.hidden = screenId !== id;
    const screen = this.activeScreen;
    screen.resize?.();
    screen.render();
  }
}
