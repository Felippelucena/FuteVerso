import { goalkeeperQuality, type MatchState } from "../../domain/match";
import type { PlayerRuntime } from "../../domain/match/model";
import type { Team } from "../../domain/shared/model";
import { DRIBBLE_RANGE_REASON_LABELS, DRIBBLE_TOUCH_LABELS, INTENT_LABELS, PACE_LABELS, PASS_PURPOSE_LABELS, percentage, POSITION_LABELS, REASON_LABELS, ROLE_LABELS, SHOT_TECHNIQUE_LABELS, teamLabel, type TeamNames } from "../app/labels";

export interface MatchHeaderViewModel {
  blueGoals: string;
  coralGoals: string;
  /** "1º TEMPO" / "2º TEMPO" enquanto a bola rola; "ENCERRADA" depois do apito final. */
  status: string;
  possessionLabel: string;
  bluePossession: number;
  coralPossession: number;
}

export const createMatchHeaderViewModel = (state: MatchState, teamNames: TeamNames): MatchHeaderViewModel => {
  const total = state.stats.blue.possessionSeconds + state.stats.coral.possessionSeconds;
  const bluePossession = total > 0 ? Math.round(state.stats.blue.possessionSeconds / total * 100) : 50;
  return {
    blueGoals: String(state.stats.blue.goals),
    coralGoals: String(state.stats.coral.goals),
    status: state.finished ? "ENCERRADA" : `${state.half}º TEMPO`,
    possessionLabel: state.ballControlTeam ? `${teamLabel(state.ballControlTeam, teamNames)} com a bola` : "Bola em disputa",
    bluePossession,
    coralPossession: 100 - bluePossession,
  };
};

export const createMatchSummary = (state: MatchState, teamNames: TeamNames): string => {
  const blue = state.stats.blue;
  const coral = state.stats.coral;
  const leader = blue.goals === coral.goals ? null : teamNames[blue.goals > coral.goals ? "blue" : "coral"];
  const moreThreatening = blue.shots === coral.shots ? null : teamNames[blue.shots > coral.shots ? "blue" : "coral"];
  if (!state.finished) {
    return `${teamLabel(state.possessionTeam ?? state.lastControlledTeam ?? "blue", teamNames)} conduz a fase atual; ${blue.finalThirdEntries + coral.finalThirdEntries} entradas no terço final registradas.`;
  }
  if (leader) {
    return `${leader} venceu por ${blue.goals} a ${coral.goals}. ${moreThreatening ? `${moreThreatening} finalizou mais.` : "As equipes finalizaram o mesmo número de vezes."}`;
  }
  return `Empate em ${blue.goals} a ${coral.goals}. ${moreThreatening ? `${moreThreatening} criou mais finalizações.` : "Equilíbrio também nas finalizações."}`;
};

export const createContestMetric = (state: MatchState): string => {
  const observed = state.stats.blue.possessionSeconds + state.stats.coral.possessionSeconds + state.contestedSeconds;
  return `Disputa ${percentage(state.contestedSeconds, observed)}`;
};

export const intentLabel = (state: MatchState, player: PlayerRuntime): string => {
  if (player.intent !== "knockingOn") return INTENT_LABELS[player.intent];
  const range = state.ball.dribbleOwnerId === player.profile.id
    ? state.ball.dribbleTouchRange
    : player.plan?.ballAction.kind === "dribble" ? player.plan.ballAction.touchRange : null;
  return range ? DRIBBLE_TOUCH_LABELS[range] : INTENT_LABELS.knockingOn;
};

export interface DecisionDiagnostic {
  readonly label: string;
  readonly headline: string;
  readonly detail: string;
}

export interface PlayerDetailViewModel {
  readonly playerId: string;
  readonly team: Team;
  readonly name: string;
  readonly position: string;
  readonly intent: string;
  readonly reason: string;
  readonly diagnostics: readonly DecisionDiagnostic[];
  readonly metrics: readonly { readonly label: string; readonly value: string }[];
}

const saveActionLabels = {
  standingSave: "Em pé",
  lowDive: "Mergulho baixo",
  highDive: "Mergulho alto",
  verticalJump: "Salto vertical",
  punch: "Soco",
} as const;

const reception = (state: MatchState, player: PlayerRuntime): DecisionDiagnostic | null => {
  const pass = state.pendingPass;
  if (!pass || (pass.receiverId !== player.profile.id && pass.passerId !== player.profile.id)) return null;
  return {
    label: "RECEPÇÃO",
    headline: `${PASS_PURPOSE_LABELS[pass.purpose ?? "feet"]} · ${pass.range === "long" ? "Longo" : "Curto"} ${pass.trajectory === "air" ? "aéreo" : "rasteiro"}`,
    detail: `Ponto ${pass.landingPoint.x.toFixed(1)}, ${pass.landingPoint.y.toFixed(1)} · ETA ${pass.receiverEta.toFixed(2)}s / rival ${pass.opponentEta.toFixed(2)}s`,
  };
};

const preparation = (player: PlayerRuntime): DecisionDiagnostic | null => {
  const prepared = player.plan?.preparedReceptionAction;
  if (!prepared) return null;
  const headline = prepared.kind === "shot" || prepared.kind === "redirect"
    ? SHOT_TECHNIQUE_LABELS[prepared.technique ?? "redirect"]
    : prepared.kind === "pass" ? "Passe de primeira"
      : prepared.fallback === "protectBall" ? "Proteger a bola" : "Domínio orientado";
  return {
    label: "PREPARAÇÃO",
    headline,
    detail: `Altura ${prepared.expectedHeight.toFixed(2)} · velocidade ${prepared.expectedSpeed.toFixed(1)} · valor ${prepared.score.toFixed(2)}`,
  };
};

const carrying = (player: PlayerRuntime): DecisionDiagnostic | null => {
  const action = player.plan?.ballAction.kind === "dribble" ? player.plan.ballAction : null;
  if (action?.runway === undefined) return null;
  return {
    label: "CONDUÇÃO",
    headline: `${action.touchRange ? DRIBBLE_TOUCH_LABELS[action.touchRange] : "Sem pique"} · ${DRIBBLE_RANGE_REASON_LABELS[action.rangeReason ?? "insufficientRunway"]}`,
    detail: `Corredor ${action.runway.toFixed(1)} · ETA ${action.carrierEta?.toFixed(2) ?? "–"}s / rival ${Number.isFinite(action.opponentEta) ? action.opponentEta?.toFixed(2) : "livre"}s`,
  };
};

const shooting = (player: PlayerRuntime): DecisionDiagnostic | null => {
  const action = player.plan?.ballAction.kind === "shot" ? player.plan.ballAction : null;
  if (!action) return null;
  return {
    label: "FINALIZAÇÃO",
    headline: `${SHOT_TECHNIQUE_LABELS[action.technique ?? "power"]} · valor ${action.utility?.toFixed(2) ?? "–"}`,
    detail: `Linha ${action.blocked ? "bloqueada" : "livre"} · espaço do goleiro ${action.goalkeeperGap?.toFixed(1) ?? "–"}`,
  };
};

// A qualidade do contato só existe no instante em que a bola é tocada; durante o voo mostramos a
// qualidade de base do goleiro (a mesma que alimenta a fórmula) e somamos a do lance ao resolver.
const saving = (player: PlayerRuntime): DecisionDiagnostic | null => {
  const attempt = player.goalkeeperAttempt;
  if (!attempt) return null;
  const action = attempt.launchedAt === null
    ? "Ajustando posição"
    : saveActionLabels[attempt.action as keyof typeof saveActionLabels] ?? "Saída aérea";
  const launch = attempt.launchedAt === null
    ? "Ainda no chão"
    : `Impulso ${attempt.launchSpeed.toFixed(1)} · salto ${attempt.launchVertical.toFixed(1)}${attempt.desperate ? " · desesperado" : ""}`;
  const quality = `qualidade do goleiro ${goalkeeperQuality(player).toFixed(2)}${attempt.contactQuality !== null ? ` · lance ${attempt.contactQuality.toFixed(2)}` : ""}`;
  return {
    label: "DEFESA",
    headline: `${action} · ${attempt.outcome ?? "em andamento"}`,
    detail: `${launch} · ${quality}`,
  };
};

export const createPlayerDetailViewModel = (state: MatchState, player: PlayerRuntime): PlayerDetailViewModel => {
  const stats = player.memory.stats;
  const planAge = player.plan ? Math.max(0, state.elapsed - player.plan.startedAt) : 0;
  return {
    playerId: player.profile.id,
    team: player.team,
    name: player.profile.name,
    position: `${POSITION_LABELS[player.profile.position]} · ${ROLE_LABELS[player.profile.role]}`,
    intent: intentLabel(state, player),
    reason: REASON_LABELS[player.decisionReason],
    diagnostics: [reception(state, player), preparation(player), carrying(player), shooting(player), saving(player)]
      .filter((diagnostic): diagnostic is DecisionDiagnostic => diagnostic !== null),
    metrics: [
      { label: "POSTURA", value: player.posture === "inPossession" ? "COM POSSE" : "SEM POSSE" },
      { label: "RITMO", value: PACE_LABELS[player.pace] },
      { label: "PLANO", value: `${planAge.toFixed(1)}s` },
      { label: "GOLS", value: String(stats.goals) },
      { label: "PASSES", value: String(stats.completedPasses) },
    ],
  };
};

export const playerDetailSignature = (detail: PlayerDetailViewModel): string => [
  detail.playerId,
  detail.intent,
  detail.reason,
  ...detail.diagnostics.map((item) => `${item.label}${item.headline}${item.detail}`),
  ...detail.metrics.map((item) => item.value),
].join("|");
