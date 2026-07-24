import type { MatchState } from "../../domain/match";
import { matchScreenTemplate, matchSettingsTemplate } from "../match/match-screen";
import { playerDialogTemplate, playersScreenTemplate } from "../players/players-screen";
import { formatClock, type TeamNames } from "./labels";
import { hydrateIcons } from "./icons";

export type AppView = "match" | "players";

export class AppShell {
  readonly matchRoot: HTMLElement;
  readonly playersRoot: HTMLElement;
  readonly matchSettingsDialog: HTMLDialogElement;
  readonly playerDialog: HTMLDialogElement;
  private viewChanged: ((view: AppView) => void) | null = null;

  constructor(private readonly root: HTMLDivElement) {
    root.innerHTML = `
      <main class="app-shell">
        <header class="topbar">
          <div class="brand-lockup"><span class="brand-mark" aria-hidden="true"></span><div><h1>FuteVerso</h1><p>SIMULADOR de Futebol 2D</p></div></div>
          <section class="scoreboard" aria-label="Placar">
            <div class="score-team score-team--blue"><span id="score-name-blue">CASA</span><strong id="score-blue">0</strong></div>
            <div class="match-clock"><span id="match-time">00:00</span><small id="match-state">EM CURSO</small></div>
            <div class="score-team score-team--coral"><strong id="score-coral">0</strong><span id="score-name-coral">VISITANTE</span></div>
          </section>
          <div class="simulation-status"><span class="live-dot"></span><span>SIMULAÇÃO ATIVA</span></div>
        </header>
        <nav class="view-tabs" aria-label="Áreas do simulador">
          <button type="button" class="is-active" data-view="match"><i data-lucide="goal"></i>Partida</button>
          <button type="button" data-view="players"><i data-lucide="users"></i>Jogadores</button>
        </nav>
        ${matchScreenTemplate()}
        ${playersScreenTemplate()}
      </main>
      ${playerDialogTemplate()}
      ${matchSettingsTemplate()}
    `;
    this.matchRoot = this.find("#match-view");
    this.playersRoot = this.find("#players-view");
    this.matchSettingsDialog = this.find("#match-settings-dialog");
    this.playerDialog = this.find("#player-dialog");
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-view]")) {
      button.addEventListener("click", () => this.setView(button.dataset.view as AppView));
    }
    hydrateIcons();
  }

  onViewChanged(listener: (view: AppView) => void): void {
    this.viewChanged = listener;
  }

  setView(view: AppView): void {
    this.root.querySelectorAll<HTMLElement>("[data-view]").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.view === view);
    });
    this.matchRoot.hidden = view !== "match";
    this.playersRoot.hidden = view !== "players";
    this.viewChanged?.(view);
  }

  renderTeamNames(names: TeamNames): void {
    this.find("#score-name-blue").textContent = names.blue;
    this.find("#score-name-coral").textContent = names.coral;
  }

  renderMatchHeader(state: MatchState, paused: boolean): void {
    this.find("#score-blue").textContent = String(state.stats.blue.goals);
    this.find("#score-coral").textContent = String(state.stats.coral.goals);
    this.find("#match-time").textContent = formatClock(state.elapsed);
    this.find("#match-state").textContent = state.finished ? "ENCERRADA" : "EM CURSO";
    this.find(".simulation-status span:last-child").textContent = paused ? "SIMULAÇÃO PAUSADA" : "SIMULAÇÃO ATIVA";
    this.find(".live-dot").classList.toggle("is-paused", paused);
  }

  private find<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Elemento ${selector} não encontrado.`);
    return element;
  }
}
