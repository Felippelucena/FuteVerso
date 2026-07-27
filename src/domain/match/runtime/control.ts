import { POSSESSION } from "../config";
import { clamp, distance } from "../../shared/math";
import type { MatchState, PlayerRuntime, Team } from "../model";
import { policyLearningBounds } from "../../roster/personality";
import { emitCognitiveEvent } from "./cognitive-events";

export const pressureAt = (state: MatchState, player: PlayerRuntime): number => {
  const closest = Math.min(...state.players.filter((other) => other.team !== player.team).map((other) => distance(other.position, player.position)));
  return clamp(1 - closest / 10, 0, 1);
};

/**
 * Quem manda na bola agora — **quem chega nela primeiro**, e não quem a tocou por último.
 *
 * A definição antiga (`controllerId ?? dribbleOwnerId ?? pendingPass.receiverId`) achatava três
 * estados diferentes num id só: o time inteiro tratava uma bola adiantada num pique, ou um passe
 * já desviado, como se ela estivesse colada no pé de alguém.
 *
 * Numa disputa aberta a resposta é **ninguém** — e não o líder do momento. Nomear um favorito
 * enquanto a corrida oscila trocaria o ator a cada quadro, e com ele o plano dos vinte e dois.
 * Ver `runtime/ball-situation`.
 */
export const activeBallPlayerId = (state: MatchState): string | null =>
  state.ballSituation.phase === "contested" ? null : state.ballSituation.favourite?.playerId ?? null;

export const adaptPlayerPolicy = (
  player: PlayerRuntime,
  key: keyof PlayerRuntime["memory"]["policy"],
  amount: number,
): void => {
  if (amount === 0) return;
  const bounds = policyLearningBounds(player.profile, key);
  const learningScale = 0.6 + player.profile.mental.adaptability / 100 * 1.4;
  player.memory.policy[key] = clamp(player.memory.policy[key] + amount * learningScale, bounds.minimum, bounds.maximum);
  player.memory.version += 1;
};

const confirmPossession = (state: MatchState, team: Team): void => {
  const previous = state.lastControlledTeam;
  if (previous !== team) {
    if (previous) state.stats[team].turnoversWon += 1;
    state.previousControlledTeam = previous;
    state.lastControlledTeam = team;
    state.controlChangedAt = state.elapsed;
    state.lastPossessionChangeAt = state.elapsed;
    emitCognitiveEvent(state, "possessionChanged", null, { controllerId: state.ball.controllerId ?? undefined });
  }
  state.possessionTeam = team;
  state.possessionCandidateTeam = null;
  state.possessionCandidateSince = state.elapsed;
  state.nextCognitionAt = state.elapsed;
};

export const registerControlledTeam = (state: MatchState, team: Team, force = false): void => {
  if (state.ballControlTeam !== team) state.ballControlTeam = team;
  if (force || state.possessionTeam === team) {
    if (state.possessionTeam !== team) confirmPossession(state, team);
    else {
      state.possessionCandidateTeam = null;
      state.possessionCandidateSince = state.elapsed;
    }
    return;
  }
  if (state.possessionCandidateTeam !== team) {
    state.possessionCandidateTeam = team;
    state.possessionCandidateSince = state.elapsed;
    return;
  }
  if (state.elapsed - state.possessionCandidateSince >= POSSESSION.confirmationSeconds) confirmPossession(state, team);
};

export const registerLooseBall = (state: MatchState): void => {
  if (state.ballControlTeam !== null) {
    state.ballControlTeam = null;
    state.possessionCandidateTeam = null;
    state.possessionCandidateSince = state.elapsed;
  }
  if (state.possessionTeam && state.elapsed - state.possessionCandidateSince >= POSSESSION.looseBallGraceSeconds) {
    state.possessionTeam = null;
  }
};

export const clearDribbleOwner = (state: MatchState): void => {
  state.ball.dribbleOwnerId = null;
  state.ball.dribbleTarget = null;
  state.ball.dribbleStyle = null;
  state.ball.dribbleTouchRange = null;
  state.ball.dribbleStartedAt = 0;
};

/**
 * Regra 12: a bola nas mãos do goleiro é posse encerrada. Ninguém a disputa, ninguém o empurra e
 * ninguém corre atrás dela — a jogada só recomeça quando ele a devolve ao chão.
 *
 * Fonte única da regra: antes ela existia só no `engagement-system` (imune ao desarme), e os
 * sistemas que decidem a corrida pela bola e resolvem a colisão dos corpos não a conheciam. O
 * resultado era o pressionador mirando um ponto dentro do corpo do goleiro e empurrando-o, com a
 * bola nas mãos, para dentro da própria meta.
 */
export const keeperHoldingBall = (state: MatchState, player: PlayerRuntime): boolean =>
  player.profile.position === "goalkeeper"
  && state.ball.controllerId === player.profile.id
  && state.elapsed < player.goalkeeperHoldUntil;

/** O goleiro que segura a bola agora, se houver — a mesma pergunta, feita sem um jogador em mãos. */
export const ballHeldByKeeper = (state: MatchState): PlayerRuntime | null =>
  state.players.find((player) => keeperHoldingBall(state, player)) ?? null;

/** Zera as tentativas/estados de defesa dos goleiros — usado ao reiniciar a jogada (bola parada). */
export const clearGoalkeeperAttempts = (state: MatchState): void => {
  for (const goalkeeper of state.players.filter((player) => player.profile.position === "goalkeeper")) {
    goalkeeper.goalkeeperAttempt = null;
    goalkeeper.goalkeeperRecoveryUntil = 0;
    goalkeeper.goalkeeperHoldUntil = 0;
    goalkeeper.goalkeeperAlertUntil = 0;
  }
};

export const isEvadedDefender = (state: MatchState, player: PlayerRuntime): boolean =>
  state.elapsed < player.evadedUntil;
