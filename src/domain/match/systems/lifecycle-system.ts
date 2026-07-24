import { HALF_DURATION, MATCH_DURATION } from "../config";
import type { MatchState, Team } from "../model";
import { emitMatchEvent } from "../runtime/events";
import { isFinalHalf, kickoffTeamOfHalf } from "../runtime/kickoff";
import { restartFreeKick, setupKickoff } from "./ball-system";

export const advanceMatchClock = (state: MatchState, dt: number): void => {
  const nextElapsed = state.elapsed + dt;
  state.elapsed = nextElapsed >= MATCH_DURATION - 0.000_001 ? MATCH_DURATION : nextElapsed;
};

export const expireTemporalEffects = (state: MatchState): void => {
  if (state.feintEvasion && state.elapsed >= state.feintEvasion.expiresAt) state.feintEvasion = null;
};

export const advanceKickoff = (state: MatchState, dt: number): boolean => {
  if (state.kickoffTimer <= 0) return false;
  state.kickoffTimer = Math.max(0, state.kickoffTimer - dt);
  state.contestedSeconds += dt;
  return true;
};

/**
 * Impedimento apitado: congela a jogada e mostra a linha (a "bandeira") até `resolveAt`, quando
 * sai o tiro livre indireto do time que defende. Devolve `true` enquanto o jogo está parado, para
 * o motor pular o resto do tick — física e cognição ficam suspensas, como no pontapé de saída.
 */
export const advanceOffside = (state: MatchState, dt: number): boolean => {
  const call = state.offsideCall;
  if (!call) return false;
  state.contestedSeconds += dt;
  if (state.elapsed < call.resolveAt) return true;
  const defending: Team = call.team === "blue" ? "coral" : "blue";
  restartFreeKick(state, defending, call.spot);
  state.offsideCall = null;
  return true;
};

/** Instante em que o tempo em curso termina. O relógio segue correndo através dele. */
const halfEndsAt = (half: number): number => HALF_DURATION * half;

/**
 * Regra 7: acabado um tempo que não é o último, a partida recomeça com uma nova saída de bola —
 * cobrada pelo time que não cobrou a anterior. O relógio não zera: ele atravessa o intervalo,
 * como o cronômetro de uma partida de verdade.
 *
 * Os times ainda NÃO trocam de lado no intervalo (o azul ataca sempre para a direita); a troca
 * de campo depende de espelhar a direção de ataque em todo o motor e fica para outra rodada.
 */
export const startNextHalfIfNeeded = (state: MatchState): void => {
  if (state.finished || state.elapsed >= MATCH_DURATION || isFinalHalf(state.half)) return;
  if (state.elapsed < halfEndsAt(state.half)) return;
  emitMatchEvent(state, { type: "half-ended", half: state.half });
  state.half += 1;
  const kickoffTeam = kickoffTeamOfHalf(state.half);
  setupKickoff(state, kickoffTeam);
  emitMatchEvent(state, { type: "half-started", half: state.half, kickoffTeam });
};

export const finishMatchIfNeeded = (state: MatchState): void => {
  if (state.finished || state.elapsed < MATCH_DURATION) return;
  state.finished = true;
  emitMatchEvent(state, { type: "match-finished" });
};
