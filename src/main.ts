import {
  createIcons,
  Dices,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from "lucide";
import { buildMatchConfig } from "./application/match/build-match-config";
import { createDefaultProfile } from "./application/profile/create-default-profile";
import { updateProfileMemories } from "./application/profile/update-profile-memories";
import { ANALYTICS_GRID, FIELD, FIXED_STEP } from "./domain/match/config";
import { createMatchState, extractPlayerMemories, stepMatch } from "./domain/match";
import type {
  DecisionReason,
  MovementPace,
  TacticalPhase,
} from "./domain/match/model";
import type {
  GameProfile,
  PlayerMentalAttributes,
  PlayerPosition,
  PlayerProfile,
  PlayerRole,
  PlayerSkills,
} from "./domain/roster/model";
import { createMentalAttributes, dominantMentalTraits, MENTAL_PRESET_LABELS, MENTAL_PRESETS, type MentalPreset } from "./domain/roster/personality";
import { createMemory, validateLineups } from "./domain/roster/rules";
import type { Team } from "./domain/shared/model";
import { LocalStorageSaveRepository } from "./infrastructure/persistence/local-storage-save-repository";
import { GameRenderer } from "./presentation/canvas/game-renderer";
import { formatMatchEvent } from "./presentation/match/format-match-event";
import "./style.css";

const UI_ICONS = { Dices, Pause, Pencil, Play, Plus, RotateCcw, Save, SlidersHorizontal, Trash2, Users, X };

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Elemento raiz não encontrado.");

const SKILL_FIELDS: { key: keyof PlayerSkills; label: string }[] = [
  { key: "acceleration", label: "Aceleração" }, { key: "sprintSpeed", label: "Velocidade" },
  { key: "burst", label: "Explosão" }, { key: "stamina", label: "Resistência" },
  { key: "control", label: "Controle" }, { key: "passing", label: "Passe" },
  { key: "vision", label: "Visão" }, { key: "finishing", label: "Finalização" },
  { key: "defending", label: "Defesa" }, { key: "kickPower", label: "Força" },
  { key: "goalkeeping", label: "Goleiro" },
];
const MENTAL_FIELDS: { key: keyof PlayerMentalAttributes; label: string }[] = [
  { key: "decisionMaking", label: "Tomada de decisão" }, { key: "anticipation", label: "Antecipação" },
  { key: "composure", label: "Compostura" }, { key: "aggression", label: "Agressividade" },
  { key: "teamwork", label: "Trabalho coletivo" }, { key: "creativity", label: "Criatividade" },
  { key: "intensity", label: "Intensidade" }, { key: "adaptability", label: "Adaptabilidade" },
];

const POSITION_LABELS: Record<PlayerPosition, string> = {
  goalkeeper: "Goleiro", centerBack: "Zagueiro", fullBack: "Lateral", midfielder: "Meio-campo", forward: "Atacante",
};
const ROLE_LABELS: Record<PlayerRole, string> = { finisher: "Finalizador", playmaker: "Construção", defender: "Defesa" };
const INTENT_LABELS = {
  carrying: "Conduzindo", sprinting: "Sprint controlado", knockingOn: "Toque longo", feinting: "Fintando", passing: "Passando", shooting: "Finalizando", supporting: "Apoiando",
  pressing: "Pressionando", marking: "Marcando", covering: "Cobrindo", goalkeeping: "Protegendo o gol",
} as const;
const PACE_LABELS: Record<MovementPace, string> = {
  walk: "Caminhada", run: "Corrida", burst: "Explosão", closeControl: "Domínio curto",
};
const PHASE_LABELS: Record<TacticalPhase, string> = {
  buildUp: "Construção", progression: "Progressão", finalThird: "Último terço", counterAttack: "Contra-ataque",
  highPress: "Pressão alta", midBlock: "Bloco médio", lowBlock: "Bloco baixo", counterPress: "Contra-pressão", recovery: "Recomposição",
};
const REASON_LABELS: Record<DecisionReason, string> = {
  shootingWindow: "Janela de finalização", progressivePass: "Passe rompe linha", switchPlay: "Inverter lado congestionado",
  wallPass: "Devolver para tabela", escapePressure: "Escapar da pressão", carryIntoSpace: "Atacar espaço livre",
  giveWidth: "Dar amplitude", runInBehind: "Atacar profundidade", thirdManSupport: "Apoio de terceiro homem",
  restDefense: "Proteger o contra-ataque", pressBall: "Pressionar o portador", coverGoal: "Cobrir o gol",
  markThreat: "Marcar ameaça", protectGoal: "Proteger o gol",
};

const skillInputs = SKILL_FIELDS.map(({ key, label }) => `
  <label class="skill-field"><span>${label}</span><input name="${key}" type="number" min="1" max="100" value="65" required /></label>
`).join("");
const mentalInputs = MENTAL_FIELDS.map(({ key, label }) => `
  <label class="skill-field"><span>${label}</span><input name="mental-${key}" type="number" min="1" max="100" value="65" required /></label>
`).join("");
const mentalPresetOptions = Object.entries(MENTAL_PRESET_LABELS)
  .map(([value, label]) => `<option value="${value}">${label}</option>`).join("");

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-lockup"><span class="brand-mark" aria-hidden="true"></span><div><h1>Autoball Lab</h1><p>SIMULADOR 4 × 4</p></div></div>
      <section class="scoreboard" aria-label="Placar">
        <div class="score-team score-team--blue"><span>NILO</span><strong id="score-blue">0</strong></div>
        <div class="match-clock"><span id="match-time">00:00</span><small id="match-state">EM CURSO</small></div>
        <div class="score-team score-team--coral"><strong id="score-coral">0</strong><span>MAYA</span></div>
      </section>
      <div class="simulation-status"><span class="live-dot"></span><span>SIMULAÇÃO ATIVA</span></div>
    </header>

    <nav class="view-tabs" aria-label="Áreas do simulador">
      <button type="button" class="is-active" data-view="match">Partida</button>
      <button type="button" data-view="players"><i data-lucide="users"></i>Jogadores</button>
    </nav>

    <section id="match-view" class="workspace">
      <div class="field-panel">
        <div class="field-toolbar">
          <div class="toolbar-title"><strong>Partida autônoma</strong><span id="possession-label">Bola em disputa</span></div>
          <div class="toolbar-actions">
            <button class="icon-button mobile-settings-button" data-open-match-settings type="button" aria-label="Abrir configurações da partida" title="Configurações"><i data-lucide="sliders-horizontal"></i></button>
            <button class="icon-button" id="pause-button" type="button" aria-label="Pausar simulação" title="Pausar simulação"><i data-lucide="pause"></i></button>
            <button class="icon-button" id="reset-button" type="button" aria-label="Reiniciar partida" title="Reiniciar partida"><i data-lucide="rotate-ccw"></i></button>
            <div class="speed-control" aria-label="Velocidade da simulação">
              <button type="button" data-speed="0.5">0.5×</button><button type="button" data-speed="1" class="is-active">1×</button>
              <button type="button" data-speed="2">2×</button><button type="button" data-speed="4">4×</button><button type="button" data-speed="8">8×</button>
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
          <div id="match-roster" class="match-roster"></div>
          <div id="player-detail" class="player-detail"></div>
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
          <div class="events-heading"><span class="eyebrow">ÚLTIMOS EVENTOS</span><small>Atualização ao vivo</small></div>
          <ol id="event-list" class="event-list"></ol>
        </section>
      </aside>
    </section>

    <section id="players-view" class="manager-view" hidden>
      <div class="manager-heading"><div><span class="eyebrow">ELENCO</span><h2>Jogadores e escalações</h2></div><button id="add-player" class="primary-button" type="button"><i data-lucide="plus"></i>Novo jogador</button></div>
      <p id="manager-message" class="manager-message" aria-live="polite"></p>
      <div id="lineup-grid" class="lineup-grid"></div>
      <div class="players-section"><div class="section-heading"><h3>Todos os jogadores</h3><span id="player-count"></span></div><div id="players-table" class="players-table"></div></div>
    </section>
  </main>

  <dialog id="player-dialog" class="player-dialog">
    <form id="player-form" method="dialog">
      <div class="dialog-heading"><div><span class="eyebrow">PERFIL</span><h2 id="dialog-title">Novo jogador</h2></div><button class="icon-button" id="close-player" type="button" aria-label="Fechar" title="Fechar"><i data-lucide="x"></i></button></div>
      <input type="hidden" name="id" />
      <div class="identity-fields">
        <label><span>Nome</span><input name="name" maxlength="24" required /></label>
        <label><span>Número</span><input name="number" type="number" min="1" max="99" required /></label>
        <label><span>Posição</span><select name="position">${Object.entries(POSITION_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
        <label><span>Função</span><select name="role">${Object.entries(ROLE_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
      </div>
      <div class="skills-heading"><strong>Atributos</strong><span>1–100</span></div>
      <div class="skills-grid">${skillInputs}</div>
      <div class="skills-heading"><strong>Personalidade</strong><span>1–100</span></div>
      <label class="mental-preset"><span>Preset mental</span><select id="mental-preset" name="mentalPreset">${mentalPresetOptions}<option value="custom">Personalizado</option></select></label>
      <div class="skills-grid mental-grid">${mentalInputs}</div>
      <div class="dialog-actions"><button type="button" class="secondary-button" id="cancel-player">Cancelar</button><button type="submit" class="primary-button"><i data-lucide="save"></i>Salvar jogador</button></div>
    </form>
  </dialog>

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
  </dialog>
`;

createIcons({ icons: UI_ICONS });

const repository = new LocalStorageSaveRepository(window.localStorage, createDefaultProfile);
let profileData = repository.load();
let state = createMatchState(buildMatchConfig(profileData));
let selectedPlayerId = state.players[0].profile.id;
let editingPlayerId: string | null = null;
let paused = false;
let simulationSpeed = 1;
let accumulator = 0;
let previousTime = performance.now();
let lastUiUpdate = 0;
let lastMemorySave = performance.now();

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas")!;
const renderer = new GameRenderer(canvas);
const bySelector = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Elemento ${selector} não encontrado.`);
  return element;
};
const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
const teamLabel = (team: Team): string => team === "blue" ? "NILO" : "MAYA";
const formatClock = (seconds: number): string => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;

const persistMemory = (): void => {
  profileData = updateProfileMemories(profileData, extractPlayerMemories(state));
  profileData.settings.learningEnabled = state.learningEnabled;
  repository.save(profileData);
  lastMemorySave = performance.now();
};

const renderMatchRoster = (): void => {
  bySelector("#match-roster").innerHTML = (["blue", "coral"] as const).map((team) => `
    <div class="roster-team"><span class="roster-team-name roster-team-name--${team}">${teamLabel(team)}</span>
      ${state.players.filter((player) => player.team === team).map((player) => `
        <button type="button" class="roster-player ${selectedPlayerId === player.profile.id ? "is-selected" : ""}" data-inspect-player="${player.profile.id}">
          <span class="shirt shirt--${team}">${player.profile.number}</span><span><strong>${escapeHtml(player.profile.name)}</strong><small>${POSITION_LABELS[player.profile.position]} · ${INTENT_LABELS[player.intent]}</small></span><i>${Math.round(player.energy * 100)}</i>
        </button>`).join("")}
    </div>`).join("");
  const selected = state.players.find((player) => player.profile.id === selectedPlayerId) ?? state.players[0];
  if (!selected) return;
  selectedPlayerId = selected.profile.id;
  const stats = selected.memory.stats;
  const planAge = selected.plan ? Math.max(0, state.elapsed - selected.plan.startedAt) : 0;
  bySelector("#player-detail").innerHTML = `
    <div class="detail-title"><div><strong>${escapeHtml(selected.profile.name)}</strong><span>${POSITION_LABELS[selected.profile.position]} · ${ROLE_LABELS[selected.profile.role]}</span></div><span class="intent intent--${selected.team}">${INTENT_LABELS[selected.intent]}</span></div>
    <div class="decision-explanation"><small>POR QUÊ</small><strong>${REASON_LABELS[selected.decisionReason]}</strong></div>
    <div class="detail-metrics"><span><small>POSTURA</small><strong>${selected.posture === "inPossession" ? "COM POSSE" : "SEM POSSE"}</strong></span><span><small>RITMO</small><strong>${PACE_LABELS[selected.pace]}</strong></span><span><small>PLANO</small><strong>${planAge.toFixed(1)}s</strong></span><span><small>GOLS</small><strong>${stats.goals}</strong></span><span><small>PASSES</small><strong>${stats.completedPasses}</strong></span></div>`;
};

const percentage = (value: number, total: number): string => `${total > 0 ? Math.round(value / total * 100) : 0}%`;
const averageShape = (team: Team, key: "widthIntegral" | "depthIntegral" | "compactnessIntegral"): number => {
  const stats = state.stats[team];
  return stats.spatialSeconds > 0 ? stats[key] / stats.spatialSeconds : 0;
};

const renderTacticalMap = (team: Team): void => {
  const canvas = bySelector<HTMLCanvasElement>(`#tactical-map-${team}`);
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
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
  context.beginPath();
  context.moveTo(width / 2, 0);
  context.lineTo(width / 2, height);
  context.stroke();
  const players = state.players.filter((player) => player.team === team);
  const byId = new Map(players.map((player) => [player.profile.id, player]));
  const connections = Object.entries(state.passNetwork[team]);
  const strongest = Math.max(1, ...connections.map(([, count]) => count));
  for (const [key, count] of connections) {
    const [fromId, toId] = key.split(">");
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from || !to) continue;
    context.strokeStyle = `rgba(255,255,255,${0.18 + count / strongest * 0.52})`;
    context.lineWidth = 0.7 + count / strongest * 2.1;
    context.beginPath();
    context.moveTo(from.position.x / FIELD.width * width, from.position.y / FIELD.height * height);
    context.lineTo(to.position.x / FIELD.width * width, to.position.y / FIELD.height * height);
    context.stroke();
  }
  for (const player of players) {
    const x = player.position.x / FIELD.width * width;
    const y = player.position.y / FIELD.height * height;
    context.fillStyle = team === "blue" ? "#7fb0ff" : "#ff9b87";
    context.beginPath();
    context.arc(x, y, player.profile.position === "goalkeeper" ? 2.2 : 2.8, 0, Math.PI * 2);
    context.fill();
  }
};

const renderAnalysis = (): void => {
  for (const team of ["blue", "coral"] as const) {
    bySelector(`#phase-${team}`).textContent = PHASE_LABELS[state.tactics[team].phase];
    const shape = state.tactics[team].shape;
    bySelector(`#shape-${team}`).textContent = `Largura ${Math.round(shape.width)} · Prof. ${Math.round(shape.depth)}`;
    renderTacticalMap(team);
  }
  const blue = state.stats.blue;
  const coral = state.stats.coral;
  const rows = [
    ["Passes certos", `${blue.completedPasses}/${blue.passes}`, `${coral.completedPasses}/${coral.passes}`],
    ["Precisão", percentage(blue.completedPasses, blue.passes), percentage(coral.completedPasses, coral.passes)],
    ["Passes longos", `${blue.completedLongPasses}/${blue.longPasses}`, `${coral.completedLongPasses}/${coral.longPasses}`],
    ["Passes aéreos", `${blue.completedAerialPasses}/${blue.aerialPasses}`, `${coral.completedAerialPasses}/${coral.aerialPasses}`],
    ["Finalizações", blue.shots, coral.shots],
    ["Chutes no alvo", blue.shotsOnTarget, coral.shotsOnTarget],
    ["Defesas", blue.saves, coral.saves],
    ["Fintas", `${blue.feintsCompleted}/${blue.feintsAttempted}`, `${coral.feintsCompleted}/${coral.feintsAttempted}`],
    ["Toques longos", blue.sprintDribbles, coral.sprintDribbles],
    ["Desarmes", `${blue.tacklesWon}/${blue.tacklesAttempted}`, `${coral.tacklesWon}/${coral.tacklesAttempted}`],
    ["Recuperações", blue.turnoversWon, coral.turnoversWon],
    ["Entradas no terço final", blue.finalThirdEntries, coral.finalThirdEntries],
    ["Quebras de linha", blue.lineBreaks, coral.lineBreaks],
    ["Inversões", blue.switches, coral.switches],
    ["Largura média", Math.round(averageShape("blue", "widthIntegral")), Math.round(averageShape("coral", "widthIntegral"))],
    ["Compactação média", Math.round(averageShape("blue", "compactnessIntegral")), Math.round(averageShape("coral", "compactnessIntegral"))],
  ];
  bySelector("#analysis-table").innerHTML = `<div class="analysis-row analysis-row--head"><span>MÉTRICA</span><strong>NILO</strong><strong>MAYA</strong></div>${rows.map(([label, blueValue, coralValue]) => `<div class="analysis-row"><span>${label}</span><strong>${blueValue}</strong><strong>${coralValue}</strong></div>`).join("")}`;
  const observed = blue.possessionSeconds + coral.possessionSeconds + state.contestedSeconds;
  bySelector("#contest-metric").textContent = `Disputa ${percentage(state.contestedSeconds, observed)}`;
  bySelector("#analysis-title").textContent = state.finished ? "Relatório final" : "Relatório ao vivo";
  const leader = blue.goals === coral.goals ? null : blue.goals > coral.goals ? "NILO" : "MAYA";
  const moreThreatening = blue.shots === coral.shots ? null : blue.shots > coral.shots ? "NILO" : "MAYA";
  bySelector("#match-summary").textContent = state.finished
    ? leader
      ? `${leader} venceu por ${blue.goals} a ${coral.goals}. ${moreThreatening ? `${moreThreatening} finalizou mais.` : "As equipes finalizaram o mesmo número de vezes."}`
      : `Empate em ${blue.goals} a ${coral.goals}. ${moreThreatening ? `${moreThreatening} criou mais finalizações.` : "Equilíbrio também nas finalizações."}`
    : `${teamLabel(state.possessionTeam ?? state.lastControlledTeam ?? "blue")} conduz a fase atual; ${blue.finalThirdEntries + coral.finalThirdEntries} entradas no terço final registradas.`;
};

const updateUi = (): void => {
  bySelector("#score-blue").textContent = String(state.stats.blue.goals);
  bySelector("#score-coral").textContent = String(state.stats.coral.goals);
  bySelector("#match-time").textContent = formatClock(state.elapsed);
  bySelector("#match-state").textContent = state.finished ? "ENCERRADA" : "EM CURSO";
  bySelector("#possession-label").textContent = state.ballControlTeam ? `${teamLabel(state.ballControlTeam)} com a bola` : "Bola em disputa";
  const total = state.stats.blue.possessionSeconds + state.stats.coral.possessionSeconds;
  const blue = total > 0 ? Math.round(state.stats.blue.possessionSeconds / total * 100) : 50;
  bySelector("#possession-blue").textContent = `${blue}%`;
  bySelector("#possession-coral").textContent = `${100 - blue}%`;
  (bySelector("#possession-fill") as HTMLSpanElement).style.width = `${blue}%`;
  renderMatchRoster();
  renderAnalysis();
  bySelector<HTMLButtonElement>("#pause-button").disabled = state.finished;
  bySelector<HTMLOListElement>("#event-list").innerHTML = state.events.map((event) => {
    const team = "team" in event ? event.team : null;
    return `<li class="event-item ${team ? `event-item--${team}` : ""}"><time>${formatClock(event.time)}</time><span>${escapeHtml(formatMatchEvent(event, profileData.players))}</span></li>`;
  }).join("");
};

const usedPlayerIds = (): string[] => (["blue", "coral"] as const).flatMap((team) => [profileData.lineups[team].goalkeeperId, ...profileData.lineups[team].fieldPlayerIds]);

const playerOptions = (currentId: string, goalkeeper: boolean): string => {
  return profileData.players
    .filter((player) => goalkeeper ? player.position === "goalkeeper" : player.position !== "goalkeeper")
    .map((player) => `<option value="${player.id}" ${player.id === currentId ? "selected" : ""}>${escapeHtml(player.name)} · ${POSITION_LABELS[player.position]}</option>`)
    .join("");
};

const renderManager = (): void => {
  bySelector("#lineup-grid").innerHTML = (["blue", "coral"] as const).map((team) => {
    const lineup = profileData.lineups[team];
    const slots = [
      { label: "Goleiro", value: lineup.goalkeeperId, slot: "goalkeeper", goalkeeper: true },
      ...lineup.fieldPlayerIds.map((value, index) => ({ label: `Linha ${index + 1}`, value, slot: String(index), goalkeeper: false })),
    ];
    return `<section class="lineup-panel lineup-panel--${team}"><div class="lineup-title"><span></span><div><small>TIME</small><h3>${teamLabel(team)}</h3></div></div>
      <div class="lineup-slots">${slots.map((slot) => `<label><span>${slot.label}</span><select class="lineup-select" data-team="${team}" data-slot="${slot.slot}">${playerOptions(slot.value, slot.goalkeeper)}</select></label>`).join("")}</div></section>`;
  }).join("");
  bySelector("#player-count").textContent = `${profileData.players.length} jogadores`;
  bySelector("#players-table").innerHTML = profileData.players.map((player) => `
    <div class="player-table-row"><span class="shirt shirt--neutral">${player.number}</span><div class="player-table-name"><strong>${escapeHtml(player.name)}</strong><span>${POSITION_LABELS[player.position]} · ${ROLE_LABELS[player.role]} · ${dominantMentalTraits(player.mental).join(" / ")}</span></div>
      <div class="player-rating"><span>CON <strong>${player.skills.control}</strong></span><span>PAS <strong>${player.skills.passing}</strong></span><span>VEL <strong>${player.skills.sprintSpeed}</strong></span></div>
      <div class="row-actions"><button class="icon-button" type="button" data-edit-player="${player.id}" aria-label="Editar ${escapeHtml(player.name)}" title="Editar"><i data-lucide="pencil"></i></button><button class="icon-button icon-button--danger" type="button" data-delete-player="${player.id}" aria-label="Excluir ${escapeHtml(player.name)}" title="Excluir"><i data-lucide="trash-2"></i></button></div></div>`).join("");
  createIcons({ icons: UI_ICONS });
};

const setManagerMessage = (message: string, error = false): void => {
  const element = bySelector("#manager-message");
  element.textContent = message;
  element.classList.toggle("is-error", error);
};

const resetMatch = (): void => {
  persistMemory();
  state = createMatchState(buildMatchConfig(profileData));
  selectedPlayerId = state.players[0].profile.id;
  accumulator = 0;
  updateUi();
};

const frame = (now: number): void => {
  const realDelta = Math.min((now - previousTime) / 1000, 0.1);
  previousTime = now;
  if (!paused && !state.finished) {
    accumulator += realDelta * simulationSpeed;
    let safety = 0;
    while (accumulator >= FIXED_STEP && safety < 140) { stepMatch(state, FIXED_STEP); accumulator -= FIXED_STEP; safety += 1; }
  }
  renderer.render(state);
  if (now - lastUiUpdate > 140) { updateUi(); lastUiUpdate = now; }
  if (now - lastMemorySave > 5000) persistMemory();
  requestAnimationFrame(frame);
};

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("is-active", item === button));
    bySelector("#match-view").hidden = view !== "match";
    bySelector("#players-view").hidden = view !== "players";
    if (view === "players") renderManager(); else renderer.resize();
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]")) {
  button.addEventListener("click", () => {
    const tab = button.dataset.inspectorTab;
    document.querySelectorAll<HTMLButtonElement>("[data-inspector-tab]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll<HTMLElement>("[data-inspector-panel]").forEach((panel) => {
      const active = panel.dataset.inspectorPanel === tab;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
  });
}

const pauseButton = bySelector<HTMLButtonElement>("#pause-button");
pauseButton.addEventListener("click", () => {
  paused = !paused;
  pauseButton.innerHTML = `<i data-lucide="${paused ? "play" : "pause"}"></i>`;
  pauseButton.setAttribute("aria-label", paused ? "Continuar simulação" : "Pausar simulação");
  pauseButton.title = paused ? "Continuar simulação" : "Pausar simulação";
  createIcons({ icons: UI_ICONS });
  document.querySelector(".simulation-status span:last-child")!.textContent = paused ? "SIMULAÇÃO PAUSADA" : "SIMULAÇÃO ATIVA";
  document.querySelector(".live-dot")!.classList.toggle("is-paused", paused);
});
bySelector("#reset-button").addEventListener("click", resetMatch);
const settingsDialog = bySelector<HTMLDialogElement>("#match-settings-dialog");
const seedInput = bySelector<HTMLInputElement>("#settings-seed-input");
seedInput.value = String(profileData.settings.randomSeed);
const applySeed = (rawValue: string): void => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    seedInput.value = String(profileData.settings.randomSeed);
    return;
  }
  const nextSeed = Math.min(0xffff_ffff, Math.max(0, Math.trunc(parsed)));
  profileData.settings.randomSeed = nextSeed;
  seedInput.value = String(nextSeed);
  repository.save(profileData);
  resetMatch();
};
seedInput.addEventListener("change", () => applySeed(seedInput.value));
seedInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") seedInput.blur();
});
bySelector("#settings-random-seed").addEventListener("click", () => {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  const nextSeed = values[0] === profileData.settings.randomSeed ? (values[0] + 1) >>> 0 : values[0];
  applySeed(String(nextSeed));
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-open-match-settings]")) {
  button.addEventListener("click", () => {
    seedInput.value = String(profileData.settings.randomSeed);
    bySelector<HTMLInputElement>("#learning-toggle").checked = state.learningEnabled;
    settingsDialog.showModal();
  });
}
bySelector<HTMLInputElement>("#learning-toggle").addEventListener("change", (event) => {
  state.learningEnabled = (event.currentTarget as HTMLInputElement).checked;
  profileData.settings.learningEnabled = state.learningEnabled;
  persistMemory();
});
bySelector("#reset-learning").addEventListener("click", () => {
  profileData.memories = Object.fromEntries(profileData.players.map((player) => [player.id, createMemory(player)]));
  repository.save(profileData);
  state = createMatchState(buildMatchConfig(profileData));
  updateUi();
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
  button.addEventListener("click", () => {
    simulationSpeed = Number(button.dataset.speed);
    document.querySelectorAll("[data-speed]").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
  });
}

bySelector("#match-roster").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-inspect-player]");
  if (!button) return;
  selectedPlayerId = button.dataset.inspectPlayer!;
  renderMatchRoster();
});

bySelector("#lineup-grid").addEventListener("change", (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>(".lineup-select");
  if (!select) return;
  const team = select.dataset.team as Team;
  const slot = select.dataset.slot!;
  const previous = JSON.parse(JSON.stringify(profileData.lineups)) as GameProfile["lineups"];
  const replacedId = slot === "goalkeeper" ? previous[team].goalkeeperId : previous[team].fieldPlayerIds[Number(slot)];
  for (const otherTeam of ["blue", "coral"] as const) {
    if (previous[otherTeam].goalkeeperId === select.value) profileData.lineups[otherTeam].goalkeeperId = replacedId;
    const otherIndex = previous[otherTeam].fieldPlayerIds.indexOf(select.value);
    if (otherIndex >= 0) profileData.lineups[otherTeam].fieldPlayerIds[otherIndex] = replacedId;
  }
  if (slot === "goalkeeper") profileData.lineups[team].goalkeeperId = select.value;
  else profileData.lineups[team].fieldPlayerIds[Number(slot)] = select.value;
  if (!validateLineups(profileData.players, profileData.lineups)) {
    profileData.lineups = previous;
    setManagerMessage("Essa troca deixaria a escalação inválida ou duplicaria um jogador.", true);
  } else {
    repository.save(profileData);
    setManagerMessage("Escalação salva. Ela entra em campo no próximo reinício.");
  }
  renderManager();
});

const dialog = bySelector<HTMLDialogElement>("#player-dialog");
const playerForm = bySelector<HTMLFormElement>("#player-form");
const syncRoleOptions = (): void => {
  const position = playerForm.elements.namedItem("position") as HTMLSelectElement;
  const role = playerForm.elements.namedItem("role") as HTMLSelectElement;
  const goalkeeper = position.value === "goalkeeper";
  if (goalkeeper) role.value = "defender";
  for (const option of role.options) option.disabled = goalkeeper && option.value !== "defender";
};
const openPlayerDialog = (profile?: PlayerProfile): void => {
  editingPlayerId = profile?.id ?? null;
  playerForm.reset();
  bySelector("#dialog-title").textContent = profile ? "Editar jogador" : "Novo jogador";
  (playerForm.elements.namedItem("id") as HTMLInputElement).value = profile?.id ?? "";
  (playerForm.elements.namedItem("name") as HTMLInputElement).value = profile?.name ?? "";
  (playerForm.elements.namedItem("number") as HTMLInputElement).value = String(profile?.number ?? 12);
  (playerForm.elements.namedItem("position") as HTMLSelectElement).value = profile?.position ?? "midfielder";
  (playerForm.elements.namedItem("role") as HTMLSelectElement).value = profile?.role ?? "playmaker";
  for (const { key } of SKILL_FIELDS) (playerForm.elements.namedItem(key) as HTMLInputElement).value = String(profile?.skills[key] ?? 65);
  const defaultMental = profile?.mental ?? createMentalAttributes("balanced");
  for (const { key } of MENTAL_FIELDS) (playerForm.elements.namedItem(`mental-${key}`) as HTMLInputElement).value = String(defaultMental[key]);
  (playerForm.elements.namedItem("mentalPreset") as HTMLSelectElement).value = profile ? "custom" : "balanced";
  syncRoleOptions();
  dialog.showModal();
};
bySelector("#add-player").addEventListener("click", () => openPlayerDialog());
bySelector("#cancel-player").addEventListener("click", () => dialog.close());
bySelector("#close-player").addEventListener("click", () => dialog.close());
(playerForm.elements.namedItem("position") as HTMLSelectElement).addEventListener("change", (event) => {
  void event;
  syncRoleOptions();
});
bySelector<HTMLSelectElement>("#mental-preset").addEventListener("change", (event) => {
  const preset = (event.currentTarget as HTMLSelectElement).value;
  if (preset === "custom") return;
  const values = MENTAL_PRESETS[preset as MentalPreset];
  for (const { key } of MENTAL_FIELDS) {
    (playerForm.elements.namedItem(`mental-${key}`) as HTMLInputElement).value = String(values[key]);
  }
});
for (const { key } of MENTAL_FIELDS) {
  (playerForm.elements.namedItem(`mental-${key}`) as HTMLInputElement).addEventListener("input", () => {
    (playerForm.elements.namedItem("mentalPreset") as HTMLSelectElement).value = "custom";
  });
}

bySelector("#players-table").addEventListener("click", (event) => {
  const edit = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-edit-player]");
  const remove = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-delete-player]");
  if (edit) {
    const profile = profileData.players.find((player) => player.id === edit.dataset.editPlayer);
    if (profile) openPlayerDialog(profile);
  }
  if (remove) {
    const id = remove.dataset.deletePlayer!;
    if (usedPlayerIds().includes(id)) setManagerMessage("Substitua esse jogador na escalação antes de excluí-lo.", true);
    else {
      profileData.players = profileData.players.filter((player) => player.id !== id);
      delete profileData.memories[id];
      repository.save(profileData);
      setManagerMessage("Jogador excluído.");
      renderManager();
    }
  }
});

playerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(playerForm);
  const position = String(data.get("position")) as PlayerPosition;
  const role = position === "goalkeeper" ? "defender" : String(data.get("role")) as PlayerRole;
  const profile: PlayerProfile = {
    id: editingPlayerId ?? (crypto.randomUUID?.() ?? `player-${Date.now()}`),
    name: String(data.get("name")).trim(),
    number: Number(data.get("number")),
    position,
    role,
    skills: Object.fromEntries(SKILL_FIELDS.map(({ key }) => [key, Number(data.get(key))])) as unknown as PlayerSkills,
    mental: Object.fromEntries(MENTAL_FIELDS.map(({ key }) => [key, Number(data.get(`mental-${key}`))])) as unknown as PlayerMentalAttributes,
  };
  const previousPlayers = profileData.players;
  const previousProfile = editingPlayerId ? profileData.players.find((player) => player.id === editingPlayerId) : null;
  profileData.players = editingPlayerId ? profileData.players.map((player) => player.id === editingPlayerId ? profile : player) : [...profileData.players, profile];
  if (!validateLineups(profileData.players, profileData.lineups)) {
    profileData.players = previousPlayers;
    setManagerMessage("Essa alteração é incompatível com a escalação atual.", true);
    return;
  }
  if (!profileData.memories[profile.id]) profileData.memories[profile.id] = createMemory(profile);
  else if (previousProfile && (previousProfile.role !== profile.role || JSON.stringify(previousProfile.mental) !== JSON.stringify(profile.mental))) {
    const previousMemory = profileData.memories[profile.id];
    const recalibrated = createMemory(profile);
    recalibrated.stats = { ...previousMemory.stats };
    recalibrated.version = previousMemory.version + 1;
    profileData.memories[profile.id] = recalibrated;
  }
  repository.save(profileData);
  dialog.close();
  setManagerMessage(editingPlayerId ? "Jogador atualizado. A partida atual não foi alterada." : "Jogador criado e disponível para escalação.");
  renderManager();
});

const resizeObserver = new ResizeObserver(() => renderer.resize());
resizeObserver.observe(canvas);
document.addEventListener("visibilitychange", () => { if (document.hidden) persistMemory(); });
renderer.resize();
renderManager();
updateUi();
requestAnimationFrame(frame);
