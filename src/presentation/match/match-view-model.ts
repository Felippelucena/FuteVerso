import type { MatchState } from "../../domain/match";
import { percentage, teamLabel, type TeamNames } from "../app/labels";

export interface MatchHeaderViewModel {
  blueGoals: string;
  coralGoals: string;
  status: "EM CURSO" | "ENCERRADA";
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
    status: state.finished ? "ENCERRADA" : "EM CURSO",
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
