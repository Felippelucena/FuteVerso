import type { MatchEvent } from "../../domain/match/model";
import type { PlayerProfile } from "../../domain/roster/model";
import { formatClock, type TeamNames } from "../app/labels";

/** Sufixo de acréscimo cumprido, ex.: " (+00:22)". Omitido quando não houve acréscimo. */
const addedTimeSuffix = (seconds: number): string => (seconds >= 0.5 ? ` (+${formatClock(seconds)})` : "");

export const formatMatchEvent = (
  event: MatchEvent,
  roster: readonly PlayerProfile[],
  teamNames: TeamNames,
): string => {
  const label = (team: keyof TeamNames): string => teamNames[team];
  if (event.type === "match-started") return "Partida iniciada";
  if (event.type === "match-finished") return `Fim de partida${addedTimeSuffix(event.addedTime)}`;
  if (event.type === "half-ended") return `Fim do ${event.half}º tempo${addedTimeSuffix(event.addedTime)}`;
  if (event.type === "half-started") return `Início do ${event.half}º tempo — saída de ${label(event.kickoffTeam)}`;
  if (event.type === "added-time-signalled") {
    return `${event.final ? "Acréscimos finais" : "Acréscimos"}: +${formatClock(event.seconds)}`;
  }
  if (event.type === "restart-awarded") {
    const restart = event.restartKind === "throwIn" ? "Lateral"
      : event.restartKind === "corner" ? "Escanteio"
        : event.restartKind === "freeKick" ? "Tiro livre"
          : "Tiro de meta";
    return `${restart} para ${label(event.team)}`;
  }
  const player = roster.find((candidate) => candidate.id === event.playerId);
  if (event.type === "offside-called") {
    return `Impedimento de ${player?.name ?? label(event.team)}`;
  }
  if (event.type === "save-made") {
    const action = event.outcome === "catch" ? "encaixou" : event.outcome === "parry" ? "rebateu" : "defendeu";
    return `${player?.name ?? label(event.team)} ${action}`;
  }
  if (event.type === "shot-taken") return `${player?.name ?? label(event.team)} finalizou`;
  const origin = event.origin === "shot" ? "finalização" : event.origin === "pass" ? "passe" : "condução";
  return `Gol de ${player?.name ?? label(event.team)} (${origin})`;
};
