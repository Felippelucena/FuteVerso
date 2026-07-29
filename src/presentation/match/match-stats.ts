import { FIELD } from "../../domain/match/config";
import type { MatchState, TacticalPhase, TeamStats } from "../../domain/match/model";
import { PASS_PURPOSE_LABELS, percentage, PHASE_LABELS } from "../app/labels";

/**
 * Uma linha da tabela de análise: os dois números como o leitor os vê, mais a fatia que a barra
 * comparativa preenche. O texto e a barra saem da MESMA chamada porque são a mesma informação —
 * separá-los deixaria a barra dizer uma coisa e o número outra.
 */
export interface StatRow {
  readonly label: string;
  readonly blue: string;
  readonly coral: string;
  /** Quanto da barra é do time da casa, 0..1. Sem nada registrado, divide ao meio. */
  readonly share: number;
}

export interface StatGroup {
  readonly title: string;
  /** O que o grupo diz sem precisar abrir. */
  readonly summary: string;
  readonly rows: readonly StatRow[];
  readonly open: boolean;
}

/**
 * A fatia da barra. Só faz sentido sobre grandezas não negativas — é uma parte de um total, não
 * uma diferença —, e o limite garante que nenhuma linha futura desenhe barra para fora da caixa.
 */
const share = (blue: number, coral: number): number => {
  const total = blue + coral;
  return total > 0 ? Math.min(1, Math.max(0, blue / total)) : 0.5;
};

const rate = (made: number, total: number): number => total > 0 ? made / total : 0;

/** Contagem simples — a barra compara os dois números. */
const count = (label: string, blue: number, coral: number): StatRow => ({
  label,
  blue: String(Math.round(blue)),
  coral: String(Math.round(coral)),
  share: share(blue, coral),
});

/** Aproveitamento "12/19" — a barra compara os acertos, que é o que o leitor está pesando. */
const ratio = (
  label: string,
  blue: readonly [number, number],
  coral: readonly [number, number],
): StatRow => ({
  label,
  blue: `${blue[0]}/${blue[1]}`,
  coral: `${coral[0]}/${coral[1]}`,
  share: share(blue[0], coral[0]),
});

/** Percentual — a barra compara os percentuais, não os valores brutos que os geraram. */
const percent = (
  label: string,
  blue: readonly [number, number],
  coral: readonly [number, number],
): StatRow => ({
  label,
  blue: percentage(blue[0], blue[1]),
  coral: percentage(coral[0], coral[1]),
  share: share(rate(blue[0], blue[1]), rate(coral[0], coral[1])),
});

const decimal = (label: string, blue: number, coral: number, digits = 1): StatRow => ({
  label,
  blue: blue.toFixed(digits),
  coral: coral.toFixed(digits),
  share: share(blue, coral),
});

const average = (stats: TeamStats, key: "widthIntegral" | "depthIntegral" | "compactnessIntegral"): number =>
  stats.spatialSeconds > 0 ? stats[key] / stats.spatialSeconds : 0;

/** Quanto valia a chance média que o time criou — o xG dividido pelo que ele finalizou. */
const perShot = (stats: TeamStats): number => stats.shots > 0 ? stats.expectedGoals / stats.shots : 0;

/** Distância em quilômetros: o gramado é medido em unidades, e ninguém lê partida em unidades. */
const kilometres = (stats: TeamStats): number => stats.distanceCovered / FIELD.unitsPerMeter / 1000;

const PHASE_ORDER = Object.entries(PHASE_LABELS) as readonly [TacticalPhase, string][];

const phaseTotal = (stats: TeamStats): number =>
  PHASE_ORDER.reduce((total, [phase]) => total + stats.phaseSeconds[phase], 0);

/**
 * A tabela de análise inteira, agrupada. Cada grupo é uma pergunta que se faz sobre a partida —
 * quem finalizou mais, quem passou melhor — e é isso que decide onde uma linha entra.
 */
export const createStatGroups = (state: MatchState): readonly StatGroup[] => {
  const blue = state.stats.blue;
  const coral = state.stats.coral;
  const possession = [blue.possessionSeconds, blue.possessionSeconds + coral.possessionSeconds] as const;
  const coralPossession = [coral.possessionSeconds, blue.possessionSeconds + coral.possessionSeconds] as const;
  const bluePhases = phaseTotal(blue);
  const coralPhases = phaseTotal(coral);

  return [
    {
      title: "DESTAQUES",
      summary: `${blue.goals} – ${coral.goals}`,
      open: true,
      rows: [
        percent("Posse de bola", possession, coralPossession),
        decimal("Gols esperados (xG)", blue.expectedGoals, coral.expectedGoals, 2),
        count("Finalizações", blue.shots, coral.shots),
        count("No alvo", blue.shotsOnTarget, coral.shotsOnTarget),
        percent("Precisão de passe", [blue.completedPasses, blue.passes], [coral.completedPasses, coral.passes]),
        count("Entradas na área", blue.boxEntries, coral.boxEntries),
      ],
    },
    {
      title: "GOLS ESPERADOS",
      summary: `${blue.expectedGoals.toFixed(2)} · ${coral.expectedGoals.toFixed(2)}`,
      open: false,
      rows: [
        decimal("xG total", blue.expectedGoals, coral.expectedGoals, 2),
        decimal("xG por finalização", perShot(blue), perShot(coral), 3),
        decimal("Assistências esperadas (xA)", blue.expectedAssists, coral.expectedAssists, 2),
        count("Grandes chances", blue.bigChances, coral.bigChances),
        count("Grandes chances perdidas", blue.bigChancesMissed, coral.bigChancesMissed),
      ],
    },
    {
      title: "FINALIZAÇÃO",
      summary: `${blue.shots} · ${coral.shots}`,
      open: true,
      rows: [
        count("Finalizações", blue.shots, coral.shots),
        count("No alvo", blue.shotsOnTarget, coral.shotsOnTarget),
        count("Para fora", blue.shotsOffTarget, coral.shotsOffTarget),
        count("Bloqueadas", blue.shotsBlocked, coral.shotsBlocked),
        count("Na trave", blue.shotsOnWoodwork, coral.shotsOnWoodwork),
        count("Dentro da área", blue.shotsInsideBox, coral.shotsInsideBox),
        count("De longe", blue.longShots, coral.longShots),
        count("De primeira", blue.firstTimeShots, coral.firstTimeShots),
        count("Cabeceios", blue.headers, coral.headers),
        count("Voleios", blue.volleys, coral.volleys),
        count("Gols de finalização", blue.goalsFromShots, coral.goalsFromShots),
        count("Gols de passe", blue.goalsFromPasses, coral.goalsFromPasses),
        count("Gols de condução", blue.goalsFromDribbles, coral.goalsFromDribbles),
      ],
    },
    {
      title: "PASSE",
      summary: `${percentage(blue.completedPasses, blue.passes)} · ${percentage(coral.completedPasses, coral.passes)}`,
      open: false,
      rows: [
        ratio("Passes certos", [blue.completedPasses, blue.passes], [coral.completedPasses, coral.passes]),
        percent("Precisão", [blue.completedPasses, blue.passes], [coral.completedPasses, coral.passes]),
        ratio("Longos", [blue.completedLongPasses, blue.longPasses], [coral.completedLongPasses, coral.longPasses]),
        ratio("Aéreos", [blue.completedAerialPasses, blue.aerialPasses], [coral.completedAerialPasses, coral.aerialPasses]),
        count(PASS_PURPOSE_LABELS.cross, blue.crosses, coral.crosses),
        count(PASS_PURPOSE_LABELS.cutback, blue.cutbacks, coral.cutbacks),
        count(PASS_PURPOSE_LABELS.throughBall, blue.throughBalls, coral.throughBalls),
        count(PASS_PURPOSE_LABELS.switch, blue.switches, coral.switches),
        count("Quebras de linha", blue.lineBreaks, coral.lineBreaks),
        count("Entradas no terço final", blue.finalThirdEntries, coral.finalThirdEntries),
        count("Entradas na área", blue.boxEntries, coral.boxEntries),
      ],
    },
    {
      title: "DEFESA",
      summary: `${blue.saves} · ${coral.saves}`,
      open: false,
      rows: [
        ratio("Defesas", [blue.saves, blue.saveAttempts], [coral.saves, coral.saveAttempts]),
        count("Encaixes", blue.catches, coral.catches),
        count("Rebotes", blue.parries, coral.parries),
        count("Raspões", blue.glancingTouches, coral.glancingTouches),
        count("Saídas aéreas", blue.highBallClaims, coral.highBallClaims),
        count("Socos", blue.punches, coral.punches),
        count("Recuperações", blue.turnoversWon, coral.turnoversWon),
        count("Recuperações no ataque", blue.attackingThirdRecoveries, coral.attackingThirdRecoveries),
      ],
    },
    {
      title: "DUELOS",
      summary: `${blue.tacklesWon} · ${coral.tacklesWon}`,
      open: false,
      rows: [
        ratio("Desarmes", [blue.tacklesWon, blue.tacklesAttempted], [coral.tacklesWon, coral.tacklesAttempted]),
        ratio("Fintas", [blue.feintsCompleted, blue.feintsAttempted], [coral.feintsCompleted, coral.feintsAttempted]),
        count("Toques longos", blue.sprintDribbles, coral.sprintDribbles),
        count("Toque curto", blue.shortSprintDribbles, coral.shortSprintDribbles),
        count("Toque médio", blue.mediumSprintDribbles, coral.mediumSprintDribbles),
        count("Toque longo", blue.longSprintDribbles, coral.longSprintDribbles),
        count("Avanços agressivos", blue.aggressiveBreaks, coral.aggressiveBreaks),
      ],
    },
    {
      title: "DISCIPLINA",
      summary: `${blue.fouls} · ${coral.fouls}`,
      open: false,
      rows: [
        count("Faltas", blue.fouls, coral.fouls),
        count("Impedimentos", blue.offsides, coral.offsides),
        count("Escanteios", blue.corners, coral.corners),
        count("Laterais", blue.throwIns, coral.throwIns),
        count("Tiros de meta", blue.goalKicks, coral.goalKicks),
        count("Tiros livres", blue.freeKicks, coral.freeKicks),
      ],
    },
    {
      title: "FORMA",
      summary: `${Math.round(average(blue, "widthIntegral"))} · ${Math.round(average(coral, "widthIntegral"))}`,
      open: false,
      rows: [
        count("Largura média", average(blue, "widthIntegral"), average(coral, "widthIntegral")),
        count("Profundidade média", average(blue, "depthIntegral"), average(coral, "depthIntegral")),
        count("Compactação média", average(blue, "compactnessIntegral"), average(coral, "compactnessIntegral")),
        decimal("Distância (km)", kilometres(blue), kilometres(coral)),
      ],
    },
    {
      title: "TEMPO POR FASE",
      summary: `${Math.round(bluePhases)}s · ${Math.round(coralPhases)}s`,
      open: false,
      rows: PHASE_ORDER.map(([phase, label]) => percent(
        label,
        [blue.phaseSeconds[phase], bluePhases],
        [coral.phaseSeconds[phase], coralPhases],
      )),
    },
  ];
};

/** Assinatura da seção: o conteúdo exibido, e nada além dele. */
export const statGroupsSignature = (groups: readonly StatGroup[]): string => groups
  .map((group) => `${group.title}${group.summary}${group.rows.map((row) => `${row.label}${row.blue}${row.coral}`).join("")}`)
  .join("|");
