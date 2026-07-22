import { FIELD, PHYSICS } from "../config";
import { add, clamp, distance, dot, length, normalize, scale, subtract } from "../../shared/math";
import type { MatchState, PlayerRuntime } from "../model";
import {
  adaptPlayerPolicy,
  clearDribbleOwner,
  isEvadedDefender,
  pressureAt,
  registerControlledTeam,
  registerLooseBall,
} from "../runtime/control";
import { emitMatchEvent } from "../runtime/events";
import { signedMatchNoise } from "../runtime/random";

const ballClaimQuality = (state: MatchState, player: PlayerRuntime, ownBox: boolean): number => {
  const skills = player.profile.skills;
  const value = ownBox && player.profile.position === "goalkeeper"
    ? skills.goalkeeping * 0.72 + skills.defending * 0.18 + skills.control * 0.1
    : state.pendingPass?.team === player.team
      ? skills.control * 0.62 + skills.acceleration * 0.15 + skills.vision * 0.13 + skills.defending * 0.1
      : state.pendingPass
        ? skills.defending * 0.48 + skills.control * 0.28 + skills.acceleration * 0.24
        : skills.control * 0.44 + skills.defending * 0.32 + skills.acceleration * 0.24;
  const mentalBonus = player.profile.mental.anticipation * 0.06 + player.profile.mental.composure * 0.03;
  return clamp((value + mentalBonus) / 100, 0.05, 1);
};

const registerPassOutcome = (state: MatchState, controller: PlayerRuntime): void => {
  const pending = state.pendingPass;
  if (!pending) return;
  const passer = state.players.find((player) => player.profile.id === pending.passerId);
  if (!passer) return;
  if (controller.team === pending.team && controller.profile.id !== passer.profile.id) {
    passer.memory.stats.completedPasses += 1;
    state.stats[pending.team].completedPasses += 1;
    if (pending.range === "long") state.stats[pending.team].completedLongPasses += 1;
    if (pending.trajectory === "air") state.stats[pending.team].completedAerialPasses += 1;
    const networkKey = `${passer.profile.id}>${controller.profile.id}`;
    state.passNetwork[pending.team][networkKey] = (state.passNetwork[pending.team][networkKey] ?? 0) + 1;
    adaptPlayerPolicy(passer, "pass", state.learningEnabled ? 0.002 : 0);
    state.lastAssist = { playerId: passer.profile.id, team: passer.team, time: state.elapsed };
  } else {
    passer.memory.stats.failedPasses += 1;
    if (controller.team !== pending.team) controller.memory.stats.interceptions += 1;
    adaptPlayerPolicy(passer, "pass", state.learningEnabled ? -0.0015 : 0);
    if (controller.team !== pending.team) adaptPlayerPolicy(controller, "press", state.learningEnabled ? 0.0015 : 0);
  }
  state.pendingPass = null;
};

const firstTouchOutcome = (
  state: MatchState,
  player: PlayerRuntime,
  quality: number,
  ownBox: boolean,
  continuesOwnDribble: boolean,
): "clean" | "heavy" | "miss" => {
  const relativeSpeed = length(subtract(state.ball.velocity, player.velocity));
  const toBall = normalize(subtract(state.ball.position, player.position));
  const facingAlignment = clamp((dot(player.facing, toBall) + 1) / 2, 0, 1);
  const preparedReceiver = state.pendingPass?.receiverId === player.profile.id
    && Math.abs(state.elapsed - state.pendingPass.expectedArrivalAt) < 0.8;
  const speedDifficulty = clamp(relativeSpeed / (ownBox ? 68 : 52), 0, 1) * (ownBox ? 0.5 : 0.64)
    * (preparedReceiver ? 0.9 : 1);
  const heightDifficulty = clamp(state.ball.height / 2.4, 0, 1) * 0.18;
  const positioningDifficulty = (1 - facingAlignment) * 0.16;
  const pressureDifficulty = pressureAt(state, player) * 0.1 * (1.22 - player.profile.mental.composure / 180);
  const passControlDifficulty = state.pendingPass?.team === player.team
    ? state.pendingPass.trajectory === "air"
      ? state.pendingPass.range === "long" ? 0.24 : 0.16
      : state.pendingPass.range === "long" ? 0.17 : 0.035
    : 0;
  const dribbleBonus = continuesOwnDribble ? 0.18 : 0;
  const receptionBonus = preparedReceiver
    ? facingAlignment * 0.03 + player.profile.mental.anticipation / 100 * 0.03
    : 0;
  const margin = quality * 0.72 + player.energy * 0.1 + dribbleBonus + receptionBonus + signedMatchNoise(state) * 0.16
    - speedDifficulty - heightDifficulty - positioningDifficulty - pressureDifficulty - passControlDifficulty;
  if (margin > (ownBox ? 0.08 : 0.16)) return "clean";
  if (margin > -0.13) return "heavy";
  return "miss";
};

const applyHeavyTouch = (state: MatchState, player: PlayerRuntime, quality: number): void => {
  const ballSpeed = length(state.ball.velocity);
  const incoming = ballSpeed > 0.5 ? normalize(state.ball.velocity) : player.facing;
  const touchDirection = normalize(add(scale(incoming, 0.72), scale(player.facing, 0.28)));
  const touchSpeed = Math.max(5, ballSpeed * (0.3 + quality * 0.18));
  state.ball.velocity = add(scale(touchDirection, touchSpeed), scale(player.velocity, 0.22));
  state.ball.lastTouch = player.team;
  state.ball.lastTouchPlayerId = player.profile.id;
  state.ball.controllerId = null;
  state.ball.controlStartedAt = 0;
  clearDribbleOwner(state);
  registerLooseBall(state);
};

export const updatePossession = (state: MatchState, dt: number): void => {
  const current = state.players.find((player) => player.profile.id === state.ball.controllerId);
  if (current && state.ball.height < 1.8 && distance(current.position, state.ball.position) < PHYSICS.kickDistance + 0.7) {
    const challenger = [...state.players]
      .filter((player) => player.team !== current.team
        && player.reactionTimer <= 0
        && !isEvadedDefender(state, player)
        && distance(player.position, current.position) < current.radius + player.radius + 0.75)
      .sort((a, b) => distance(a.position, current.position) - distance(b.position, current.position))[0];
    if (challenger) {
      state.stats[challenger.team].tacklesAttempted += 1;
      const holderScore = (current.profile.skills.control * 0.64 + current.profile.skills.burst * 0.2) / 100
        + current.energy * 0.16 + current.profile.mental.composure / 1000;
      const defenderScore = (
        challenger.profile.skills.defending * 0.56
        + challenger.profile.skills.acceleration * 0.22
        + challenger.profile.skills.control * 0.12
      ) / 100 + challenger.energy * 0.1 + challenger.profile.mental.aggression / 1000;
      const defenderWins = defenderScore - holderScore + signedMatchNoise(state) * 0.34 > 0.04;
      current.duelCooldown = defenderWins ? 0.72 : 0.55;
      challenger.duelCooldown = defenderWins ? 0.85 : 0.62;
      if (defenderWins) {
        const approach = normalize(subtract(current.position, challenger.position));
        const side = signedMatchNoise(state) >= 0 ? 1 : -1;
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
        state.stats[challenger.team].tacklesWon += 1;
        state.contestedSeconds += dt;
        return;
      }
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
    }
    registerControlledTeam(state, current.team);
    state.stats[current.team].possessionSeconds += dt;
    return;
  }
  state.ball.controllerId = null;
  let dribbleOwner = state.players.find((player) => player.profile.id === state.ball.dribbleOwnerId) ?? null;
  if (dribbleOwner && state.elapsed - state.ball.dribbleStartedAt > 2.4) {
    clearDribbleOwner(state);
    dribbleOwner = null;
  }
  const inFlightPassTeam = state.pendingPass?.team ?? null;
  if (dribbleOwner) {
    registerControlledTeam(state, dribbleOwner.team);
    state.stats[dribbleOwner.team].possessionSeconds += dt;
  } else if (inFlightPassTeam) {
    registerControlledTeam(state, inFlightPassTeam);
    state.stats[inFlightPassTeam].possessionSeconds += dt;
  } else {
    registerLooseBall(state);
  }
  if (state.ball.height > 2.4) {
    if (!dribbleOwner && !inFlightPassTeam) state.contestedSeconds += dt;
    return;
  }
  const candidates = state.players
    .map((player) => {
      const ownBox = player.profile.position === "goalkeeper"
        && (player.team === "blue" ? player.position.x < FIELD.penaltyDepth : player.position.x > FIELD.width - FIELD.penaltyDepth);
      const quality = ballClaimQuality(state, player, ownBox);
      const range = PHYSICS.kickDistance - 0.45 + quality * 0.85 + (ownBox ? 0.95 + quality * 0.85 : 0);
      const gap = distance(player.position, state.ball.position);
      const relativeSpeed = length(subtract(state.ball.velocity, player.velocity));
      const fastBallPenalty = relativeSpeed > 18 ? (1 - quality) * relativeSpeed * 0.018 : 0;
      const ownDribbleBonus = dribbleOwner?.profile.id === player.profile.id ? 0.72 : 0;
      const intendedReceiverBonus = state.pendingPass?.receiverId === player.profile.id ? 0.42 : 0;
      return { player, quality, ownBox, range, gap, score: gap - quality * 0.92 - (ownBox ? 0.36 : 0)
        + fastBallPenalty - ownDribbleBonus - intendedReceiverBonus };
    })
    .filter(({ player, range, gap }) => gap < range
      && player.kickCooldown < 0.12
      && player.controlCooldown <= 0
      && player.reactionTimer <= 0
      && !isEvadedDefender(state, player))
    .sort((a, b) => a.score - b.score || a.gap - b.gap || a.player.profile.id.localeCompare(b.player.profile.id));
  const claim = candidates[0];
  if (!claim) {
    if (!dribbleOwner && !inFlightPassTeam) state.contestedSeconds += dt;
    return;
  }
  const controller = claim.player;
  const continuesOwnDribble = dribbleOwner?.profile.id === controller.profile.id;
  const touchOutcome = firstTouchOutcome(state, controller, claim.quality, claim.ownBox, continuesOwnDribble);
  if (touchOutcome !== "clean") {
    controller.controlCooldown = touchOutcome === "heavy" ? PHYSICS.heavyTouchCooldown : PHYSICS.controlAttemptCooldown;
    if (touchOutcome === "heavy") applyHeavyTouch(state, controller, claim.quality);
    if (!dribbleOwner && !inFlightPassTeam) state.contestedSeconds += dt;
    return;
  }
  const shotTeam = state.ball.lastAction === "shot" ? state.ball.lastTouch : null;
  const savedShot = controller.profile.position === "goalkeeper"
    && state.ball.lastAction === "shot"
    && state.ball.lastTouch !== null
    && state.ball.lastTouch !== controller.team
    && (controller.team === "blue" ? controller.position.x < FIELD.penaltyDepth : controller.position.x > FIELD.width - FIELD.penaltyDepth);
  if (savedShot) {
    state.stats[controller.team].saves += 1;
    emitMatchEvent(state, { type: "save-made", team: controller.team, playerId: controller.profile.id });
  } else if (shotTeam && state.ball.lastShotOnTarget) {
    state.stats[shotTeam].shotsOnTarget = Math.max(0, state.stats[shotTeam].shotsOnTarget - 1);
  }
  if (state.ball.lastTouch && state.ball.lastTouch !== controller.team) controller.memory.stats.interceptions += 1;
  state.ball.controllerId = controller.profile.id;
  if (!continuesOwnDribble) state.ball.controlStartedAt = state.elapsed;
  clearDribbleOwner(state);
  state.ball.lastTouch = controller.team;
  state.ball.lastTouchPlayerId = controller.profile.id;
  registerControlledTeam(state, controller.team);
  if (state.feintEvasion && state.feintEvasion.attackerId !== controller.profile.id) state.feintEvasion = null;
  state.stats[controller.team].possessionSeconds += dt;
  registerPassOutcome(state, controller);
  state.ball.lastAction = null;
  state.ball.lastShotOnTarget = false;
};

export const expirePendingPass = (state: MatchState): void => {
  if (!state.pendingPass) return;
  const controlWindow = state.pendingPass.trajectory === "air"
    ? state.pendingPass.range === "long" ? 0.16 : 0.35
    : state.pendingPass.range === "long" ? 0.48 : 1.25;
  if (state.elapsed <= state.pendingPass.expectedArrivalAt + controlWindow) return;
  const passer = state.players.find((player) => player.profile.id === state.pendingPass?.passerId);
  if (passer) passer.memory.stats.failedPasses += 1;
  state.pendingPass = null;
};
