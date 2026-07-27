import { PHYSICS } from "../config";
import { add, distance, dot, length, scale, subtract } from "../../shared/math";
import type { MatchState, PlayerRuntime } from "../model";
import { isEvadedDefender, keeperHoldingBall } from "../runtime/control";
import { emitCognitiveEvent, relevantPlayersNear } from "../runtime/cognitive-events";

const evadesEachOther = (state: MatchState, defender: PlayerRuntime, attacker: PlayerRuntime): boolean =>
  state.elapsed < defender.evadedUntil && defender.evadedByAttackerId === attacker.profile.id;

const resolvePlayerCollision = (state: MatchState, a: PlayerRuntime, b: PlayerRuntime): void => {
  // O par de uma finta em curso se atravessa: o driblador passa pelo corpo do marcador vendido.
  if (evadesEachOther(state, a, b) || evadesEachOther(state, b, a)) return;
  const delta = subtract(b.position, a.position);
  const separation = length(delta);
  const minimum = a.radius + b.radius;
  if (separation >= minimum || separation < 0.001) return;
  const normal = scale(delta, 1 / separation);
  const overlap = minimum - separation;
  // Regra 12: o goleiro com a bola nas mãos é âncora. Quem trombar nele é que sai empurrado, e o
  // corpo dele não recebe impulso nenhum — sem isso a pressão o arrastava para dentro da meta.
  const anchoredA = keeperHoldingBall(state, a);
  const anchoredB = keeperHoldingBall(state, b);
  const shareA = anchoredA ? 0 : anchoredB ? 1 : 0.5;
  a.position = subtract(a.position, scale(normal, overlap * shareA));
  b.position = add(b.position, scale(normal, overlap * (1 - shareA)));
  const relative = (b.velocity.x - a.velocity.x) * normal.x + (b.velocity.y - a.velocity.y) * normal.y;
  if (relative < 0) {
    const impulse = scale(normal, relative * 0.38);
    if (!anchoredA) a.velocity = add(a.velocity, impulse);
    if (!anchoredB) b.velocity = subtract(b.velocity, impulse);
  }
};

export const resolvePlayerCollisions = (state: MatchState): void => {
  for (let first = 0; first < state.players.length; first += 1) {
    for (let second = first + 1; second < state.players.length; second += 1) {
      resolvePlayerCollision(state, state.players[first], state.players[second]);
    }
  }
};

export const resolveBallPlayerCollision = (state: MatchState): void => {
  if (state.ball.height > 1.8 || state.ball.controllerId) return;
  // Bola parada (reinício antes da cobrança): ela fica presa no ponto e ninguém a disputa — um
  // jogador que a atravesse no posicionamento não a "toca" nem a desloca. Regra 8.
  if (state.restart && !state.restart.ballInPlay) return;
  const nearest = state.players
    .filter((player) => !isEvadedDefender(state, player)
      && !(player.profile.position === "goalkeeper" && state.activeShot && state.activeShot.team !== player.team))
    .sort((a, b) => distance(a.position, state.ball.position) - distance(b.position, state.ball.position))[0];
  if (!nearest) return;
  const delta = subtract(state.ball.position, nearest.position);
  const separation = length(delta);
  const minimum = state.ball.radius + nearest.radius * PHYSICS.passiveCollisionRadiusFactor;
  if (separation >= minimum || separation < 0.001) return;
  const normal = scale(delta, 1 / separation);
  state.ball.position = add(nearest.position, scale(normal, minimum + 0.02));
  const relativeVelocity = subtract(state.ball.velocity, nearest.velocity);
  const normalSpeed = dot(relativeVelocity, normal);
  if (normalSpeed < 0) {
    const tangentialVelocity = subtract(relativeVelocity, scale(normal, normalSpeed));
    const reflectedNormal = scale(normal, -normalSpeed * PHYSICS.ballPlayerRestitution);
    const reflectedRelative = add(scale(tangentialVelocity, 0.86), reflectedNormal);
    state.ball.velocity = add(nearest.velocity, reflectedRelative);
  } else {
    state.ball.velocity = add(scale(state.ball.velocity, 0.82), scale(nearest.velocity, 0.18));
  }
  state.ball.lastTouch = nearest.team;
  state.ball.lastTouchPlayerId = nearest.profile.id;
  if (state.pendingPass) {
    emitCognitiveEvent(state, "ballTrajectoryChanged", relevantPlayersNear(state, state.ball.position), { passId: state.pendingPass.id });
  }
};
