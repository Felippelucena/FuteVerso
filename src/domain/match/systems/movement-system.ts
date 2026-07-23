import { FIELD, GOALKEEPING, PHYSICS, STAMINA } from "../config";
import { add, clamp, distance, length, limit, normalize, scale, subtract } from "../../shared/math";
import type { AgentDecision, MatchState, MovementPace, PlayerRuntime } from "../model";
import { playerSkillAcceleration, playerSkillSpeed } from "../runtime/player-metrics";
import { goalkeeperAirborne } from "./goalkeeper-system";

// Queda sutil de velocidade de topo conforme a estamina longa (fôlego) baixa: ~5% a 50%.
export const fatigueSpeedFactor = (player: PlayerRuntime): number =>
  1 - (1 - player.stamina) * STAMINA.fatigueSpeedSlope;

export const playerSpeedLimit = (player: PlayerRuntime, controlsBall: boolean, running = false): number => {
  // Com a bola colada é sempre close control (lento): avançar em velocidade exige soltar a
  // bola à frente (knock-on), quando o portador vira dribbleOwner e deixa de "controlar".
  const factor = controlsBall
    ? PHYSICS.controlledSpeedFactor
    : player.sprintTimer > 0 ? PHYSICS.burstSpeedFactor : running ? PHYSICS.runSpeedFactor : PHYSICS.walkSpeedFactor;
  return playerSkillSpeed(player) * factor * fatigueSpeedFactor(player);
};

export const applyStamina = (player: PlayerRuntime, pace: MovementPace, dt: number): void => {
  const travelled = length(player.velocity) * dt;
  const staminaSkill = player.profile.skills.stamina / 100;
  const fatigue = 1 - player.stamina;

  // --- Estamina longa: só decai, ponderada por regime e distância percorrida. ---
  const longUnitCost = pace === "burst" ? STAMINA.longBurstCostPerUnit
    : pace === "run" ? STAMINA.longRunCostPerUnit
      : pace === "walk" || pace === "closeControl" ? STAMINA.longWalkCostPerUnit
        : 0;
  const longSkillScale = 1.3 - staminaSkill * 0.6;                 // skill 100 → 0,7×; skill 0 → 1,3×
  const intensityScale = 0.9 + player.profile.mental.intensity / 500;
  const longDrain = (longUnitCost * travelled + STAMINA.longIdleCostPerSecond * dt)
    * longSkillScale * intensityScale * STAMINA.longDrainScale;
  player.stamina = clamp(player.stamina - longDrain, STAMINA.longFloor, 1);

  // --- Estamina volátil: só o pique drena; fora dele recupera rápido. ---
  // Longa baixa encarece o pique e atrasa a recarga (penalidade modesta).
  const costMultiplier = 1 + fatigue * STAMINA.fatigueVolatileCostSlope;
  const recoveryMultiplier = Math.max(0, 1 - fatigue * STAMINA.fatigueVolatileRecoverySlope)
    * (0.85 + staminaSkill * 0.3);
  const volatileCost = pace === "burst" ? STAMINA.volatileBurstCostPerUnit * travelled * costMultiplier
    : pace === "run" ? STAMINA.volatileRunCostPerUnit * travelled * costMultiplier
      : 0;
  const volatileRecovery = pace === "burst" ? 0 : STAMINA.volatileRecoveryPerSecond * recoveryMultiplier * dt;
  player.sprintEnergy = clamp(player.sprintEnergy - volatileCost + volatileRecovery, 0, 1);
};

const updatePlayer = (state: MatchState, player: PlayerRuntime, decision: AgentDecision, controlsBall: boolean, dt: number): void => {
  player.posture = decision.posture;
  player.intent = decision.intent;
  player.decisionReason = decision.reason;
  player.kickCooldown = Math.max(0, player.kickCooldown - dt);
  player.sprintCooldown = Math.max(0, player.sprintCooldown - dt);
  player.dribbleTouchCooldown = Math.max(0, player.dribbleTouchCooldown - dt);
  player.sprintTimer = Math.max(0, player.sprintTimer - dt);
  player.reactionTimer = Math.max(0, player.reactionTimer - dt);
  player.duelCooldown = Math.max(0, player.duelCooldown - dt);
  player.controlCooldown = Math.max(0, player.controlCooldown - dt);
  if (decision.burst && player.sprintCooldown <= 0 && player.sprintEnergy > 0.12) {
    player.sprintTimer = decision.burstDuration ?? PHYSICS.burstDuration;
    player.sprintCooldown = PHYSICS.burstCooldown;
  }
  const baseSpeed = playerSkillSpeed(player);
  // A launched keeper is a projectile: the direction was frozen at launch and no amount of
  // steering can bend it. Integrate velocity under drag and let him land where he lands.
  if (goalkeeperAirborne(player.goalkeeperAttempt, state.elapsed)) {
    player.pace = "burst";
    player.velocity = scale(player.velocity, Math.exp(-GOALKEEPING.diveDrag * dt));
    player.position = add(player.position, scale(player.velocity, dt));
    if (length(player.velocity) > 0.3) player.facing = normalize(player.velocity);
    applyStamina(player, "burst", dt);
    player.position.x = clamp(player.position.x, player.radius, FIELD.width - player.radius);
    player.position.y = clamp(player.position.y, player.radius, FIELD.height - player.radius);
    return;
  }
  const movementGap = distance(decision.movementTarget, player.position);
  const goalkeeperSetting = decision.intent === "preparingSave" && player.profile.position === "goalkeeper";
  // Depois de rebater, o goleiro fica em alerta e se reposiciona em velocidade (não na
  // corridinha de ajuste), para caçar a sobra e voltar ao gol rápido.
  const goalkeeperAlert = !controlsBall && !goalkeeperSetting
    && player.profile.position === "goalkeeper" && player.goalkeeperAlertUntil > state.elapsed;
  const running = !controlsBall && (
    movementGap > FIELD.width * 0.095
    || decision.intent === "pressing"
    || decision.intent === "receiving"
    || decision.intent === "sprinting"
    || decision.intent === "knockingOn"
    || decision.intent === "feinting"
  );
  const speedFactor = controlsBall
    ? PHYSICS.controlledSpeedFactor
    : goalkeeperSetting ? GOALKEEPING.approachSpeedFactor
      : goalkeeperAlert ? GOALKEEPING.alertSpeedFactor
        : player.sprintTimer > 0 ? PHYSICS.burstSpeedFactor : running ? PHYSICS.runSpeedFactor : PHYSICS.walkSpeedFactor;
  // Com a bola colada é sempre close control (lento): um pique residual não acelera nem
  // conta como disparada; avançar em velocidade exige soltar a bola (knock-on).
  player.pace = controlsBall ? "closeControl" : player.sprintTimer > 0 || goalkeeperAlert ? "burst" : running || goalkeeperSetting ? "run" : "walk";
  const maximumSpeed = baseSpeed * speedFactor * fatigueSpeedFactor(player);
  const desired = scale(normalize(subtract(decision.movementTarget, player.position)), maximumSpeed);
  const steering = subtract(desired, player.velocity);
  const reactionFactor = player.reactionTimer > 0 ? 0.38 : 1;
  const burstAcceleration = player.sprintTimer > 0 ? PHYSICS.burstAccelerationFactor : 1;
  // Explosividade vem da barra volátil: sem pique na perna, a arrancada é mais fraca.
  const acceleration = scale(normalize(steering), playerSkillAcceleration(player) * (0.72 + player.sprintEnergy * 0.28) * reactionFactor * burstAcceleration);
  player.velocity = add(player.velocity, scale(acceleration, dt));
  player.velocity = scale(player.velocity, Math.exp(-PHYSICS.playerDrag * dt));
  player.velocity = limit(player.velocity, maximumSpeed * (player.reactionTimer > 0 ? 0.7 : 1));
  player.position = add(player.position, scale(player.velocity, dt));
  const speed = length(player.velocity);
  if (speed > 0.3 && (!controlsBall || decision.ballAction.kind === "dribble")) player.facing = normalize(player.velocity);
  applyStamina(player, player.pace, dt);
  player.position.x = clamp(player.position.x, player.radius, FIELD.width - player.radius);
  player.position.y = clamp(player.position.y, player.radius, FIELD.height - player.radius);
};

export const updatePlayers = (state: MatchState, decisions: Map<string, AgentDecision>, dt: number): void => {
  for (const player of state.players) {
    const decision = decisions.get(player.profile.id)!;
    updatePlayer(state, player, decision, state.ball.controllerId === player.profile.id, dt);
    state.stats[player.team].distanceCovered += length(player.velocity) * dt;
  }
};

export const clampPlayersToField = (state: MatchState): void => {
  for (const player of state.players) {
    player.position.x = clamp(player.position.x, player.radius, FIELD.width - player.radius);
    player.position.y = clamp(player.position.y, player.radius, FIELD.height - player.radius);
  }
};
