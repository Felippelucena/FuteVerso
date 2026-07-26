import { find, render } from "./dom";
import { html } from "./html";
import { icon } from "./icons";
import type { Navigation, Route, Screen, ScreenDefinition } from "./screen";

interface MountedScreen {
  readonly screen: Screen;
  readonly slot: HTMLElement;
  readonly dialogs: HTMLElement;
}

/** Duas rotas com a mesma tela e parâmetros diferentes são telas diferentes. */
const routeKey = ({ screenId, params }: Route): string => {
  const entries = Object.entries(params ?? {}).sort(([first], [second]) => first.localeCompare(second));
  return entries.length === 0 ? screenId : `${screenId}?${entries.map(([key, value]) => `${key}=${value}`).join("&")}`;
};

const shellTemplate = () => html`
  <main class="app-shell">
    <header class="topbar">
      <div class="topbar-lead">
        <button class="icon-button back-button" id="nav-back" type="button" aria-label="Voltar" title="Voltar" hidden>${icon("ChevronLeft")}</button>
        <div class="brand-lockup"><span class="brand-mark" aria-hidden="true"></span><div><h1>FuteVerso</h1><p class="eyebrow">SIMULADOR de Futebol 2D</p></div></div>
      </div>
      <nav class="nav-trail" id="nav-trail" aria-label="Trilha de navegação"></nav>
      <div class="session-status" id="session-status" hidden></div>
    </header>
    <div class="screen-host" id="screen-host"></div>
  </main>
  <div class="dialog-host"></div>`;

/**
 * Navegação em pilha. Substitui a barra de abas plana: o jogo agora tem profundidade (menu →
 * clubes → plano → partida) e voltar precisa significar alguma coisa. Telas são montadas na
 * primeira visita e mantidas — o conjunto é pequeno e limitado, e remontar custaria o canvas.
 */
export class Navigator implements Navigation {
  /** Faixa no topo, preenchida pelo compositor. Só aparece nas telas de chrome `match`. */
  readonly statusSlot: HTMLElement;
  private readonly definitions = new Map<string, ScreenDefinition>();
  private readonly mounted = new Map<string, MountedScreen>();
  private readonly host: HTMLElement;
  private readonly dialogHost: HTMLElement;
  private readonly trail: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private stack: Route[] = [];

  constructor(root: HTMLElement, definitions: readonly ScreenDefinition[], initial: Route) {
    for (const definition of definitions) this.definitions.set(definition.id, definition);
    if (!this.definitions.has(initial.screenId)) throw new Error(`Tela inicial ${initial.screenId} não registrada.`);

    render(root, shellTemplate());
    this.statusSlot = find<HTMLElement>(root, "#session-status");
    this.host = find<HTMLElement>(root, "#screen-host");
    this.dialogHost = find<HTMLElement>(root, ".dialog-host");
    this.trail = find<HTMLElement>(root, "#nav-trail");
    this.backButton = find<HTMLButtonElement>(root, "#nav-back");
    this.backButton.addEventListener("click", () => this.back());
    this.trail.addEventListener("click", (event) => {
      const step = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-trail-step]");
      if (step) this.truncate(Number(step.dataset.trailStep));
    });

    this.stack = [initial];
    this.activate();
  }

  get activeScreen(): Screen {
    return this.mounted.get(routeKey(this.currentRoute))!.screen;
  }

  get currentRoute(): Route {
    return this.stack[this.stack.length - 1];
  }

  push(route: Route): void {
    this.suspendCurrent();
    this.stack = [...this.stack, route];
    this.activate();
  }

  replace(route: Route): void {
    this.suspendCurrent();
    this.stack = [...this.stack.slice(0, -1), route];
    this.activate();
  }

  back(): void {
    if (this.stack.length < 2) return;
    this.truncate(this.stack.length - 2);
  }

  reset(route: Route): void {
    this.suspendCurrent();
    this.stack = [route];
    this.activate();
  }

  private truncate(index: number): void {
    if (index < 0 || index >= this.stack.length - 1) return;
    this.suspendCurrent();
    this.stack = this.stack.slice(0, index + 1);
    this.activate();
  }

  private suspendCurrent(): void {
    this.mounted.get(routeKey(this.currentRoute))?.screen.suspend?.();
  }

  /**
   * Tela fora da pilha é descartada. Sem isto, cada combinação de parâmetros visitada deixaria
   * uma montagem para trás. Nada de valor se perde: o que sobrevive a sair de cena — a partida —
   * vive na aplicação, não na tela, e remontar custa só o DOM.
   */
  private discardOutsideStack(): void {
    const alive = new Set(this.stack.map(routeKey));
    for (const [key, { slot, dialogs }] of this.mounted) {
      if (alive.has(key)) continue;
      slot.remove();
      dialogs.remove();
      this.mounted.delete(key);
    }
  }

  private activate(): void {
    const route = this.currentRoute;
    const key = routeKey(route);
    this.discardOutsideStack();
    const active = this.mounted.get(key) ?? this.mount(route, key);
    for (const [mountedKey, { slot }] of this.mounted) slot.hidden = mountedKey !== key;

    const definition = this.definitions.get(route.screenId)!;
    this.statusSlot.hidden = definition.chrome !== "match";
    this.trail.hidden = definition.chrome === "match";
    this.backButton.hidden = this.stack.length < 2;
    this.renderTrail();

    active.screen.resize?.();
    active.screen.render();
  }

  private renderTrail(): void {
    if (this.trail.hidden) return;
    render(this.trail, html`${this.stack.map((route, index) => {
      const { label } = this.definitions.get(route.screenId)!;
      const last = index === this.stack.length - 1;
      // O atributo entra como marcação, não como texto: `html` escaparia as aspas.
      return html`<button type="button" data-trail-step="${index}" class="${last ? "is-current" : ""}" ${last ? html`aria-current="page" disabled` : ""}>${label}</button>`;
    })}`);
  }

  private mount(route: Route, key: string): MountedScreen {
    const definition = this.definitions.get(route.screenId);
    if (!definition) throw new Error(`Tela ${route.screenId} não registrada.`);

    const slot = document.createElement("div");
    slot.className = "screen-slot";
    slot.dataset.route = key;
    render(slot, definition.template());
    this.host.append(slot);

    const dialogs = document.createElement("div");
    dialogs.className = "dialog-slot";
    if (definition.dialogs) render(dialogs, definition.dialogs());
    this.dialogHost.append(dialogs);

    const screen = definition.mount({
      root: find<HTMLElement>(slot, "[data-screen]"),
      dialogs,
      params: route.params ?? {},
      navigation: this,
    });
    const entry = { screen, slot, dialogs };
    this.mounted.set(key, entry);
    return entry;
  }
}
