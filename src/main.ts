import { GameApplication } from "./application/game-application";
import { bootstrapWorld } from "./application/world/bootstrap-world";
import type { WorldRepository } from "./application/ports/world-repository";
import { IndexedDbWorldRepository } from "./infrastructure/persistence/indexeddb-world-repository";
import { MemoryWorldRepository } from "./infrastructure/persistence/memory-world-repository";
import { AnimationLoop } from "./presentation/app/animation-loop";
import { AppShell } from "./presentation/app/app-shell";
import { render } from "./presentation/app/dom";
import { html } from "./presentation/app/html";
import { MatchHeader } from "./presentation/match/match-header";
import { matchScreenDefinition } from "./presentation/match/match-screen";
import { playersScreenDefinition } from "./presentation/players/players-screen";
import "@fontsource-variable/inter";
import "./presentation/styles/index.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Elemento raiz não encontrado.");

// Sem IndexedDB (navegação privada, permissão negada) o jogo roda igual, só não guarda nada.
const createRepository = (): WorldRepository => {
  try {
    if (typeof indexedDB !== "undefined") return new IndexedDbWorldRepository(indexedDB, window.localStorage);
  } catch {
    // cai no repositório volátil
  }
  return new MemoryWorldRepository();
};

const boot = async (): Promise<void> => {
  render(root, html`<div class="boot-screen"><span class="brand-mark" aria-hidden="true"></span><p>Carregando o mundo…</p></div>`);

  const repository = createRepository();
  const application = new GameApplication(await bootstrapWorld(repository), repository);
  const shell = new AppShell(root, [
    matchScreenDefinition(application),
    playersScreenDefinition(application),
  ]);
  const header = new MatchHeader(shell.statusSlot, application);
  const loop = new AnimationLoop(application, () => shell.activeScreen, () => header.render());

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) application.persistMatchProgress();
  });
  loop.start();

  // DEBUG (somente desenvolvimento): expõe o jogo no console para inspeção do estado.
  // Ex.: window.fv.session.togglePaused(), window.fv.state.ball, window.fv.world.clubs
  (window as unknown as { fv: unknown }).fv = {
    application,
    repository,
    shell,
    loop,
    get session() {
      return application.match;
    },
    get state() {
      return application.state;
    },
    get world() {
      return application.world;
    },
  };
};

void boot().catch((error: unknown) => {
  console.error(error);
  render(root, html`<div class="boot-screen"><p>Não foi possível iniciar o jogo.</p><pre>${String(error)}</pre></div>`);
});
