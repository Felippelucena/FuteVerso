import type { GameApplication } from "../../application/game-application";
import { SIMULATION_SPEEDS, type SimulationSpeed } from "../../application/match/match-session";
import type { AssignmentDuty } from "../../domain/match/model";
import type { Team } from "../../domain/shared/model";
import { GameRenderer } from "../canvas/game-renderer";
import { find, render } from "../app/dom";
import { html, type Html } from "../app/html";
import { DUTY_LABELS, formatClock, percentage, PHASE_LABELS, type TeamNames } from "../app/labels";
import { icon } from "../app/icons";
import type { Screen, ScreenDefinition } from "../app/screen";
import { Section } from "../app/section";
import { formatMatchEvent } from "./format-match-event";
import { RosterList, rosterSignature } from "./match-roster";
import { createContestMetric, createMatchHeaderViewModel, createMatchSummary, createPlayerDetailViewModel, playerDetailSignature, type PlayerDetailViewModel } from "./match-view-model";
import { drawTacticalMap } from "./tactical-map";
import { teamNamesOf } from "./team-names";

const matchScreenTemplate = (): Html => html`
  <section data-screen="match" class="workspace">
    <div class="field-panel">
      <div class="field-toolbar">
        <div class="toolbar-title"><strong>Partida autônoma</strong><span id="possession-label">Bola em disputa</span></div>
        <div class="toolbar-actions">
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

type InspectorTab = "players" | "analysis" | "events";

export const matchScreenDefinition = (application: GameApplication): ScreenDefinition => ({
  id: "match",
  label: "Partida",
  icon: "Goal",
  template: matchScreenTemplate,
  dialogs: matchSettingsTemplate,
  mount: ({ root, dialogs }) => new MatchScreen(root, find(dialogs, "#match-settings-dialog"), application),
});

export class MatchScreen implements Screen {
  private selectedPlayerId: string;
  private activeTab: InspectorTab = "players";
  private detailModel: PlayerDetailViewModel | null = null;
  private readonly renderer: GameRenderer;
  private readonly roster: RosterList;
  private readonly rosterSection: Section;
  private readonly detailSection: Section;
  private readonly eventsSection: Section;
  private readonly analysisSection: Section;
  private readonly panels: Record<InspectorTab, () => void>;

  constructor(
    private readonly root: HTMLElement,
    private readonly settingsDialog: HTMLDialogElement,
    private readonly application: GameApplication,
  ) {
    this.selectedPlayerId = application.state.players[0]?.profile.id ?? "";
    this.renderer = new GameRenderer(this.find("#game-canvas"));
    new ResizeObserver(() => this.resize()).observe(this.find("#game-canvas"));
    this.roster = new RosterList(this.find("#match-roster"));
    this.rosterSection = new Section(() => this.roster.rebuild(this.application.state.players, this.teamNames));
    this.detailSection = new Section(() => this.renderPlayerDetail());
    this.eventsSection = new Section(() => this.renderEvents());
    this.analysisSection = new Section(() => this.renderAnalysisTable());
    this.panels = {
      players: () => this.renderPlayersPanel(),
      analysis: () => this.renderAnalysis(),
      events: () => this.eventsSection.update(this.eventsSignature()),
    };
    this.bindEvents();
  }

  private get teamNames(): TeamNames {
    return teamNamesOf(this.application);
  }

  tick(): void {
    this.render();
  }

  render(): void {
    const state = this.application.state;
    const header = createMatchHeaderViewModel(state, this.teamNames);
    this.renderTeamNames();
    this.find("#possession-label").textContent = header.possessionLabel;
    this.find("#possession-blue").textContent = `${header.bluePossession}%`;
    this.find("#possession-coral").textContent = `${header.coralPossession}%`;
    this.find<HTMLSpanElement>("#possession-fill").style.width = `${header.bluePossession}%`;
    this.renderTimeline();
    this.find<HTMLButtonElement>("#pause-button").disabled = state.finished;
    // Só a aba visível é montada: as outras duas nascem `hidden` e reconstruí-las é desperdício.
    this.panels[this.activeTab]();
  }

  private eventsSignature(): string {
    return `${this.application.state.eventCounter}|${this.teamNames.blue}|${this.teamNames.coral}`;
  }

  private renderEvents(): void {
    render(this.find<HTMLOListElement>("#event-list"), html`${this.application.state.events.map((event) => {
      const team = "team" in event ? event.team : null;
      return html`<li class="event-item ${team ? `event-item--${team}` : ""}"><time>${formatClock(event.time)}</time><span>${formatMatchEvent(event, this.application.world.players, this.teamNames)}</span></li>`;
    })}`);
  }

  private renderPlayersPanel(): void {
    const state = this.application.state;
    this.rosterSection.update(rosterSignature(state.players, this.teamNames));
    this.roster.patch(state, this.selectedPlayerId);
    const selected = state.players.find((player) => player.profile.id === this.selectedPlayerId) ?? state.players[0];
    if (!selected) return;
    this.selectedPlayerId = selected.profile.id;
    this.detailModel = createPlayerDetailViewModel(state, selected);
    this.detailSection.update(playerDetailSignature(this.detailModel));
  }

  frame(): void {
    this.renderer.render(this.application.state);
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
    const match = this.application.match;
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
    this.renderer.render(this.application.state);
    this.render();
  }

  private bindEvents(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]")) {
      button.addEventListener("click", () => this.activateInspectorTab(button));
    }
    const pauseButton = this.find<HTMLButtonElement>("#pause-button");
    pauseButton.addEventListener("click", () => {
      this.application.match.togglePaused();
      this.renderPauseButton();
    });
    this.find("#reset-button").addEventListener("click", () => {
      this.application.restartMatch();
      this.resetSelection();
      this.render();
    });
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
      button.addEventListener("click", () => {
        this.application.match.setSpeed(Number(button.dataset.speed) as SimulationSpeed);
        this.root.querySelectorAll("[data-speed]").forEach((item) => item.classList.toggle("is-active", item === button));
      });
    }
    const slider = this.find<HTMLInputElement>("#timeline-slider");
    slider.addEventListener("input", () => {
      this.application.match.beginSeek();
      this.application.match.seek(Number(slider.value));
      this.renderScrubFrame();
    });
    // Ao soltar o slider, a reprodução volta: continua tocando se não estiver pausada.
    slider.addEventListener("change", () => this.application.match.endSeek());
    this.find("#live-button").addEventListener("click", () => {
      this.application.match.resumeLive();
      this.renderScrubFrame();
    });
    this.find("#match-roster").addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-inspect-player]");
      if (!button) return;
      this.selectedPlayerId = button.dataset.inspectPlayer!;
      this.renderPlayersPanel();
    });
    this.bindSettings();
  }

  private renderClubSelectors(): void {
    const clubs = [...this.application.world.clubs].sort((first, second) => first.name.localeCompare(second.name));
    for (const team of ["blue", "coral"] as const) {
      const select = this.settingsFind<HTMLSelectElement>(`#settings-club-${team}`);
      const current = this.application.setup[team].clubId;
      render(select, html`${clubs
        .map((club) => html`<option value="${club.id}" ${club.id === current ? "selected" : ""}>${club.name}</option>`)}`);
    }
  }

  private bindClubSelectors(): void {
    for (const team of ["blue", "coral"] as const) {
      this.settingsFind<HTMLSelectElement>(`#settings-club-${team}`).addEventListener("change", () => {
        const blue = this.settingsFind<HTMLSelectElement>("#settings-club-blue").value;
        const coral = this.settingsFind<HTMLSelectElement>("#settings-club-coral").value;
        // Dois clubes iguais não têm elenco para os dois lados; o outro lado cede a vez.
        const opponents = this.application.world.clubs.filter(({ id }) => id !== (team === "blue" ? blue : coral));
        const resolved = blue === coral ? opponents[0]?.id ?? coral : team === "blue" ? coral : blue;
        const result = team === "blue"
          ? this.application.selectClubs(blue, resolved)
          : this.application.selectClubs(resolved, coral);
        if (result.ok) this.resetSelection();
        this.renderClubSelectors();
        this.render();
      });
    }
  }

  private bindSettings(): void {
    this.renderClubSelectors();
    this.bindClubSelectors();
    const seedInput = this.settingsFind<HTMLInputElement>("#settings-seed-input");
    seedInput.value = String(this.application.world.settings.randomSeed);
    const applySeed = (): void => {
      const parsed = Number(seedInput.value);
      if (!Number.isFinite(parsed)) {
        seedInput.value = String(this.application.world.settings.randomSeed);
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
      const currentSeed = this.application.world.settings.randomSeed;
      seedInput.value = String(values[0] === currentSeed ? (values[0] + 1) >>> 0 : values[0]);
      applySeed();
    });
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-open-match-settings]")) {
      button.addEventListener("click", () => {
        seedInput.value = String(this.application.world.settings.randomSeed);
        this.settingsFind<HTMLInputElement>("#learning-toggle").checked = this.application.state.learningEnabled;
        this.renderClubSelectors();
        this.settingsDialog.showModal();
      });
    }
    this.settingsFind<HTMLInputElement>("#learning-toggle").addEventListener("change", (event) => {
      this.application.setLearningEnabled((event.currentTarget as HTMLInputElement).checked);
    });
    this.settingsFind("#reset-learning").addEventListener("click", () => {
      this.application.resetLearning();
      this.resetSelection();
      this.render();
    });
  }

  private renderPauseButton(): void {
    const paused = this.application.match.paused;
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
    this.selectedPlayerId = this.application.state.players[0]?.profile.id ?? "";
  }

  private renderPlayerDetail(): void {
    const detail = this.detailModel;
    if (!detail) return;
    render(this.find("#player-detail"), html`
      <div class="detail-title"><div><strong>${detail.name}</strong><span>${detail.position}</span></div><span class="intent intent--${detail.team}">${detail.intent}</span></div>
      <div class="decision-explanation"><small>POR QUÊ</small><strong>${detail.reason}</strong></div>
      ${detail.diagnostics.map((item) => html`<div class="decision-explanation"><small>${item.label}</small><strong>${item.headline}<br>${item.detail}</strong></div>`)}
      <div class="detail-metrics">${detail.metrics.map((item) => html`<span><small>${item.label}</small><strong>${item.value}</strong></span>`)}</div>`);
  }

  private averageShape(team: Team, key: "widthIntegral" | "depthIntegral" | "compactnessIntegral"): number {
    const stats = this.application.state.stats[team];
    return stats.spatialSeconds > 0 ? stats[key] / stats.spatialSeconds : 0;
  }

  private renderAnalysis(): void {
    const state = this.application.state;
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
    this.analysisSection.update(this.analysisRows().flat().join("|") + this.teamNames.blue + this.teamNames.coral);
    this.find("#contest-metric").textContent = createContestMetric(state);
    this.find("#analysis-title").textContent = state.finished ? "Relatório final" : "Relatório ao vivo";
    this.find("#match-summary").textContent = createMatchSummary(state, this.teamNames);
  }

  private renderAnalysisTable(): void {
    render(this.find("#analysis-table"), html`<div class="analysis-row analysis-row--head"><span>MÉTRICA</span><strong>${this.teamNames.blue}</strong><strong>${this.teamNames.coral}</strong></div>${this.analysisRows().map(([label, blueValue, coralValue]) => html`<div class="analysis-row"><span>${label}</span><strong>${blueValue}</strong><strong>${coralValue}</strong></div>`)}`);
  }

  /** As próprias linhas servem de assinatura da seção: são exatamente o conteúdo exibido. */
  private analysisRows(): (string | number)[][] {
    const blue = this.application.state.stats.blue;
    const coral = this.application.state.stats.coral;
    return [
      ["Passes certos", `${blue.completedPasses}/${blue.passes}`, `${coral.completedPasses}/${coral.passes}`],
      ["Precisão", percentage(blue.completedPasses, blue.passes), percentage(coral.completedPasses, coral.passes)],
      ["Passes longos", `${blue.completedLongPasses}/${blue.longPasses}`, `${coral.completedLongPasses}/${coral.longPasses}`],
      ["Passes aéreos", `${blue.completedAerialPasses}/${blue.aerialPasses}`, `${coral.completedAerialPasses}/${coral.aerialPasses}`],
      ["Finalizações", blue.shots, coral.shots], ["Chutes no alvo", blue.shotsOnTarget, coral.shotsOnTarget], ["Defesas", blue.saves, coral.saves],
      ["Encaixes", blue.catches, coral.catches], ["Rebotes", blue.parries, coral.parries], ["Raspões", blue.glancingTouches, coral.glancingTouches],
      ["Saídas aéreas", blue.highBallClaims, coral.highBallClaims], ["Socos", blue.punches, coral.punches],
      ["De primeira", blue.firstTimeShots, coral.firstTimeShots], ["De longe", blue.longShots, coral.longShots], ["Cruzamentos", blue.crosses, coral.crosses],
      ["Fintas", `${blue.feintsCompleted}/${blue.feintsAttempted}`, `${coral.feintsCompleted}/${coral.feintsAttempted}`], ["Toques longos", blue.sprintDribbles, coral.sprintDribbles],
      ["Desarmes", `${blue.tacklesWon}/${blue.tacklesAttempted}`, `${coral.tacklesWon}/${coral.tacklesAttempted}`], ["Recuperações", blue.turnoversWon, coral.turnoversWon],
      ["Avanços agressivos", blue.aggressiveBreaks, coral.aggressiveBreaks],
      ["Entradas no terço final", blue.finalThirdEntries, coral.finalThirdEntries], ["Quebras de linha", blue.lineBreaks, coral.lineBreaks], ["Inversões", blue.switches, coral.switches],
      ["Largura média", Math.round(this.averageShape("blue", "widthIntegral")), Math.round(this.averageShape("coral", "widthIntegral"))],
      ["Compactação média", Math.round(this.averageShape("blue", "compactnessIntegral")), Math.round(this.averageShape("coral", "compactnessIntegral"))],
    ];
  }

  private find<T extends HTMLElement>(selector: string): T {
    return find<T>(this.root, selector);
  }

  private settingsFind<T extends HTMLElement>(selector: string): T {
    return find<T>(this.settingsDialog, selector);
  }
}
