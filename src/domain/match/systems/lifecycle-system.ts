import type { MatchState, Team } from "../model";
import { isBallDead } from "../runtime/dead-ball";
import { emitMatchEvent } from "../runtime/events";
import { isFinalHalf, kickoffTeamOfHalf } from "../runtime/kickoff";
import { beginRestart, restartFreeKick } from "../runtime/restart";

export const advanceMatchClock = (state: MatchState, dt: number): void => {
  // O relógio precisa passar do fim nominal para cumprir os acréscimos. Trava só no teto absoluto
  // (nominal + graceCeiling), que é o que garante o término mesmo se o lance nunca concluir.
  const ceiling = state.rules.matchDuration + state.rules.stoppage.graceCeiling;
  const nextElapsed = state.elapsed + dt;
  state.elapsed = nextElapsed >= ceiling ? ceiling : nextElapsed;
};

export const expireTemporalEffects = (state: MatchState): void => {
  for (const player of state.players) {
    if (player.evadedByAttackerId && state.elapsed >= player.evadedUntil) player.evadedByAttackerId = null;
  }
};

/**
 * Acréscimos (Regra 7 estendida): cada segundo de bola morta volta como tempo adicional, como o
 * quarto árbitro somando o tempo perdido. Acumula o tempo todo, não só perto do fim.
 */
export const accrueAddedTime = (state: MatchState, dt: number): void => {
  if (isBallDead(state)) state.stoppage.accrued += dt * state.rules.stoppage.accrualFactor;
};

/**
 * Impedimento apitado: congela a jogada e mostra a linha (a "bandeira") até `resolveAt`, quando
 * sai o tiro livre indireto do time que defende. Devolve `true` enquanto o jogo está parado, para
 * o motor pular o resto do tick — física e cognição ficam suspensas.
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

/**
 * Falta apitada: congela a jogada até `resolveAt`, quando sai o tiro livre do time que a sofreu.
 * Devolve `true` enquanto o jogo está parado, para o motor pular o resto do tick — exatamente como
 * o impedimento, porque é a mesma coisa: o árbitro parou o jogo e vai recolocar a bola.
 */
export const advanceFoul = (state: MatchState, dt: number): boolean => {
  const call = state.foulCall;
  if (!call) return false;
  state.contestedSeconds += dt;
  if (state.elapsed < call.resolveAt) return true;
  const fouled: Team = call.team === "blue" ? "coral" : "blue";
  restartFreeKick(state, fouled, call.spot);
  state.foulCall = null;
  return true;
};

/** Instante em que o tempo em curso termina. O relógio segue correndo através dele. */
const halfEndsAt = (state: MatchState, half: number): number => state.rules.halfDuration * half;

/** Fim nominal + acréscimo anunciado (limitado). É quando a janela de encerramento abre. */
const targetEnd = (state: MatchState, nominal: number): number =>
  nominal + Math.min(state.stoppage.accrued, state.rules.stoppage.maxAddedTime);

/** Levanta a placa de acréscimos: registra quanto foi anunciado e quem atacava naquele instante. */
const openStoppageWindow = (state: MatchState, final: boolean): void => {
  const stoppage = state.stoppage;
  stoppage.awaitingEnd = true;
  stoppage.pendingSince = state.elapsed;
  stoppage.announced = Math.min(stoppage.accrued, state.rules.stoppage.maxAddedTime);
  stoppage.attackerAtOpen = state.possessionTeam ?? state.ballControlTeam ?? state.lastControlledTeam ?? null;
  if (stoppage.announced >= 0.5) {
    emitMatchEvent(state, { type: "added-time-signalled", half: state.half, seconds: stoppage.announced, final });
  }
};

const resetStoppage = (state: MatchState): void => {
  state.stoppage.accrued = 0;
  state.stoppage.awaitingEnd = false;
  state.stoppage.pendingSince = null;
  state.stoppage.announced = null;
  state.stoppage.attackerAtOpen = null;
};

/**
 * Fim com contexto: o apito só soa numa bola morta, OU quando o time que atacava perde a posse com
 * clareza (a defesa recuperou — o lance se desfez), OU quando ele ainda tem a bola mas já não
 * ameaça (saiu de finalThird/counterAttack). Como o árbitro real: deixa o lance concluir, mas não
 * segura indefinidamente.
 */
const canEndPeriod = (state: MatchState): boolean => {
  if (isBallDead(state)) return true;
  const controller = state.possessionTeam ?? state.ballControlTeam;
  if (controller === null) return true;
  if (controller !== state.stoppage.attackerAtOpen) return true;
  const phase = state.tactics[controller].phase;
  return phase !== "finalThird" && phase !== "counterAttack";
};

/**
 * Regra 7: acabado um tempo que não é o último, a partida recomeça com uma nova saída de bola —
 * cobrada pelo time que não cobrou a anterior. O relógio não zera: ele atravessa o intervalo.
 *
 * O tempo só termina ao cumprir o nominal + acréscimo E num momento de fim de lance (a placa de
 * acréscimos abre antes, uma vez). Passado o teto absoluto, apita seja como for.
 */
export const startNextHalfIfNeeded = (state: MatchState): void => {
  if (state.finished || isFinalHalf(state.half, state.rules.halves)) return;
  const nominal = halfEndsAt(state, state.half);
  if (state.elapsed < targetEnd(state, nominal)) return;
  if (!state.stoppage.awaitingEnd) openStoppageWindow(state, false);
  if (state.elapsed < nominal + state.rules.stoppage.graceCeiling && !canEndPeriod(state)) return;
  emitMatchEvent(state, { type: "half-ended", half: state.half, addedTime: state.elapsed - nominal });
  state.half += 1;
  resetStoppage(state);
  const kickoffTeam = kickoffTeamOfHalf(state.half);
  // Saída do novo tempo é caminhada, como qualquer bola parada: os jogadores voltam à formação.
  beginRestart(state, "kickoff", kickoffTeam, state.ball.position);
  emitMatchEvent(state, { type: "half-started", half: state.half, kickoffTeam });
};

export const finishMatchIfNeeded = (state: MatchState): void => {
  if (state.finished || !isFinalHalf(state.half, state.rules.halves)) return;
  if (state.elapsed < targetEnd(state, state.rules.matchDuration)) return;
  if (!state.stoppage.awaitingEnd) openStoppageWindow(state, true);
  if (state.elapsed < state.rules.matchDuration + state.rules.stoppage.graceCeiling && !canEndPeriod(state)) return;
  state.finished = true;
  emitMatchEvent(state, { type: "match-finished", addedTime: state.elapsed - state.rules.matchDuration });
};
