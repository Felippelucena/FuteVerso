import { COGNITION } from "./config";
import type { MatchState } from "./model";
import { sampleSpatialAnalytics } from "./systems/analytics-system";
import { updateBall, updateControlledBall } from "./systems/ball-system";
import { resolveBallPlayerCollision, resolvePlayerCollisions } from "./systems/collision-system";
import { updateCognition } from "./systems/cognition-system";
import { updateEngagement } from "./systems/engagement-system";
import {
  accrueAddedTime,
  advanceFoul,
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

  // O quadro que os vinte e dois enxergam se refaz na taxa da PERCEPÇÃO, não na da física: a
  // leitura da bola e o contexto tático correm a 30 Hz enquanto os corpos se integram a 120. Vem
  // antes do gate de bola parada porque o relógio tático corre com a jogada congelada, e o `dt`
  // acumulado desde a última leitura mantém as integrais de forma exatas.
  const sincePerception = state.elapsed - state.perceivedAt;
  if (sincePerception >= COGNITION.perceptionSeconds) {
    updateTacticalContext(state, sincePerception);
    state.perceivedAt = state.elapsed;
  }

  // Impedimento apitado congela a jogada e desenha a linha antes do tiro livre: uma parada de fato,
  // física e cognição suspensas, mas o relógio e o tempo tático correm. A bola parada NÃO congela —
  // é uma fase viva restrita (os jogadores caminham), tratada no fluxo normal por advanceRestart.
  if (advanceOffside(state, dt) || advanceFoul(state, dt)) {
    finishMatchIfNeeded(state);
    return;
  }

  updatePossession(state, 0);
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
  // Depois do movimento (a disputa lê a posição final dos corpos no quadro) e antes do controle
  // da bola, que é onde as forças do contato entram na integração.
  updateEngagement(state, dt);
  updateControlledBall(state, decisions, dt);
  updateBall(state, dt);
  updatePossession(state, dt);
  resolveBallPlayerCollision(state);
  expirePendingPass(state);
  updateRestartRestriction(state);
  finishMatchIfNeeded(state);
}
