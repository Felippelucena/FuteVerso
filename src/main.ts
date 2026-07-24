import { GameApplication } from "./application/game-application";
import { bootstrapWorld } from "./application/world/bootstrap-world";
import type { WorldRepository } from "./application/ports/world-repository";
import { IndexedDbWorldRepository } from "./infrastructure/persistence/indexeddb-world-repository";
import { MemoryWorldRepository } from "./infrastructure/persistence/memory-world-repository";
import { AnimationLoop } from "./presentation/app/animation-loop";
import { AppShell } from "./presentation/app/app-shell";
import { GameRenderer } from "./presentation/canvas/game-renderer";
import { MatchScreen } from "./presentation/match/match-screen";
import { PlayersScreen } from "./presentation/players/players-screen";
import "./style.css";

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
  root.innerHTML = `<div class="boot-screen"><span class="brand-mark" aria-hidden="true"></span><p>Carregando o mundo…</p></div>`;

  const repository = createRepository();
  const world = await bootstrapWorld(repository);
  const application = new GameApplication(world, repository);

  const shell = new AppShell(root);
  const canvas = shell.matchRoot.querySelector<HTMLCanvasElement>("#game-canvas");
  if (!canvas) throw new Error("Canvas da partida não encontrado.");

  const renderer = new GameRenderer(canvas);
  const matchScreen = new MatchScreen(
    shell.matchRoot,
    shell.matchSettingsDialog,
    application,
    renderer,
    (state, paused, teamNames) => {
      shell.renderMatchHeader(state, paused);
      shell.renderTeamNames(teamNames);
    },
  );
  const playersScreen = new PlayersScreen(shell.playersRoot, shell.playerDialog, application);
  const loop = new AnimationLoop(application, renderer, () => matchScreen.render());
  const resizeObserver = new ResizeObserver(() => matchScreen.resize());

  shell.onViewChanged((view) => {
    if (view === "players") playersScreen.render();
    else matchScreen.resize();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) application.persistMatchProgress();
  });
  resizeObserver.observe(canvas);
  matchScreen.resize();
  playersScreen.render();
  matchScreen.render();
  loop.start();

  // DEBUG (somente desenvolvimento): expõe o jogo no console para inspeção do estado.
  // Ex.: window.fv.session.togglePaused(), window.fv.state.ball, window.fv.world.clubs
  (window as unknown as { fv: unknown }).fv = {
    application,
    repository,
    get session() {
      return application.match;
    },
    get state() {
      return application.state;
    },
    get world() {
      return application.world;
    },
    matchScreen,
    playersScreen,
    renderer,
    loop,
    shell,
  };
};

void boot().catch((error: unknown) => {
  console.error(error);
  root.innerHTML = `<div class="boot-screen"><p>Não foi possível iniciar o jogo.</p><pre>${String(error)}</pre></div>`;
});
