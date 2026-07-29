import type { CommandError, GameApplication } from "../../application/game-application";
import { MatchSession, SIMULATION_SPEEDS, type SimulationSpeed } from "../../application/match/match-session";
import type { AssignmentDuty, MatchState } from "../../domain/match/model";
import type { Team } from "../../domain/shared/model";
import type { TeamTacticalPlan } from "../../domain/tactics/model";
import { createEmptyPlan } from "../../domain/tactics/rules";
import { PlanEditor } from "../tactics/plan-editor";
import { GameRenderer } from "../canvas/game-renderer";
import { find, render } from "../app/dom";
import { html, type Html } from "../app/html";
import { DUTY_LABELS, formatClock, PHASE_LABELS, type TeamNames } from "../app/labels";
import { icon } from "../app/icons";
import type { Screen, ScreenDefinition } from "../app/screen";
import { Section } from "../app/section";
import { formatMatchEvent } from "./format-match-event";
import { drawMomentum, drawShotMap, drawXgTimeline } from "./match-charts";
import { RosterList, rosterSignature } from "./match-roster";
import { createStatGroups, StatTable, statTableSignature } from "./match-stats";
import { createContestMetric, createMatchHeaderViewModel, createMatchSummary, createPlayerDetailViewModel, playerDetailSignature, type PlayerDetailViewModel } from "./match-view-model";
import { drawTacticalMap } from "./tactical-map";
import { teamNamesOf } from "./team-names";

const matchScreenTemplate = (): Html => html`
  <section data-screen="match" class="workspace">
    <div class="field-panel">
      <div class="field-toolbar">
        <div class="toolbar-title"><strong>Partida autônoma</strong><span id="possession-label">Bola em disputa</span></div>
        <div class="toolbar-actions">
          <button class="icon-button" id="open-match-plan" type="button" aria-label="Ajustar o plano tático" title="Plano tático">${icon("Wand2")}</button>
          <button class="icon-button mobile-settings-button" data-open-match-settings type="button" aria-label="Abrir configurações da partida" title="Configurações">${icon("SlidersHorizontal")}</button>
          <button class="icon-button" id="pause-button" type="button" aria-label="Pausar simulação" title="Pausar simulação">${icon("Pause")}</button>
          <button class="icon-button" id="reset-button" type="button" aria-label="Reiniciar partida" title="Reiniciar partida">${icon("RotateCcw")}</button>
          <div class="speed-control" aria-label="Velocidade da simulação">
            ${SIMULATION_SPEEDS.map((speed) => html`<button type="button" data-speed="${speed}" class="${speed === 1 ? "is-active" : ""}">${speed}×</button>`)}
          </div>
        </div>
      </div>
      <div class="canvas-wrap"><canvas id="game-canvas" aria-label="Campo de futebol com oito agentes autônomos"></canvas></div>
      <div class="timeline" aria-label="Linha do tempo da partida">
        <button class="icon-button" id="live-button" type="button" aria-label="Voltar ao vivo" title="Voltar ao vivo" disabled>${icon("Radio")}</button>
        <input id="timeline-slider" class="timeline-slider" type="range" min="0" max="0" value="0" step="1" aria-label="Posição na linha do tempo" />
        <span class="timeline-clock"><span id="timeline-view">0:00</span> / <span id="timeline-live">0:00</span></span>
      </div>
      <div class="match-strip">
        <div><span>POSSE <em id="possession-name-blue">CASA</em></span><strong id="possession-blue">50%</strong></div>
        <div class="possession-track"><span id="possession-fill"></span></div>
        <div><span>POSSE <em id="possession-name-coral">VISITANTE</em></span><strong id="possession-coral">50%</strong></div>
        <div class="strip-minor"><span>xG</span><strong id="xg-blue">0.00</strong></div>
        <div class="possession-track possession-track--xg"><span id="xg-fill"></span></div>
        <div class="strip-minor"><strong id="xg-coral">0.00</strong><span>xG</span></div>
      </div>
    </div>
    <aside class="inspector" aria-label="Painel da partida">
      <div class="inspector-heading">
        <div><span class="eyebrow">CENTRAL DA PARTIDA</span><h2>Leitura ao vivo</h2></div>
        <button class="icon-button" data-open-match-settings type="button" aria-label="Abrir configurações da partida" title="Configurações">${icon("SlidersHorizontal")}</button>
      </div>
      <div class="inspector-tabs" role="tablist" aria-label="Dados da partida">
        <button type="button" role="tab" aria-selected="true" aria-controls="inspector-players" class="is-active" data-inspector-tab="players">Jogadores</button>
        <button type="button" role="tab" aria-selected="false" aria-controls="inspector-analysis" data-inspector-tab="analysis">Análise</button>
        <button type="button" role="tab" aria-selected="false" aria-controls="inspector-events" data-inspector-tab="events">Eventos</button>
      </div>
      <section id="inspector-players" class="inspector-panel is-active" role="tabpanel" data-inspector-panel="players">
        <div id="match-roster" class="match-roster"></div><div id="player-detail" class="player-detail"></div>
      </section>
      <section id="inspector-analysis" class="inspector-panel analysis-section" role="tabpanel" data-inspector-panel="analysis" hidden aria-label="Análise tática da partida">
        <div class="analysis-heading"><div><span class="eyebrow">TÁTICA</span><strong id="analysis-title">Relatório ao vivo</strong></div><span id="contest-metric">Disputa 0%</span></div>
        <div class="phase-grid">
          <div class="phase-card phase-card--blue"><small id="phase-name-blue">CASA</small><strong id="phase-blue">Bloco médio</strong><span id="shape-blue">Largura 0 · Prof. 0</span><span id="duties-blue" class="phase-duties">-</span><canvas id="tactical-map-blue" width="128" height="72" aria-label="Mapa de calor e rede de passes do time da casa"></canvas></div>
          <div class="phase-card phase-card--coral"><small id="phase-name-coral">VISITANTE</small><strong id="phase-coral">Bloco médio</strong><span id="shape-coral">Largura 0 · Prof. 0</span><span id="duties-coral" class="phase-duties">-</span><canvas id="tactical-map-coral" width="128" height="72" aria-label="Mapa de calor e rede de passes do time visitante"></canvas></div>
        </div>
        <div class="chart-block">
          <div class="chart-head"><strong>MAPA DE CHUTES</strong><span id="shot-count">0 finalizações</span></div>
          <canvas id="shot-map" aria-label="Mapa de chutes: cada ponto é uma finalização, o tamanho é o quanto a chance valia"></canvas>
          <div class="chart-legend">
            <span><i class="key key--goal"></i>gol</span><span><i class="key key--saved"></i>defendido</span>
            <span><i class="key key--blocked"></i>bloqueado</span><span><i class="key key--off"></i>sem desfecho</span>
            <span><i class="key key--wood"></i>trave</span>
          </div>
        </div>
        <div class="chart-block">
          <div class="chart-head"><strong>xG ACUMULADO</strong><span id="xg-summary">0.00 — 0.00</span></div>
          <canvas id="xg-timeline" aria-label="Curvas de gols esperados acumulados ao longo da partida"></canvas>
        </div>
        <div class="chart-block">
          <div class="chart-head"><strong>MOMENTO</strong><span>quem está por cima</span></div>
          <canvas id="momentum-chart" aria-label="Gráfico de momento: barras para cima são pressão da casa, para baixo do visitante"></canvas>
        </div>
        <div class="analysis-table" id="analysis-table"></div>
        <p id="match-summary" class="match-summary">A análise será atualizada conforme a partida evolui.</p>
      </section>
      <section id="inspector-events" class="inspector-panel events-section" role="tabpanel" data-inspector-panel="events" hidden>
        <div class="events-heading"><span class="eyebrow">ÚLTIMOS EVENTOS</span><small>Atualização ao vivo</small></div><ol id="event-list" class="event-list"></ol>
      </section>
    </aside>
  </section>`;

const matchSettingsTemplate = (): Html => html`
  <dialog id="match-settings-dialog" class="settings-dialog">
    <form method="dialog">
      <div class="dialog-heading"><div><span class="eyebrow">PARTIDA</span><h2>Configurações</h2></div><button class="icon-button" value="cancel" aria-label="Fechar configurações" title="Fechar">${icon("X")}</button></div>
      <div class="settings-group">
        <div><strong>Times em campo</strong><p>Trocar de clube reinicia a partida com o plano padrão de cada um.</p></div>
        <div class="seed-control seed-control--dialog" aria-label="Clubes da partida">
          <select id="settings-club-blue" aria-label="Clube da casa"></select>
          <select id="settings-club-coral" aria-label="Clube visitante"></select>
        </div>
      </div>
      <div class="settings-group">
        <div><strong>Semente da partida</strong><p>Use o mesmo número para reproduzir uma simulação.</p></div>
        <div class="seed-control seed-control--dialog" aria-label="Semente da partida">
          <input id="settings-seed-input" type="number" min="0" max="4294967295" step="1" inputmode="numeric" aria-label="Semente numérica da partida" />
          <button id="settings-random-seed" type="button" aria-label="Gerar nova semente" title="Gerar nova semente">${icon("Dices")}</button>
        </div>
      </div>
      <div class="settings-group settings-group--inline">
        <div><strong>Memória dos agentes</strong><p>Permite que jogadores ajustem suas decisões.</p></div>
        <label class="switch" title="Ativar aprendizado"><input id="learning-toggle" type="checkbox" checked /><span></span></label>
      </div>
      <button id="reset-learning" class="secondary-button settings-reset" type="button">Restaurar memórias iniciais</button>
      <div class="dialog-actions"><button class="primary-button" value="default">Concluir</button></div>
    </form>
  </dialog>`;

/**
 * Ajuste tático com a bola rolando. Diálogo, e não aba do inspetor, porque o campo do editor
 * precisa da largura que a barra lateral não tem — e porque a partida segue correndo atrás.
 */
const matchPlanTemplate = (): Html => html`
  <dialog id="match-plan-dialog" class="entity-dialog">
    <div class="dialog-heading">
      <div><span class="eyebrow">PARTIDA</span><h2>Plano tático</h2></div>
      <button class="icon-button" type="button" data-role="close" aria-label="Fechar" title="Fechar">${icon("X")}</button>
    </div>
    <nav class="dialog-tabs" role="tablist" aria-label="Time a ajustar">
      ${(["blue", "coral"] as const).map((team) => html`<button type="button" role="tab" data-plan-team="${team}"
        class="${team === "blue" ? "is-active" : ""}" aria-selected="${team === "blue" ? "true" : "false"}"
        data-plan-club="${team}">${team === "blue" ? "Casa" : "Visitante"}</button>`)}
    </nav>
    <div class="dialog-panels"><section class="dialog-panel"><div id="match-plan-editor"></div></section></div>
    <p class="dialog-message" data-role="plan-message" aria-live="polite"></p>
  </dialog>`;

const PLAN_ADJUST_MESSAGES: Partial<Record<CommandError, string>> = {
  "lineup-locked": "Trocar quem está em campo é substituição — ainda não dá com a bola rolando.",
  "invalid-plan": "A escalação ficou inválida; o ajuste não foi aplicado.",
  "club-not-found": "A partida não está mais em andamento.",
};

type InspectorTab = "players" | "analysis" | "events";

/** Faixa da nota, para a cor dizer o mesmo que o número antes de alguém ler o número. */
const ratingBand = (rating: string): "high" | "mid" | "low" =>
  Number(rating) >= 7.5 ? "high" : Number(rating) >= 6.5 ? "mid" : "low";

export const matchScreenDefinition = (application: GameApplication): ScreenDefinition => ({
  id: "match",
  label: "Partida",
  icon: "Goal",
  chrome: "match",
  template: matchScreenTemplate,
  dialogs: () => html`${matchSettingsTemplate()}${matchPlanTemplate()}`,
  mount: ({ root, dialogs }) => new MatchScreen(root, dialogs, application),
});

export class MatchScreen implements Screen {
  private selectedPlayerId: string;
  private activeTab: InspectorTab = "players";
  private detailModel: PlayerDetailViewModel | null = null;
  private readonly renderer: GameRenderer;
  private readonly roster: RosterList;
  private readonly statTable: StatTable;
  private readonly rosterSection: Section;
  private readonly detailSection: Section;
  private readonly eventsSection: Section;
  private readonly analysisSection: Section;
  private readonly chartsSection: Section;
  private readonly panels: Record<InspectorTab, () => void>;
  private readonly settingsDialog: HTMLDialogElement;
  private readonly planDialog: HTMLDialogElement;
  private readonly planEditor: PlanEditor;
  private planTeam: Team = "blue";

  constructor(
    private readonly root: HTMLElement,
    dialogs: ParentNode,
    private readonly application: GameApplication,
  ) {
    this.settingsDialog = find<HTMLDialogElement>(dialogs, "#match-settings-dialog");
    this.planDialog = find<HTMLDialogElement>(dialogs, "#match-plan-dialog");
    this.planEditor = new PlanEditor(find(this.planDialog, "#match-plan-editor"), {
      plan: () => this.application.setup?.[this.planTeam].plan ?? createEmptyPlan(),
      squad: () => this.application.squadInPlay(this.planTeam),
      changed: (plan) => this.applyPlan(plan),
      benchLocked: true,
    });
    this.selectedPlayerId = application.requireMatch().state.players[0]?.profile.id ?? "";
    this.renderer = new GameRenderer(this.find("#game-canvas"));
    new ResizeObserver(() => this.resize()).observe(this.find("#game-canvas"));
    this.roster = new RosterList(this.find("#match-roster"));
    this.statTable = new StatTable(this.find("#analysis-table"));
    this.rosterSection = new Section(() => this.roster.rebuild(this.state.players, this.teamNames));
    this.detailSection = new Section(() => this.renderPlayerDetail());
    this.eventsSection = new Section(() => this.renderEvents());
    this.analysisSection = new Section(() => this.statTable.rebuild(createStatGroups(this.state), this.teamNames));
    this.chartsSection = new Section(() => this.renderCharts());
    this.panels = {
      players: () => this.renderPlayersPanel(),
      analysis: () => this.renderAnalysis(),
      events: () => this.eventsSection.update(this.eventsSignature()),
    };
    this.bindEvents();
  }

  /** Esta tela só existe dentro de uma partida — o navegador garante a precondição. */
  private get session(): MatchSession {
    return this.application.requireMatch();
  }

  private get state(): MatchState {
    return this.session.state;
  }

  private get teamNames(): TeamNames {
    return teamNamesOf(this.application);
  }

  tick(): void {
    this.render();
  }

  /** Sair da partida a congela: ela continua retomável pelo menu. */
  suspend(): void {
    this.application.leaveMatch();
  }

  render(): void {
    const state = this.state;
    const header = createMatchHeaderViewModel(state, this.teamNames);
    this.renderTeamNames();
    this.find("#possession-label").textContent = header.possessionLabel;
    this.find("#possession-blue").textContent = `${header.bluePossession}%`;
    this.find("#possession-coral").textContent = `${header.coralPossession}%`;
    this.find<HTMLSpanElement>("#possession-fill").style.width = `${header.bluePossession}%`;
    this.find("#xg-blue").textContent = header.blueXg;
    this.find("#xg-coral").textContent = header.coralXg;
    this.find<HTMLSpanElement>("#xg-fill").style.width = `${header.xgShare}%`;
    this.renderTimeline();
    this.find<HTMLButtonElement>("#pause-button").disabled = state.finished;
    // Só a aba visível é montada: as outras duas nascem `hidden` e reconstruí-las é desperdício.
    this.panels[this.activeTab]();
  }

  private eventsSignature(): string {
    return `${this.state.eventCounter}|${this.teamNames.blue}|${this.teamNames.coral}`;
  }

  private renderEvents(): void {
    // Os nomes vêm dos 22 em campo, não do catálogo: um evento só cita quem está jogando.
    const roster = this.state.players.map((player) => player.profile);
    render(this.find<HTMLOListElement>("#event-list"), html`${this.state.events.map((event) => {
      const team = "team" in event ? event.team : null;
      return html`<li class="event-item ${team ? `event-item--${team}` : ""}"><time>${formatClock(event.time)}</time><span>${formatMatchEvent(event, roster, this.teamNames)}</span></li>`;
    })}`);
  }

  private renderPlayersPanel(): void {
    const state = this.state;
    this.rosterSection.update(rosterSignature(state.players, this.teamNames));
    this.roster.patch(state, this.selectedPlayerId);
    const selected = state.players.find((player) => player.profile.id === this.selectedPlayerId) ?? state.players[0];
    if (!selected) return;
    this.selectedPlayerId = selected.profile.id;
    this.detailModel = createPlayerDetailViewModel(state, selected);
    this.detailSection.update(playerDetailSignature(this.detailModel));
  }

  frame(): void {
    this.renderer.render(this.state, this.session.offsideReplay);
  }

  resize(): void {
    this.renderer.resize();
    this.frame();
  }

  private renderTeamNames(): void {
    const names = this.teamNames;
    for (const team of ["blue", "coral"] as const) {
      this.find(`#possession-name-${team}`).textContent = names[team];
      this.find(`#phase-name-${team}`).textContent = names[team];
    }
  }

  private renderTimeline(): void {
    const match = this.session;
    const slider = this.find<HTMLInputElement>("#timeline-slider");
    slider.max = String(match.liveStep);
    slider.value = String(match.viewStep);
    slider.disabled = match.liveStep === 0;
    this.find("#timeline-view").textContent = formatClock(match.viewElapsed);
    this.find("#timeline-live").textContent = formatClock(match.liveElapsed);
    this.find<HTMLButtonElement>("#live-button").disabled = !match.scrubbing;
    this.find(".timeline").classList.toggle("is-scrubbing", match.scrubbing);
  }

  private renderScrubFrame(): void {
    this.renderer.render(this.state, this.session.offsideReplay);
    this.render();
  }

  private bindEvents(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]")) {
      button.addEventListener("click", () => this.activateInspectorTab(button));
    }
    const pauseButton = this.find<HTMLButtonElement>("#pause-button");
    pauseButton.addEventListener("click", () => {
      this.session.togglePaused();
      this.renderPauseButton();
    });
    this.find("#reset-button").addEventListener("click", () => {
      this.application.restartMatch();
      this.resetSelection();
      this.render();
    });
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
      button.addEventListener("click", () => {
        this.session.setSpeed(Number(button.dataset.speed) as SimulationSpeed);
        this.root.querySelectorAll("[data-speed]").forEach((item) => item.classList.toggle("is-active", item === button));
      });
    }
    const slider = this.find<HTMLInputElement>("#timeline-slider");
    slider.addEventListener("input", () => {
      this.session.beginSeek();
      this.session.seek(Number(slider.value));
      this.renderScrubFrame();
    });
    // Ao soltar o slider, a reprodução volta: continua tocando se não estiver pausada.
    slider.addEventListener("change", () => this.session.endSeek());
    this.find("#live-button").addEventListener("click", () => {
      this.session.resumeLive();
      this.renderScrubFrame();
    });
    this.find("#match-roster").addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-inspect-player]");
      if (!button) return;
      this.selectedPlayerId = button.dataset.inspectPlayer!;
      this.renderPlayersPanel();
    });
    this.bindSettings();
    this.bindPlanDialog();
  }

  private bindPlanDialog(): void {
    this.find("#open-match-plan").addEventListener("click", () => {
      this.renderPlanTeams();
      this.planEditor.render();
      this.planDialog.showModal();
    });
    find(this.planDialog, "[data-role=\"close\"]").addEventListener("click", () => this.planDialog.close());
    for (const button of this.planDialog.querySelectorAll<HTMLButtonElement>("[data-plan-team]")) {
      button.addEventListener("click", () => {
        this.planTeam = button.dataset.planTeam as Team;
        this.renderPlanTeams();
        this.planEditor.render();
      });
    }
  }

  private renderPlanTeams(): void {
    const names = this.teamNames;
    for (const button of this.planDialog.querySelectorAll<HTMLButtonElement>("[data-plan-team]")) {
      const team = button.dataset.planTeam as Team;
      const active = team === this.planTeam;
      button.textContent = names[team];
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    }
  }

  /**
   * O ajuste vale na hora: não há Salvar aqui, como não há na beira do gramado. O plano do lado
   * também vive no setup, então reiniciar a partida entra com o que foi ajustado.
   */
  private applyPlan(plan: TeamTacticalPlan): void {
    const result = this.application.adjustPlan(this.planTeam, plan);
    const message = find(this.planDialog, "[data-role=\"plan-message\"]");
    message.textContent = result.ok ? "" : PLAN_ADJUST_MESSAGES[result.reason] ?? "Não foi possível ajustar o plano.";
    message.classList.toggle("is-error", !result.ok);
  }

  private async renderClubSelectors(): Promise<void> {
    const { rows } = await this.application.queries.clubs.page({ sort: "name" });
    for (const team of ["blue", "coral"] as const) {
      const select = this.settingsFind<HTMLSelectElement>(`#settings-club-${team}`);
      const current = this.application.setup?.[team].clubId;
      render(select, html`${rows
        .map((club) => html`<option value="${club.id}" ${club.id === current ? "selected" : ""}>${club.name}</option>`)}`);
    }
  }

  private bindClubSelectors(): void {
    for (const team of ["blue", "coral"] as const) {
      this.settingsFind<HTMLSelectElement>(`#settings-club-${team}`).addEventListener("change", () => {
        const blue = this.settingsFind<HTMLSelectElement>("#settings-club-blue").value;
        const coral = this.settingsFind<HTMLSelectElement>("#settings-club-coral").value;
        void this.application.selectClubs(blue, coral).then((result) => {
          if (result.ok) this.resetSelection();
          void this.renderClubSelectors();
          this.render();
        });
      });
    }
  }

  private bindSettings(): void {
    void this.renderClubSelectors();
    this.bindClubSelectors();
    const seedInput = this.settingsFind<HTMLInputElement>("#settings-seed-input");
    seedInput.value = String(this.application.settings.randomSeed);
    const applySeed = (): void => {
      const parsed = Number(seedInput.value);
      if (!Number.isFinite(parsed)) {
        seedInput.value = String(this.application.settings.randomSeed);
        return;
      }
      seedInput.value = String(this.application.setSeed(parsed));
      this.resetSelection();
      this.render();
    };
    seedInput.addEventListener("change", applySeed);
    seedInput.addEventListener("keydown", (event) => { if (event.key === "Enter") seedInput.blur(); });
    this.settingsFind("#settings-random-seed").addEventListener("click", () => {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      const currentSeed = this.application.settings.randomSeed;
      seedInput.value = String(values[0] === currentSeed ? (values[0] + 1) >>> 0 : values[0]);
      applySeed();
    });
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-open-match-settings]")) {
      button.addEventListener("click", () => {
        seedInput.value = String(this.application.settings.randomSeed);
        this.settingsFind<HTMLInputElement>("#learning-toggle").checked = this.state.learningEnabled;
        void this.renderClubSelectors();
        this.settingsDialog.showModal();
      });
    }
    this.settingsFind<HTMLInputElement>("#learning-toggle").addEventListener("change", (event) => {
      this.application.setLearningEnabled((event.currentTarget as HTMLInputElement).checked);
    });
    this.settingsFind("#reset-learning").addEventListener("click", () => {
      void this.application.resetLearning().then(() => {
        this.resetSelection();
        this.render();
      });
    });
  }

  private renderPauseButton(): void {
    const paused = this.session.paused;
    const button = this.find<HTMLButtonElement>("#pause-button");
    render(button, icon(paused ? "Play" : "Pause"));
    button.setAttribute("aria-label", paused ? "Continuar simulação" : "Pausar simulação");
    button.title = paused ? "Continuar simulação" : "Pausar simulação";
  }

  private activateInspectorTab(button: HTMLButtonElement): void {
    this.activeTab = button.dataset.inspectorTab as InspectorTab;
    this.root.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
    });
    this.root.querySelectorAll<HTMLElement>("[data-inspector-panel]").forEach((panel) => {
      const active = panel.dataset.inspectorPanel === this.activeTab;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
    // A aba recém-aberta pode estar desatualizada: enquanto escondida ela não é montada.
    this.panels[this.activeTab]();
  }

  private resetSelection(): void {
    this.selectedPlayerId = this.state.players[0]?.profile.id ?? "";
  }

  private renderPlayerDetail(): void {
    const detail = this.detailModel;
    if (!detail) return;
    render(this.find("#player-detail"), html`
      <div class="detail-title">
        <div><strong>${detail.name}</strong><span>${detail.position}</span></div>
        <b class="rating rating--${ratingBand(detail.rating)}">${detail.rating}</b>
      </div>
      <div class="detail-metrics detail-metrics--match"><small class="detail-legend">NESTA PARTIDA</small>${detail.metrics.map((item) => html`<span><small>${item.label}</small><strong>${item.value}</strong></span>`)}</div>
      <p class="detail-career">Carreira <b>${detail.career}</b></p>
      <div class="detail-title detail-title--decision"><span class="intent intent--${detail.team}">${detail.intent}</span></div>
      <div class="decision-explanation"><small>POR QUÊ</small><strong>${detail.reason}</strong></div>
      ${detail.diagnostics.map((item) => html`<div class="decision-explanation"><small>${item.label}</small><strong>${item.headline}<br>${item.detail}</strong></div>`)}
      <div class="detail-metrics">${detail.decision.map((item) => html`<span><small>${item.label}</small><strong>${item.value}</strong></span>`)}</div>`);
  }

  private renderCharts(): void {
    const state = this.state;
    this.find("#shot-count").textContent = `${state.shots.length} ${state.shots.length === 1 ? "finalização" : "finalizações"}`;
    this.find("#xg-summary").textContent = `${state.stats.blue.expectedGoals.toFixed(2)} — ${state.stats.coral.expectedGoals.toFixed(2)}`;
    drawShotMap(this.find<HTMLCanvasElement>("#shot-map"), state.shots);
    drawXgTimeline(this.find<HTMLCanvasElement>("#xg-timeline"), state);
    drawMomentum(this.find<HTMLCanvasElement>("#momentum-chart"), state.momentum);
  }

  private renderAnalysis(): void {
    const state = this.state;
    for (const team of ["blue", "coral"] as const) {
      this.find(`#phase-${team}`).textContent = PHASE_LABELS[state.tactics[team].phase];
      const shape = state.tactics[team].shape;
      const collective = state.tactics[team].collectivePlan;
      const channelLabel = collective ? { left: "esquerda", center: "centro", right: "direita" }[collective.attackChannel] : "-";
      const styleLabel = collective ? { short: "saída curta", balanced: "jogo equilibrado", direct: "jogo direto" }[collective.buildUpStyle] : "-";
      this.find(`#shape-${team}`).textContent = collective
        ? `${styleLabel} · corredor ${channelLabel} · risco ${Math.round(collective.risk * 100)}%`
        : `Largura ${Math.round(shape.width)} · Prof. ${Math.round(shape.depth)}`;
      // Como o time está dividido agora. Todo jogador aparece aqui: se a soma não bater com o
      // tamanho do time, alguém ficou sem função — que é justamente o que não pode acontecer.
      const duties = new Map<string, number>();
      for (const assignment of Object.values(collective?.assignments ?? {})) {
        duties.set(assignment.duty, (duties.get(assignment.duty) ?? 0) + 1);
      }
      this.find(`#duties-${team}`).textContent = duties.size === 0
        ? "-"
        : [...duties.entries()]
          .sort(([, first], [, second]) => second - first)
          .map(([duty, count]) => `${count} ${DUTY_LABELS[duty as AssignmentDuty]}`)
          .join(" · ");
      drawTacticalMap(this.find<HTMLCanvasElement>(`#tactical-map-${team}`), state, team);
    }
    const groups = createStatGroups(state);
    this.analysisSection.update(statTableSignature(groups, this.teamNames));
    this.statTable.patch(groups);
    // Os gráficos só mudam quando um chute termina ou uma janela é amostrada — redesenhá-los a
    // cada quadro seria trabalho de canvas para pixel idêntico.
    this.chartsSection.update(`${state.shots.length}|${state.momentum.reduce((total, window) => total + window.samples, 0)}`);
    this.find("#contest-metric").textContent = createContestMetric(state);
    this.find("#analysis-title").textContent = state.finished ? "Relatório final" : "Relatório ao vivo";
    this.find("#match-summary").textContent = createMatchSummary(state, this.teamNames);
  }


  private find<T extends HTMLElement>(selector: string): T {
    return find<T>(this.root, selector);
  }

  private settingsFind<T extends HTMLElement>(selector: string): T {
    return find<T>(this.settingsDialog, selector);
  }
}
