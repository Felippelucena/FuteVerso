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
import { signedMatchNoise } from "../runtime/random";
import { emitCognitiveEvent, relevantPlayersNear } from "../runtime/cognitive-events";
import { executeBallAction } from "./ball-system";
import { resolveContact } from "./contact-resolution";

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
  const outcome = controller.team !== pending.team ? "intercepted"
    : controller.profile.id === pending.receiverId ? "received" : "otherTeammate";
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
  emitCognitiveEvent(state, "passResolved", [controller.profile.id, pending.receiverId, ...relevantPlayersNear(state, controller.position)], {
    passId: pending.id,
    controllerId: controller.profile.id,
    outcome,
  });
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
      ? state.pendingPass.range === "long" ? 0.24 : 0.19
      : state.pendingPass.range === "long" ? 0.17 : 0.12
    : 0;
  const dribbleBonus = continuesOwnDribble ? 0.18 : 0;
  const receptionBonus = preparedReceiver
    ? facingAlignment * 0.03 + player.profile.mental.anticipation / 100 * 0.03
    : 0;
  const margin = quality * 0.72 + player.stamina * 0.1 + dribbleBonus + receptionBonus + signedMatchNoise(state) * 0.16
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

const tryPreparedContact = (state: MatchState, player: PlayerRuntime): boolean => {
  const pending = state.pendingPass;
  const prepared = player.plan?.preparedReceptionAction;
  if (!pending || !prepared || prepared.kind === "control") return false;
  if (prepared.passId !== (pending.id ?? 0)) return false;
  if (state.elapsed < prepared.validFrom - 0.08 || state.elapsed > prepared.expiresAt) return false;
  const height = state.ball.height;
  const heightValid = prepared.technique === "header" ? height >= 0.9 && height <= 2.4
    : prepared.technique === "volley" ? height >= 0.2 && height <= 1.85
      : prepared.technique === "redirect" ? height <= 2
        : height <= 0.75;
  if (!heightValid || Math.abs(length(state.ball.velocity) - prepared.expectedSpeed) > 32) return false;
  const techniqueBase = prepared.kind === "pass"
    ? (player.profile.skills.passing * 0.5 + player.profile.skills.control * 0.3
      + player.profile.mental.anticipation * 0.1 + player.profile.mental.composure * 0.1) / 100
    : (player.profile.skills.finishing * 0.55 + player.profile.skills.control * 0.25
      + player.profile.mental.anticipation * 0.1 + player.profile.mental.composure * 0.1) / 100;
  const contactDifficulty = (prepared.technique === "header" ? 0.04 : prepared.technique === "volley" ? 0.07 : 0)
    + pressureAt(state, player) * 0.08 + Math.max(0, length(state.ball.velocity) - 48) * 0.002;
  const ready = techniqueBase - contactDifficulty + signedMatchNoise(state) * 0.12
    >= (prepared.kind === "pass" ? 0.82 : 0.75);
  if (!ready) {
    player.plan!.preparedReceptionAction = { ...prepared, kind: "control" };
    return false;
  }
  const passId = pending.id;
  registerPassOutcome(state, player);
  if (prepared.kind === "pass" && prepared.receiverId) {
    const passDistance = distance(player.position, prepared.target);
    executeBallAction(state, player, {
      kind: "pass",
      receiverId: prepared.receiverId,
      target: prepared.target,
      trajectory: "ground",
      range: passDistance > FIELD.width * 0.24 ? "long" : "short",
      targeting: "feet",
      purpose: "layoff",
      power: clamp(0.48 + passDistance / FIELD.width * 0.5, 0.48, 0.9),
      selectionReason: "firstTimeAction",
    });
  } else {
    executeBallAction(state, player, {
      kind: "shot",
      target: prepared.target,
      power: prepared.technique === "header" ? 0.7 : prepared.technique === "volley" ? 0.84 : 0.76,
      technique: prepared.technique ?? "redirect",
      preparedPassId: passId,
    });
  }
  player.intent = "firstTime";
  player.decisionReason = "firstTimeAction";
  return true;
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
    // Goleiro com a bola nas mãos é intocável: ninguém desarma uma posse segura na área.
    const keeperHolding = current.profile.position === "goalkeeper" && current.goalkeeperHoldUntil > state.elapsed;
    if (challenger && !keeperHolding) {
      state.stats[challenger.team].tacklesAttempted += 1;
      // Item 2: o desfecho do contato é selecionado por resolveContact (cardápio autoral com
      // física de momento). Retorna false quando a bola sai do controle do portador.
      if (!resolveContact(state, current, challenger)) {
        state.contestedSeconds += dt;
        return;
      }
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
      && !(player.profile.position === "goalkeeper"
        && state.activeShot !== null
        && state.activeShot.team !== player.team)
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
  if (!continuesOwnDribble && tryPreparedContact(state, controller)) return;
  const touchOutcome = firstTouchOutcome(state, controller, claim.quality, claim.ownBox, continuesOwnDribble);
  if (touchOutcome !== "clean") {
    controller.controlCooldown = touchOutcome === "heavy" ? PHYSICS.heavyTouchCooldown : PHYSICS.controlAttemptCooldown;
    if (touchOutcome === "heavy") applyHeavyTouch(state, controller, claim.quality);
    if (state.pendingPass) {
      emitCognitiveEvent(state, "ballTrajectoryChanged", [controller.profile.id, state.pendingPass.receiverId, ...relevantPlayersNear(state, state.ball.position)], {
        passId: state.pendingPass.id,
      });
    }
    if (!dribbleOwner && !inFlightPassTeam) state.contestedSeconds += dt;
    return;
  }
  const shotTeam = state.ball.lastAction === "shot" ? state.ball.lastTouch : null;
  if (shotTeam && state.ball.lastShotOnTarget) {
    state.stats[shotTeam].shotsOnTarget = Math.max(0, state.stats[shotTeam].shotsOnTarget - 1);
  }
  if (state.ball.lastTouch && state.ball.lastTouch !== controller.team) controller.memory.stats.interceptions += 1;
  state.ball.controllerId = controller.profile.id;
  state.activeShot = null;
  if (!continuesOwnDribble) state.ball.controlStartedAt = state.elapsed;
  clearDribbleOwner(state);
  state.ball.lastTouch = controller.team;
  state.ball.lastTouchPlayerId = controller.profile.id;
  registerControlledTeam(state, controller.team);
  emitCognitiveEvent(state, "controlClaimed", [controller.profile.id, ...relevantPlayersNear(state, controller.position)], {
    passId: state.pendingPass?.id,
    controllerId: controller.profile.id,
  });
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
    : state.pendingPass.range === "long" ? 0.48 : 0.75;
  if (state.elapsed <= state.pendingPass.expectedArrivalAt + controlWindow) return;
  const passer = state.players.find((player) => player.profile.id === state.pendingPass?.passerId);
  emitCognitiveEvent(state, "passResolved", relevantPlayersNear(state, state.ball.position), {
    passId: state.pendingPass.id,
    outcome: "loose",
  });
  if (passer) passer.memory.stats.failedPasses += 1;
  state.pendingPass = null;
};
