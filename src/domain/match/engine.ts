import type { MatchState } from "./model";
import { sampleSpatialAnalytics } from "./systems/analytics-system";
import { updateBall, updateControlledBall } from "./systems/ball-system";
import { resolveBallPlayerCollision, resolvePlayerCollisions } from "./systems/collision-system";
import { updateCognition } from "./systems/cognition-system";
import {
  accrueAddedTime,
  advanceMatchClock,
  advanceOffside,
  expireTemporalEffects,
  finishMatchIfNeeded,
  startNextHalfIfNeeded,
} from "./systems/lifecycle-system";
import { advanceRestart, updateRestartRestriction } from "./runtime/restart";
import { clampPlayersToField, updatePlayers } from "./systems/movement-system";
import { expirePendingPass, updatePossession } from "./systems/possession-system";
import { updateTacticalContext } from "./systems/tactics-system";
import { updateGoalkeeperAnticipation } from "./systems/goalkeeper-system";

export function stepMatch(state: MatchState, dt: number): void {
  if (state.finished) return;

  advanceMatchClock(state, dt);
  // Tempo de bola morta vira acréscimo — antes de qualquer gate, para contar o tick pare quem parar.
  accrueAddedTime(state, dt);
  expireTemporalEffects(state);
  // O intervalo arma a saída do tempo seguinte e o fim-com-contexto, então vem antes do gate.
  startNextHalfIfNeeded(state);
  sampleSpatialAnalytics(state);

  // Impedimento apitado congela a jogada e desenha a linha antes do tiro livre: uma parada de fato,
  // física e cognição suspensas, mas o relógio e o tempo tático correm. A bola parada NÃO congela —
  // é uma fase viva restrita (os jogadores caminham), tratada no fluxo normal por advanceRestart.
  if (advanceOffside(state, dt)) {
    updateTacticalContext(state, dt);
    finishMatchIfNeeded(state);
    return;
  }

  updatePossession(state, 0);
  updateTacticalContext(state, 0);
  updateGoalkeeperAnticipation(state, dt);
  const decisions = updateCognition(state);
  updatePlayers(state, decisions, dt);
  // Na bola parada os jogadores atravessam uns aos outros para se recolocar — senão um jogador no
  // campo errado (o atacante largado após um gol) fica preso na linha adversária e nunca volta.
  if (!(state.restart && !state.restart.ballInPlay)) resolvePlayerCollisions(state);
  clampPlayersToField(state);
  // Depois do movimento (precisa da posição final do cobrador) e antes do controle da bola (para
  // entregar a posse no mesmo tick em que o cobrador chega ao ponto).
  advanceRestart(state, dt);
  updateControlledBall(state, decisions, dt);
  updateBall(state, dt);
  updatePossession(state, dt);
  resolveBallPlayerCollision(state);
  updateTacticalContext(state, dt);
  expirePendingPass(state);
  updateRestartRestriction(state);
  finishMatchIfNeeded(state);
}
