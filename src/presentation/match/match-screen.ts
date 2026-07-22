import type { GameApplication } from "../../application/game-application";
import { SIMULATION_SPEEDS, type SimulationSpeed } from "../../application/match/match-session";
import { ANALYTICS_GRID, FIELD } from "../../domain/match/config";
import type { MatchState } from "../../domain/match";
import type { PlayerRuntime } from "../../domain/match/model";
import type { Team } from "../../domain/shared/model";
import type { GameRenderer } from "../canvas/game-renderer";
import { DRIBBLE_RANGE_REASON_LABELS, DRIBBLE_TOUCH_LABELS, escapeHtml, formatClock, INTENT_LABELS, PACE_LABELS, percentage, PHASE_LABELS, POSITION_LABELS, REASON_LABELS, ROLE_LABELS, teamLabel } from "../app/labels";
import { hydrateIcons } from "../app/icons";
import { formatMatchEvent } from "./format-match-event";
import { createContestMetric, createMatchHeaderViewModel, createMatchSummary } from "./match-view-model";

const intentLabel = (state: MatchState, player: PlayerRuntime): string => {
  if (player.intent !== "knockingOn") return INTENT_LABELS[player.intent];
  const range = state.ball.dribbleOwnerId === player.profile.id
    ? state.ball.dribbleTouchRange
    : player.plan?.ballAction.kind === "dribble" ? player.plan.ballAction.touchRange : null;
  return range ? DRIBBLE_TOUCH_LABELS[range] : INTENT_LABELS.knockingOn;
};

export const matchScreenTemplate = (): string => `
  <section id="match-view" class="workspace">
    <div class="field-panel">
      <div class="field-toolbar">
        <div class="toolbar-title"><strong>Partida autônoma</strong><span id="possession-label">Bola em disputa</span></div>
        <div class="toolbar-actions">
          <button class="icon-button mobile-settings-button" data-open-match-settings type="button" aria-label="Abrir configurações da partida" title="Configurações"><i data-lucide="sliders-horizontal"></i></button>
          <button class="icon-button" id="pause-button" type="button" aria-label="Pausar simulação" title="Pausar simulação"><i data-lucide="pause"></i></button>
          <button class="icon-button" id="reset-button" type="button" aria-label="Reiniciar partida" title="Reiniciar partida"><i data-lucide="rotate-ccw"></i></button>
          <div class="speed-control" aria-label="Velocidade da simulação">
            ${SIMULATION_SPEEDS.map((speed) => `<button type="button" data-speed="${speed}" class="${speed === 1 ? "is-active" : ""}">${speed}×</button>`).join("")}
          </div>
        </div>
      </div>
      <div class="canvas-wrap"><canvas id="game-canvas" aria-label="Campo de futebol com oito agentes autônomos"></canvas></div>
      <div class="match-strip">
        <div><span>POSSE NILO</span><strong id="possession-blue">50%</strong></div>
        <div class="possession-track"><span id="possession-fill"></span></div>
        <div><span>POSSE MAYA</span><strong id="possession-coral">50%</strong></div>
      </div>
    </div>
    <aside class="inspector" aria-label="Painel da partida">
      <div class="inspector-heading">
        <div><span class="eyebrow">CENTRAL DA PARTIDA</span><h2>Leitura ao vivo</h2></div>
        <button class="icon-button" data-open-match-settings type="button" aria-label="Abrir configurações da partida" title="Configurações"><i data-lucide="sliders-horizontal"></i></button>
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
          <div class="phase-card phase-card--blue"><small>NILO</small><strong id="phase-blue">Bloco médio</strong><span id="shape-blue">Largura 0 · Prof. 0</span><canvas id="tactical-map-blue" width="128" height="72" aria-label="Mapa de calor e rede de passes do Nilo"></canvas></div>
          <div class="phase-card phase-card--coral"><small>MAYA</small><strong id="phase-coral">Bloco médio</strong><span id="shape-coral">Largura 0 · Prof. 0</span><canvas id="tactical-map-coral" width="128" height="72" aria-label="Mapa de calor e rede de passes do Maya"></canvas></div>
        </div>
        <div class="analysis-table" id="analysis-table"></div>
        <p id="match-summary" class="match-summary">A análise será atualizada conforme a partida evolui.</p>
      </section>
      <section id="inspector-events" class="inspector-panel events-section" role="tabpanel" data-inspector-panel="events" hidden>
        <div class="events-heading"><span class="eyebrow">ÚLTIMOS EVENTOS</span><small>Atualização ao vivo</small></div><ol id="event-list" class="event-list"></ol>
      </section>
    </aside>
  </section>`;

export const matchSettingsTemplate = (): string => `
  <dialog id="match-settings-dialog" class="settings-dialog">
    <form method="dialog">
      <div class="dialog-heading"><div><span class="eyebrow">PARTIDA</span><h2>Configurações</h2></div><button class="icon-button" value="cancel" aria-label="Fechar configurações" title="Fechar"><i data-lucide="x"></i></button></div>
      <div class="settings-group">
        <div><strong>Semente da partida</strong><p>Use o mesmo número para reproduzir uma simulação.</p></div>
        <div class="seed-control seed-control--dialog" aria-label="Semente da partida">
          <input id="settings-seed-input" type="number" min="0" max="4294967295" step="1" inputmode="numeric" aria-label="Semente numérica da partida" />
          <button id="settings-random-seed" type="button" aria-label="Gerar nova semente" title="Gerar nova semente"><i data-lucide="dices"></i></button>
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

export class MatchScreen {
  private selectedPlayerId: string;

  constructor(
    private readonly root: HTMLElement,
    private readonly settingsDialog: HTMLDialogElement,
    private readonly application: GameApplication,
    private readonly renderer: GameRenderer,
    private readonly renderHeader: (state: MatchState, paused: boolean) => void,
  ) {
    this.selectedPlayerId = application.state.players[0]?.profile.id ?? "";
    this.bindEvents();
  }

  get canvas(): HTMLCanvasElement {
    return this.find<HTMLCanvasElement>("#game-canvas");
  }

  render(): void {
    const state = this.application.state;
    const header = createMatchHeaderViewModel(state);
    this.renderHeader(state, this.application.match.paused);
    this.find("#possession-label").textContent = header.possessionLabel;
    this.find("#possession-blue").textContent = `${header.bluePossession}%`;
    this.find("#possession-coral").textContent = `${header.coralPossession}%`;
    this.find<HTMLSpanElement>("#possession-fill").style.width = `${header.bluePossession}%`;
    this.renderMatchRoster();
    this.renderAnalysis();
    this.find<HTMLButtonElement>("#pause-button").disabled = state.finished;
    this.find<HTMLOListElement>("#event-list").innerHTML = state.events.map((event) => {
      const team = "team" in event ? event.team : null;
      return `<li class="event-item ${team ? `event-item--${team}` : ""}"><time>${formatClock(event.time)}</time><span>${escapeHtml(formatMatchEvent(event, this.application.profile.players))}</span></li>`;
    }).join("");
  }

  resize(): void {
    this.renderer.resize();
  }

  private bindEvents(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]")) {
      button.addEventListener("click", () => this.activateInspectorTab(button));
    }
    const pauseButton = this.find<HTMLButtonElement>("#pause-button");
    pauseButton.addEventListener("click", () => {
      this.application.match.togglePaused();
      this.renderPauseButton();
      this.renderHeader(this.application.state, this.application.match.paused);
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
    this.find("#match-roster").addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-inspect-player]");
      if (!button) return;
      this.selectedPlayerId = button.dataset.inspectPlayer!;
      this.renderMatchRoster();
    });
    this.bindSettings();
  }

  private bindSettings(): void {
    const seedInput = this.settingsFind<HTMLInputElement>("#settings-seed-input");
    seedInput.value = String(this.application.profile.settings.randomSeed);
    const applySeed = (): void => {
      const parsed = Number(seedInput.value);
      if (!Number.isFinite(parsed)) {
        seedInput.value = String(this.application.profile.settings.randomSeed);
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
      const currentSeed = this.application.profile.settings.randomSeed;
      seedInput.value = String(values[0] === currentSeed ? (values[0] + 1) >>> 0 : values[0]);
      applySeed();
    });
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-open-match-settings]")) {
      button.addEventListener("click", () => {
        seedInput.value = String(this.application.profile.settings.randomSeed);
        this.settingsFind<HTMLInputElement>("#learning-toggle").checked = this.application.state.learningEnabled;
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
    button.innerHTML = `<i data-lucide="${paused ? "play" : "pause"}"></i>`;
    button.setAttribute("aria-label", paused ? "Continuar simulação" : "Pausar simulação");
    button.title = paused ? "Continuar simulação" : "Pausar simulação";
    hydrateIcons();
  }

  private activateInspectorTab(button: HTMLButtonElement): void {
    const tab = button.dataset.inspectorTab;
    this.root.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
    });
    this.root.querySelectorAll<HTMLElement>("[data-inspector-panel]").forEach((panel) => {
      const active = panel.dataset.inspectorPanel === tab;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
  }

  private resetSelection(): void {
    this.selectedPlayerId = this.application.state.players[0]?.profile.id ?? "";
  }

  private renderMatchRoster(): void {
    const state = this.application.state;
    this.find("#match-roster").innerHTML = (["blue", "coral"] as const).map((team) => `
      <div class="roster-team"><span class="roster-team-name roster-team-name--${team}">${teamLabel(team)}</span>
        ${state.players.filter((player) => player.team === team).map((player) => `
          <button type="button" class="roster-player ${this.selectedPlayerId === player.profile.id ? "is-selected" : ""}" data-inspect-player="${player.profile.id}">
            <span class="shirt shirt--${team}">${player.profile.number}</span><span><strong>${escapeHtml(player.profile.name)}</strong><small>${POSITION_LABELS[player.profile.position]} · ${intentLabel(state, player)}</small></span><i>${Math.round(player.energy * 100)}</i>
          </button>`).join("")}
      </div>`).join("");
    const selected = state.players.find((player) => player.profile.id === this.selectedPlayerId) ?? state.players[0];
    if (!selected) return;
    this.selectedPlayerId = selected.profile.id;
    const stats = selected.memory.stats;
    const planAge = selected.plan ? Math.max(0, state.elapsed - selected.plan.startedAt) : 0;
    const pendingPass = state.pendingPass;
    const receptionDiagnostic = pendingPass
      && (pendingPass.receiverId === selected.profile.id || pendingPass.passerId === selected.profile.id)
      ? `<div class="decision-explanation"><small>RECEPÇÃO</small><strong>${pendingPass.range === "long" ? "Longo" : "Curto"} ${pendingPass.trajectory === "air" ? "aéreo" : "rasteiro"} para ${pendingPass.targeting === "space" ? "o espaço" : "os pés"} · ${REASON_LABELS[pendingPass.selectionReason]}<br>Ponto ${pendingPass.landingPoint.x.toFixed(1)}, ${pendingPass.landingPoint.y.toFixed(1)} · ETA ${pendingPass.receiverEta.toFixed(2)}s / rival ${pendingPass.opponentEta.toFixed(2)}s</strong></div>`
      : "";
    const dribbleAction = selected.plan?.ballAction.kind === "dribble" ? selected.plan.ballAction : null;
    const dribbleDiagnostic = dribbleAction?.runway !== undefined
      ? `<div class="decision-explanation"><small>CONDUÇÃO</small><strong>${dribbleAction.touchRange ? DRIBBLE_TOUCH_LABELS[dribbleAction.touchRange] : "Sem pique"} · ${DRIBBLE_RANGE_REASON_LABELS[dribbleAction.rangeReason ?? "insufficientRunway"]}<br>Corredor ${dribbleAction.runway.toFixed(1)} · ETA ${dribbleAction.carrierEta?.toFixed(2) ?? "–"}s / rival ${Number.isFinite(dribbleAction.opponentEta) ? dribbleAction.opponentEta?.toFixed(2) : "livre"}s</strong></div>`
      : "";
    this.find("#player-detail").innerHTML = `
      <div class="detail-title"><div><strong>${escapeHtml(selected.profile.name)}</strong><span>${POSITION_LABELS[selected.profile.position]} · ${ROLE_LABELS[selected.profile.role]}</span></div><span class="intent intent--${selected.team}">${intentLabel(state, selected)}</span></div>
      <div class="decision-explanation"><small>POR QUÊ</small><strong>${REASON_LABELS[selected.decisionReason]}</strong></div>
      ${receptionDiagnostic}
      ${dribbleDiagnostic}
      <div class="detail-metrics"><span><small>POSTURA</small><strong>${selected.posture === "inPossession" ? "COM POSSE" : "SEM POSSE"}</strong></span><span><small>RITMO</small><strong>${PACE_LABELS[selected.pace]}</strong></span><span><small>PLANO</small><strong>${planAge.toFixed(1)}s</strong></span><span><small>GOLS</small><strong>${stats.goals}</strong></span><span><small>PASSES</small><strong>${stats.completedPasses}</strong></span></div>`;
  }

  private averageShape(team: Team, key: "widthIntegral" | "depthIntegral" | "compactnessIntegral"): number {
    const stats = this.application.state.stats[team];
    return stats.spatialSeconds > 0 ? stats[key] / stats.spatialSeconds : 0;
  }

  private renderTacticalMap(team: Team): void {
    const state = this.application.state;
    const canvas = this.find<HTMLCanvasElement>(`#tactical-map-${team}`);
    const context = canvas.getContext("2d");
    if (!context) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#1d4f36";
    context.fillRect(0, 0, width, height);
    const cells = state.heatmaps[team];
    const maximum = Math.max(1, ...cells);
    const cellWidth = width / ANALYTICS_GRID.columns;
    const cellHeight = height / ANALYTICS_GRID.rows;
    const color = team === "blue" ? "59,130,246" : "243,111,86";
    for (let index = 0; index < cells.length; index += 1) {
      const alpha = cells[index] / maximum * 0.58;
      if (alpha < 0.02) continue;
      context.fillStyle = `rgba(${color},${alpha})`;
      context.fillRect(index % ANALYTICS_GRID.columns * cellWidth, Math.floor(index / ANALYTICS_GRID.columns) * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
    }
    context.strokeStyle = "rgba(235,247,238,.42)";
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, width - 1, height - 1);
    context.beginPath(); context.moveTo(width / 2, 0); context.lineTo(width / 2, height); context.stroke();
    const players = state.players.filter((player) => player.team === team);
    const byId = new Map(players.map((player) => [player.profile.id, player]));
    const connections = Object.entries(state.passNetwork[team]);
    const strongest = Math.max(1, ...connections.map(([, count]) => count));
    for (const [key, count] of connections) {
      const [fromId, toId] = key.split(">");
      const from = byId.get(fromId); const to = byId.get(toId);
      if (!from || !to) continue;
      context.strokeStyle = `rgba(255,255,255,${0.18 + count / strongest * 0.52})`;
      context.lineWidth = 0.7 + count / strongest * 2.1;
      context.beginPath();
      context.moveTo(from.position.x / FIELD.width * width, from.position.y / FIELD.height * height);
      context.lineTo(to.position.x / FIELD.width * width, to.position.y / FIELD.height * height);
      context.stroke();
    }
    for (const player of players) {
      context.fillStyle = team === "blue" ? "#7fb0ff" : "#ff9b87";
      context.beginPath();
      context.arc(player.position.x / FIELD.width * width, player.position.y / FIELD.height * height, player.profile.position === "goalkeeper" ? 2.2 : 2.8, 0, Math.PI * 2);
      context.fill();
    }
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
      this.renderTacticalMap(team);
    }
    const blue = state.stats.blue; const coral = state.stats.coral;
    const rows = [
      ["Passes certos", `${blue.completedPasses}/${blue.passes}`, `${coral.completedPasses}/${coral.passes}`],
      ["Precisão", percentage(blue.completedPasses, blue.passes), percentage(coral.completedPasses, coral.passes)],
      ["Passes longos", `${blue.completedLongPasses}/${blue.longPasses}`, `${coral.completedLongPasses}/${coral.longPasses}`],
      ["Passes aéreos", `${blue.completedAerialPasses}/${blue.aerialPasses}`, `${coral.completedAerialPasses}/${coral.aerialPasses}`],
      ["Finalizações", blue.shots, coral.shots], ["Chutes no alvo", blue.shotsOnTarget, coral.shotsOnTarget], ["Defesas", blue.saves, coral.saves],
      ["Fintas", `${blue.feintsCompleted}/${blue.feintsAttempted}`, `${coral.feintsCompleted}/${coral.feintsAttempted}`], ["Toques longos", blue.sprintDribbles, coral.sprintDribbles],
      ["Desarmes", `${blue.tacklesWon}/${blue.tacklesAttempted}`, `${coral.tacklesWon}/${coral.tacklesAttempted}`], ["Recuperações", blue.turnoversWon, coral.turnoversWon],
      ["Entradas no terço final", blue.finalThirdEntries, coral.finalThirdEntries], ["Quebras de linha", blue.lineBreaks, coral.lineBreaks], ["Inversões", blue.switches, coral.switches],
      ["Largura média", Math.round(this.averageShape("blue", "widthIntegral")), Math.round(this.averageShape("coral", "widthIntegral"))],
      ["Compactação média", Math.round(this.averageShape("blue", "compactnessIntegral")), Math.round(this.averageShape("coral", "compactnessIntegral"))],
    ];
    this.find("#analysis-table").innerHTML = `<div class="analysis-row analysis-row--head"><span>MÉTRICA</span><strong>NILO</strong><strong>MAYA</strong></div>${rows.map(([label, blueValue, coralValue]) => `<div class="analysis-row"><span>${label}</span><strong>${blueValue}</strong><strong>${coralValue}</strong></div>`).join("")}`;
    this.find("#contest-metric").textContent = createContestMetric(state);
    this.find("#analysis-title").textContent = state.finished ? "Relatório final" : "Relatório ao vivo";
    this.find("#match-summary").textContent = createMatchSummary(state);
  }

  private find<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Elemento ${selector} não encontrado na tela da partida.`);
    return element;
  }

  private settingsFind<T extends HTMLElement>(selector: string): T {
    const element = this.settingsDialog.querySelector<T>(selector);
    if (!element) throw new Error(`Elemento ${selector} não encontrado nas configurações.`);
    return element;
  }
}
