import { MATCH_HALVES } from "../config";
import type { Team } from "../model";

/**
 * Agenda dos tempos (Regra 7), a parte que é calendário e não geometria: quem cobra a saída de
 * cada tempo e qual é o último. A mecânica da bola parada em si — posições, primeiro toque, entrega
 * da posse — vive em `runtime/restart`.
 */

/** Quem cobra a saída do primeiro tempo. Nos seguintes, alterna. */
export const OPENING_KICKOFF_TEAM: Team = "blue";

export const opposingTeam = (team: Team): Team => (team === "blue" ? "coral" : "blue");

/** Regra 7: a saída do 2º tempo é do time que não cobrou a do 1º, e assim por diante. */
export const kickoffTeamOfHalf = (half: number): Team =>
  half % 2 === 1 ? OPENING_KICKOFF_TEAM : opposingTeam(OPENING_KICKOFF_TEAM);

/** Último tempo da partida: depois dele o apito é final, não intervalo. */
export const isFinalHalf = (half: number): boolean => half >= MATCH_HALVES;
