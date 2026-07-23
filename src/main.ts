import { GameApplication } from "./application/game-application";
import { createDefaultProfile } from "./application/profile/create-default-profile";
import { LocalStorageSaveRepository } from "./infrastructure/persistence/local-storage-save-repository";
import { AnimationLoop } from "./presentation/app/animation-loop";
import { AppShell } from "./presentation/app/app-shell";
import { GameRenderer } from "./presentation/canvas/game-renderer";
import { MatchScreen } from "./presentation/match/match-screen";
import { PlayersScreen } from "./presentation/players/players-screen";
import "./style.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Elemento raiz não encontrado.");

const repository = new LocalStorageSaveRepository(window.localStorage, createDefaultProfile);
const application = new GameApplication(repository);
const shell = new AppShell(root);
const canvas = shell.matchRoot.querySelector<HTMLCanvasElement>("#game-canvas");
if (!canvas) throw new Error("Canvas da partida não encontrado.");

const renderer = new GameRenderer(canvas);
const matchScreen = new MatchScreen(
  shell.matchRoot,
  shell.matchSettingsDialog,
  application,
  renderer,
  (state, paused) => shell.renderMatchHeader(state, paused),
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
// Ex.: window.fv.session.togglePaused(), window.fv.state.ball, window.fv.state.players
(window as unknown as { fv: unknown }).fv = {
  application,
  get session() {
    return application.match;
  },
  get state() {
    return application.state;
  },
  matchScreen,
  playersScreen,
  renderer,
  loop,
  shell,
};
