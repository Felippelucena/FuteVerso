import type { MatchEvent } from "../../domain/match/model";
import type { PlayerProfile } from "../../domain/roster/model";
import type { TeamNames } from "../app/labels";

export const formatMatchEvent = (
  event: MatchEvent,
  roster: readonly PlayerProfile[],
  teamNames: TeamNames,
): string => {
  const label = (team: keyof TeamNames): string => teamNames[team];
  if (event.type === "match-started") return "Partida iniciada";
  if (event.type === "match-finished") return "Fim de partida";
  if (event.type === "restart-awarded") {
    const restart = event.restartKind === "throwIn" ? "Lateral" : event.restartKind === "corner" ? "Escanteio" : "Tiro de meta";
    return `${restart} para ${label(event.team)}`;
  }
  const player = roster.find((candidate) => candidate.id === event.playerId);
  if (event.type === "save-made") {
    const action = event.outcome === "catch" ? "encaixou" : event.outcome === "parry" ? "rebateu" : "defendeu";
    return `${player?.name ?? label(event.team)} ${action}`;
  }
  if (event.type === "shot-taken") return `${player?.name ?? label(event.team)} finalizou`;
  const origin = event.origin === "shot" ? "finalização" : event.origin === "pass" ? "passe" : "condução";
  return `Gol de ${player?.name ?? label(event.team)} (${origin})`;
};
