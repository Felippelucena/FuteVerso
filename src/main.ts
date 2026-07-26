import { GameApplication } from "./application/game-application";
import { bootstrapCatalog } from "./application/world/bootstrap-catalog";
import type { Catalog } from "./application/ports/catalog";
import { IndexedDbCatalog } from "./infrastructure/persistence/indexeddb-catalog";
import { MemoryCatalog } from "./infrastructure/persistence/memory-catalog";
import { AnimationLoop } from "./presentation/app/animation-loop";
import { Navigator } from "./presentation/app/navigator";
import { render } from "./presentation/app/dom";
import { html } from "./presentation/app/html";
import { editorScreenDefinition } from "./presentation/editor/editor-screen";
import { MatchHeader } from "./presentation/match/match-header";
import { matchScreenDefinition } from "./presentation/match/match-screen";
import { menuScreenDefinition } from "./presentation/menu/menu-screen";
import { playersEntity } from "./presentation/players/players-screen";
import { clubSelectScreenDefinition } from "./presentation/quick-game/club-select-screen";
import { planScreenDefinition } from "./presentation/quick-game/plan-screen";
import "@fontsource-variable/inter";
import "./presentation/styles/index.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Elemento raiz não encontrado.");

// Sem IndexedDB (navegação privada, permissão negada) o jogo roda igual, só não guarda nada.
const createCatalog = (): Catalog => {
  try {
    if (typeof indexedDB !== "undefined") return new IndexedDbCatalog(indexedDB, window.localStorage);
  } catch {
    // cai no catálogo volátil
  }
  return new MemoryCatalog();
};

const boot = async (): Promise<void> => {
  render(root, html`<div class="boot-screen"><span class="brand-mark" aria-hidden="true"></span><p>Carregando o mundo…</p></div>`);

  const catalog = createCatalog();
  const application = new GameApplication(catalog, await bootstrapCatalog(catalog));
  const navigator = new Navigator(root, [
    menuScreenDefinition(application),
    clubSelectScreenDefinition(application),
    planScreenDefinition(application),
    matchScreenDefinition(application),
    editorScreenDefinition(application, [playersEntity]),
  ], { screenId: "menu" });
  const header = new MatchHeader(navigator.statusSlot, application);
  const loop = new AnimationLoop(application, () => navigator.activeScreen, () => header.render());

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) application.persistMatchProgress();
  });
  loop.start();

  // DEBUG (somente desenvolvimento): expõe o jogo no console para inspeção do estado.
  // Ex.: window.fv.session.togglePaused(), window.fv.state.ball, await window.fv.world()
  (window as unknown as { fv: unknown }).fv = {
    application,
    catalog,
    navigator,
    loop,
    get session() {
      return application.match;
    },
    get state() {
      return application.match?.state ?? null;
    },
    // Função, e não getter: montar o mundo inteiro é uma varredura do catálogo, e no console
    // isso precisa ser um pedido explícito.
    world: () => catalog.exportWorld(),
  };
};

void boot().catch((error: unknown) => {
  console.error(error);
  render(root, html`<div class="boot-screen"><p>Não foi possível iniciar o jogo.</p><pre>${String(error)}</pre></div>`);
});
