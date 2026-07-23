import { DUEL, FIELD } from "../config";
import { add, clamp, dot, length, normalize, rotate, scale, subtract } from "../../shared/math";
import type { MatchState, PlayerRuntime, Vec2 } from "../model";
import { clearDribbleOwner, registerControlledTeam, registerLooseBall } from "../runtime/control";
import { predictedSpaceAt } from "../runtime/prediction";
import { signedMatchNoise } from "../runtime/random";

// Cardápio de desfechos de contato quando um desafiante alcança o portador. Substitui o antigo
// desfecho binário (roubo por "cutucada" aleatória × repelir). Cada desfecho tem assinatura física
// própria e, quando o defensor vence de forma neutra, cai em `pokeLoose` — idêntico ao histórico.
//
// Determinismo: a margem do duelo saca `signedMatchNoise` 1× no topo (como antes); o sorteio de
// lado do `pokeLoose` só ocorre nesse ramo (como antes). Os desfechos novos (cleanStealThrough,
// knockPastLob) escolhem geometria sem sorteios extras, então só divergem onde o comportamento muda.

// Defensor ganha e SEGUE com a bola na direção do seu pique, freando; o atacante é cuspido no
// sentido contrário do toque. Flipa a posse (vira dribbleOwner do desafiante). Sem falta.
const cleanStealThrough = (state: MatchState, current: PlayerRuntime, challenger: PlayerRuntime, approach: Vec2): void => {
  const speed = length(challenger.velocity);
  const runDir = speed > 0.5 ? normalize(challenger.velocity) : approach;
  const carrySpeed = clamp(speed * DUEL.cleanStealCarryFactor, DUEL.cleanStealMinCarry, DUEL.cleanStealMaxCarry);
  state.ball.position = add(challenger.position, scale(runDir, challenger.radius + state.ball.radius + 0.3));
  state.ball.velocity = scale(runDir, carrySpeed);
  state.ball.verticalVelocity = 0;
  state.ball.height = 0;
  state.ball.controllerId = null;
  state.ball.lastTouch = challenger.team;
  state.ball.lastTouchPlayerId = challenger.profile.id;
  state.ball.lastAction = "dribble";
  state.ball.lastShotOnTarget = false;
  state.ball.dribbleOwnerId = challenger.profile.id;
  state.ball.dribbleTarget = { ...state.ball.position };
  state.ball.dribbleStyle = "knockOn";
  state.ball.dribbleTouchRange = "short";
  state.ball.dribbleStartedAt = state.elapsed;
  state.ball.controlStartedAt = state.elapsed;
  if (challenger.sprintEnergy > 0.1) challenger.sprintTimer = Math.max(challenger.sprintTimer, 0.5);
  registerControlledTeam(state, challenger.team);
  current.velocity = add(scale(current.velocity, 0.35), scale(runDir, -DUEL.cleanStealSpitBack));
  current.reactionTimer = Math.max(current.reactionTimer, 0.3);
  current.kickCooldown = Math.max(current.kickCooldown, 0.4);
};

// Desfecho neutro do defensor: a bola escapa numa direção lateral. Idêntico ao histórico.
const pokeLoose = (state: MatchState, current: PlayerRuntime, challenger: PlayerRuntime, side: number): void => {
  const approach = normalize(subtract(current.position, challenger.position));
  const pokeDirection = normalize(add(scale(approach, 0.62), { x: -approach.y * side * 0.78, y: approach.x * side * 0.78 }));
  state.ball.position = add(current.position, scale(pokeDirection, current.radius + state.ball.radius + 0.35));
  state.ball.velocity = scale(pokeDirection, 9 + challenger.profile.skills.defending * 0.055);
  state.ball.controllerId = null;
  state.ball.lastTouch = challenger.team;
  state.ball.lastTouchPlayerId = challenger.profile.id;
  state.ball.lastAction = null;
  state.ball.lastShotOnTarget = false;
  clearDribbleOwner(state);
  state.ball.controlStartedAt = 0;
  registerLooseBall(state);
  current.reactionTimer = Math.max(current.reactionTimer, 0.24);
  current.kickCooldown = Math.max(current.kickCooldown, 0.38);
  current.velocity = scale(current.velocity, 0.45);
};

// O atacante venceu o contato: só vale o balão se há espaço atrás do defensor e progresso ao gol.
const knockPastEligible = (state: MatchState, current: PlayerRuntime, challenger: PlayerRuntime): boolean => {
  if (current.sprintEnergy <= 0.35 || current.dribbleTouchCooldown > 0) return false;
  const goalward = { x: current.team === "blue" ? 1 : -1, y: 0 };
  if ((challenger.position.x - current.position.x) * goalward.x <= 0) return false; // defensor precisa estar à frente
  const behind = add(challenger.position, scale(goalward, DUEL.knockPastProbe * FIELD.width));
  const others = state.players.filter((player) => player.team !== current.team && player.profile.id !== challenger.profile.id);
  const space = others.length ? predictedSpaceAt(behind, others, 0.4) : FIELD.width;
  return space >= DUEL.knockPastMinSpace * FIELD.width;
};

// Toque leve por cima da dividida, ~30° para o lado que se afasta do defensor, balão baixo (<1.8),
// e o atacante dispara atrás. Mantém a posse (vira o próprio dribbleOwner).
const knockPastLob = (state: MatchState, current: PlayerRuntime, challenger: PlayerRuntime): void => {
  const goalward = { x: current.team === "blue" ? 1 : -1, y: 0 };
  const toDefender = normalize(subtract(challenger.position, current.position));
  const leftRot = rotate(goalward, Math.PI / 6);
  const rightRot = rotate(goalward, -Math.PI / 6);
  const dir = dot(leftRot, toDefender) < dot(rightRot, toDefender) ? leftRot : rightRot;
  state.ball.position = add(current.position, scale(dir, current.radius + state.ball.radius + 0.3));
  state.ball.velocity = scale(dir, DUEL.knockPastSpeed);
  state.ball.verticalVelocity = DUEL.knockPastLift; // apex ≈ 0,85 < 1,8 → segue jogável
  state.ball.height = 0;
  state.ball.controllerId = null;
  state.ball.lastTouch = current.team;
  state.ball.lastTouchPlayerId = current.profile.id;
  state.ball.lastAction = "dribble";
  state.ball.lastShotOnTarget = false;
  state.ball.dribbleOwnerId = current.profile.id;
  state.ball.dribbleTarget = { ...state.ball.position };
  state.ball.dribbleStyle = "knockOn";
  state.ball.dribbleTouchRange = "short";
  state.ball.dribbleStartedAt = state.elapsed;
  state.ball.controlStartedAt = state.elapsed;
  if (current.sprintEnergy > 0.1) current.sprintTimer = Math.max(current.sprintTimer, 0.6);
  current.dribbleTouchCooldown = Math.max(current.dribbleTouchCooldown, 0.3);
  registerControlledTeam(state, current.team);
  challenger.velocity = add(scale(challenger.velocity, 0.85), scale(toDefender, 1.5));
};

// Ambos ficam de pé e se separam. Idêntico ao histórico (desfecho de defensor batido).
const repel = (current: PlayerRuntime, challenger: PlayerRuntime): void => {
  const rawSeparation = subtract(challenger.position, current.position);
  const separationDirection = length(rawSeparation) > 0.01
    ? normalize(rawSeparation)
    : { x: -current.facing.y, y: current.facing.x };
  challenger.reactionTimer = Math.max(challenger.reactionTimer, 0.92);
  challenger.velocity = add(challenger.velocity, scale(separationDirection, 9));
  current.velocity = add(current.velocity, scale(separationDirection, -6));
  const minimumGap = current.radius + challenger.radius + 1.45;
  const separation = Math.max(0.72, (minimumGap - length(rawSeparation)) / 2 + 0.08);
  challenger.position = add(challenger.position, scale(separationDirection, separation));
  current.position = subtract(current.position, scale(separationDirection, separation));
};

/**
 * Resolve o contato entre o portador (`current`) e o desafiante mais próximo (`challenger`).
 * Retorna `true` se o portador MANTÉM o controle (desfecho `repel`); `false` se a bola saiu do
 * seu controle (roubo/cutucada do defensor, ou o atacante balãozou por cima e virou dribbleOwner).
 */
export const resolveContact = (state: MatchState, current: PlayerRuntime, challenger: PlayerRuntime): boolean => {
  const holderScore = (current.profile.skills.control * 0.64 + current.profile.skills.burst * 0.2) / 100
    + current.stamina * 0.16 + current.profile.mental.composure / 1000;
  const defenderScore = (
    challenger.profile.skills.defending * 0.56
    + challenger.profile.skills.acceleration * 0.22
    + challenger.profile.skills.control * 0.12
  ) / 100 + challenger.stamina * 0.1 + challenger.profile.mental.aggression / 1000;
  const margin = defenderScore - holderScore + signedMatchNoise(state) * 0.34; // draw 1 (como antes)
  const defenderWins = margin > 0.04;
  current.duelCooldown = defenderWins ? 0.72 : 0.55;
  challenger.duelCooldown = defenderWins ? 0.85 : 0.62;

  if (defenderWins) {
    const approach = normalize(subtract(current.position, challenger.position));
    const closing = dot(challenger.velocity, approach);
    if (closing > DUEL.cleanStealMinClosing && margin > DUEL.cleanStealMarginGate) {
      cleanStealThrough(state, current, challenger, approach);
    } else {
      const side = signedMatchNoise(state) >= 0 ? 1 : -1; // draw 2 — só no poke (como antes)
      pokeLoose(state, current, challenger, side);
    }
    state.stats[challenger.team].tacklesWon += 1;
    return false;
  }
  if (knockPastEligible(state, current, challenger)) {
    knockPastLob(state, current, challenger);
    return false;
  }
  repel(current, challenger);
  return true;
};
