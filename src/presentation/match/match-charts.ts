import { FIELD, MOMENTUM_WINDOWS } from "../../domain/match/config";
import type { MatchState, MomentumWindow, ResolvedShot, ShotOutcome } from "../../domain/match/model";
import type { Team } from "../../domain/shared/model";

/**
 * Os gráficos do painel de análise. Desenham a partir do registro de chutes e das janelas de
 * momento — nada aqui recalcula o que o motor já decidiu, só escolhe como mostrar.
 *
 * Canvas, e não SVG, pelo mesmo motivo do mapa tático ao lado: são dezenas de pontos redesenhados
 * enquanto a partida corre, e cada um deles seria um nó no DOM.
 */

const TEAM_COLORS: Record<Team, string> = { blue: "#3b82f6", coral: "#f36f56" };
const TEAM_SOFT: Record<Team, string> = { blue: "#8fb4ff", coral: "#ff9e8b" };
const PITCH = "#17201c";
const LINE = "#303833";
const MUTED = "#929d97";
const LIME = "#b9df62";
const AMBER = "#f5c451";

/** Preenchimento por desfecho. `null` é ponto vazado: a bola não terminou em ninguém. */
const OUTCOME_FILL: Record<ShotOutcome, string | null> = {
  goal: LIME,
  saved: "#c6cfca",
  woodwork: AMBER,
  blocked: "#465049",
  off: null,
  dead: null,
};

/** Prepara o contexto na resolução do monitor e devolve as medidas em pixels de CSS. */
const setup = (canvas: HTMLCanvasElement, height: number): { context: CanvasRenderingContext2D; width: number } | null => {
  const width = canvas.clientWidth;
  if (width === 0) return null;
  const ratio = window.devicePixelRatio || 1;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(ratio, ratio);
  return { context, width };
};

const drawPitchOutline = (context: CanvasRenderingContext2D, width: number, height: number): void => {
  context.fillStyle = PITCH;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(235,247,238,.22)";
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, width - 1, height - 1);
  context.beginPath();
  context.moveTo(width / 2, 0);
  context.lineTo(width / 2, height);
  context.stroke();
  context.beginPath();
  context.arc(width / 2, height / 2, FIELD.centerCircleRadius / FIELD.width * width, 0, Math.PI * 2);
  context.stroke();
  for (const [depth, span] of [[FIELD.penaltyDepth, FIELD.penaltyWidth], [FIELD.goalAreaDepth, FIELD.goalAreaWidth]]) {
    const boxWidth = depth / FIELD.width * width;
    const boxHeight = span / FIELD.height * height;
    const top = (height - boxHeight) / 2;
    context.strokeRect(0.5, top, boxWidth, boxHeight);
    context.strokeRect(width - boxWidth - 0.5, top, boxWidth, boxHeight);
  }
};

/**
 * Cada finalização é um ponto onde ela saiu. O RAIO é o xG — quanto valia a chance —, o
 * preenchimento é o desfecho e o anel é o time. Três informações sem três legendas competindo.
 */
export const drawShotMap = (canvas: HTMLCanvasElement, shots: readonly ResolvedShot[]): void => {
  const prepared = setup(canvas, Math.round(canvas.clientWidth * FIELD.height / FIELD.width));
  if (!prepared) return;
  const { context, width } = prepared;
  const height = Math.round(width * FIELD.height / FIELD.width);
  drawPitchOutline(context, width, height);
  for (const shot of shots) {
    const x = shot.origin.x / FIELD.width * width;
    const y = shot.origin.y / FIELD.height * height;
    const radius = 1.8 + Math.sqrt(shot.expectedGoals) * 8;
    const fill = OUTCOME_FILL[shot.outcome];
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    if (fill) {
      context.globalAlpha = shot.outcome === "goal" ? 0.95 : 0.7;
      context.fillStyle = fill;
      context.fill();
      context.globalAlpha = 1;
    } else {
      context.strokeStyle = "#718078";
      context.lineWidth = 1;
      context.stroke();
    }
    context.beginPath();
    context.arc(x, y, radius + 1.6, 0, Math.PI * 2);
    context.strokeStyle = TEAM_COLORS[shot.team];
    context.globalAlpha = 0.8;
    context.lineWidth = 1;
    context.stroke();
    context.globalAlpha = 1;
  }
};

/**
 * O xG somando ao longo da partida, em degraus: cada finalização levanta a linha do tamanho do
 * que ela valia. É a curva que conta a história do jogo — quem chegou lá e quando.
 */
export const drawXgTimeline = (canvas: HTMLCanvasElement, state: MatchState): void => {
  const prepared = setup(canvas, 76);
  if (!prepared) return;
  const { context, width } = prepared;
  const height = 76;
  const padTop = 6;
  const padBottom = 11;
  const duration = Math.max(state.rules.matchDuration, state.elapsed);
  const ceiling = Math.max(0.5, state.stats.blue.expectedGoals, state.stats.coral.expectedGoals);
  const px = (at: number): number => at / duration * width;
  const py = (value: number): number => height - padBottom - value / ceiling * (height - padTop - padBottom);

  context.clearRect(0, 0, width, height);
  context.strokeStyle = LINE;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, height - padBottom + 0.5);
  context.lineTo(width, height - padBottom + 0.5);
  context.stroke();
  for (let half = 1; half < state.rules.halves; half += 1) {
    context.setLineDash([2, 3]);
    context.beginPath();
    context.moveTo(px(state.rules.halfDuration * half), padTop);
    context.lineTo(px(state.rules.halfDuration * half), height - padBottom);
    context.stroke();
    context.setLineDash([]);
  }

  for (const team of ["coral", "blue"] as const) {
    const teamShots = state.shots.filter((shot) => shot.team === team);
    context.strokeStyle = TEAM_SOFT[team];
    context.lineWidth = 1.5;
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(0, py(0));
    let total = 0;
    for (const shot of teamShots) {
      context.lineTo(px(shot.at), py(total));
      total += shot.expectedGoals;
      context.lineTo(px(shot.at), py(total));
    }
    context.lineTo(px(state.elapsed), py(total));
    context.stroke();
    if (teamShots.length > 0) {
      context.beginPath();
      context.arc(px(state.elapsed), py(total), 2.2, 0, Math.PI * 2);
      context.fillStyle = TEAM_SOFT[team];
      context.fill();
    }
  }

  // O gol marcado na própria curva do time que o fez, para o degrau e o gol se lerem juntos.
  for (const shot of state.shots) {
    if (shot.outcome !== "goal") continue;
    const total = state.shots
      .filter((other) => other.team === shot.team && other.at <= shot.at)
      .reduce((sum, other) => sum + other.expectedGoals, 0);
    context.beginPath();
    context.arc(px(shot.at), py(total), 3, 0, Math.PI * 2);
    context.fillStyle = LIME;
    context.fill();
    context.strokeStyle = PITCH;
    context.lineWidth = 1.2;
    context.stroke();
  }

  context.fillStyle = MUTED;
  context.font = "600 7px ui-sans-serif, system-ui, sans-serif";
  context.fillText("0'", 1, height - 2);
  context.fillText(`${Math.round(duration / 60)}'`, width - 13, height - 2);
};

/**
 * Quem estava por cima, janela a janela: barra para cima é a casa, para baixo o visitante. A
 * janela ainda em curso é dividida pelas amostras que já tem, senão ela nasceria sempre baixa.
 */
export const drawMomentum = (canvas: HTMLCanvasElement, windows: readonly MomentumWindow[]): void => {
  const prepared = setup(canvas, 54);
  if (!prepared) return;
  const { context, width } = prepared;
  const height = 54;
  const middle = height / 2;
  const slot = width / MOMENTUM_WINDOWS;

  context.clearRect(0, 0, width, height);
  for (const [index, window] of windows.entries()) {
    if (window.samples === 0) continue;
    const value = window.pressure / window.samples;
    const magnitude = Math.min(1, Math.abs(value)) * (middle - 3);
    context.fillStyle = value >= 0 ? TEAM_COLORS.blue : TEAM_COLORS.coral;
    context.globalAlpha = 0.5 + Math.min(1, Math.abs(value)) * 0.5;
    context.fillRect(index * slot + 0.75, value >= 0 ? middle - magnitude : middle, slot - 1.5, magnitude);
    context.globalAlpha = 1;
  }
  context.strokeStyle = LINE;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, Math.round(middle) + 0.5);
  context.lineTo(width, Math.round(middle) + 0.5);
  context.stroke();
};
