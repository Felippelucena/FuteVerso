import type { MatchEvent } from "../../domain/match/model";
import type { PlayerProfile } from "../../domain/roster/model";
import type { Team } from "../../domain/shared/model";

const teamLabel = (team: Team): string => team === "blue" ? "NILO" : "MAYA";

export const formatMatchEvent = (event: MatchEvent, roster: readonly PlayerProfile[]): string => {
  if (event.type === "match-started") return "Simulacao 4 x 4 iniciada";
  if (event.type === "match-finished") return "Fim de partida";
  if (event.type === "restart-awarded") {
    const restart = event.restartKind === "throwIn" ? "Lateral" : event.restartKind === "corner" ? "Escanteio" : "Tiro de meta";
    return `${restart} para ${teamLabel(event.team)}`;
  }
  const player = roster.find((candidate) => candidate.id === event.playerId);
  if (event.type === "save-made") {
    const action = event.outcome === "catch" ? "encaixou" : event.outcome === "parry" ? "rebateu" : "defendeu";
    return `${player?.name ?? teamLabel(event.team)} ${action}`;
  }
  if (event.type === "shot-taken") return `${player?.name ?? teamLabel(event.team)} finalizou`;
  const origin = event.origin === "shot" ? "finalização" : event.origin === "pass" ? "passe" : "condução";
  return `Gol de ${player?.name ?? teamLabel(event.team)} (${origin})`;
};
