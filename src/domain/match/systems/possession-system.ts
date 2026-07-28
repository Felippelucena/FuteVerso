import { FIELD, OFFSIDE, PHYSICS, POSSESSION } from "../config";
import { add, clamp, distance, dot, length, normalize, scale, subtract } from "../../shared/math";
import type { MatchState, PlayerRuntime } from "../model";
import { emitMatchEvent } from "../runtime/events";
import {
  adaptPlayerPolicy,
  clearDribbleOwner,
  isEvadedDefender,
  pressureAt,
  registerControlledTeam,
  registerLooseBall,
} from "../runtime/control";
import { classifyReception, RECEPTION_NOISE, receptionMargin } from "../runtime/pass-viability";
import { contactHeightBand } from "../runtime/reception-planning";
import { signedMatchNoise } from "../runtime/random";
import { restartForbidsTouch } from "../runtime/restart";
import { resolveShot } from "../runtime/shot";
import { emitCognitiveEvent, relevantPlayersNear } from "../runtime/cognitive-events";
import { executeBallAction } from "./ball-system";

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

/**
 * O primeiro toque: a mesma conta de `runtime/pass-viability`, com a bola REAL que chegou e o
 * ruído do lance somado por cima. Quem decide o passe chama a mesma função com a bola prevista.
 */
const firstTouchOutcome = (
  state: MatchState,
  player: PlayerRuntime,
  quality: number,
  ownBox: boolean,
  continuesOwnDribble: boolean,
): "clean" | "heavy" | "miss" => {
  const toBall = normalize(subtract(state.ball.position, player.position));
  const prepared = state.pendingPass?.receiverId === player.profile.id
    && Math.abs(state.elapsed - state.pendingPass.expectedArrivalAt) < 0.8;
  const margin = receptionMargin({
    quality,
    stamina: player.stamina,
    composure: player.profile.mental.composure,
    anticipation: player.profile.mental.anticipation,
    relativeSpeed: length(subtract(state.ball.velocity, player.velocity)),
    ballHeight: state.ball.height,
    facingAlignment: clamp((dot(player.facing, toBall) + 1) / 2, 0, 1),
    pressure: pressureAt(state, player),
    ownBox,
    continuesOwnDribble,
    prepared,
    reachableHeight: PHYSICS.reachableBallHeight,
  });
  return classifyReception(margin + signedMatchNoise(state) * RECEPTION_NOISE, ownBox);
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
  const band = contactHeightBand(prepared.technique === "header" ? "header"
    : prepared.technique === "volley" ? "volley"
      : prepared.technique === "redirect" ? "redirect"
        : "placed");
  const heightValid = height >= band.low && height <= band.high;
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
  // Enquanto a bola estiver no alcance do portador ela é dele — inclusive sob disputa. Quem tira
  // a bola do pé é a pressão contínua aplicada na integração (`attachControlledBall`); aqui só se
  // constata o resultado. Não há mais desfecho de contato escrito à mão.
  const current = state.players.find((player) => player.profile.id === state.ball.controllerId);
  if (current && state.ball.height < 1.8 && distance(current.position, state.ball.position) < PHYSICS.kickDistance + 0.7) {
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
  // Posse é a ESTATÍSTICA, não a percepção: a bola adiantada num pique e o passe no ar contam
  // para quem os jogou, como nas estatísticas de futebol. Quem decide em campo não lê daqui —
  // lê `state.ballSituation`, que pergunta quem chega nela primeiro. Os dois divergem de
  // propósito, e é essa divergência que mantém o % de posse legível para quem assiste.
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
  if (state.ball.height > PHYSICS.reachableBallHeight) {
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
      // Regra 8: bola parada no ponto não se disputa (o cobrador a recebe por entrega); depois da
      // cobrança, é de qualquer um menos ele.
      && !restartForbidsTouch(state, player.profile.id)
      && !isEvadedDefender(state, player))
    .sort((a, b) => a.score - b.score || a.gap - b.gap || a.player.profile.id.localeCompare(b.player.profile.id));
  const claim = candidates[0];
  if (!claim) {
    if (!dribbleOwner && !inFlightPassTeam) state.contestedSeconds += dt;
    return;
  }
  const controller = claim.player;
  // Lei 11 — punição. Antes de qualquer domínio: se quem vai encostar na bola estava impedido no
  // instante do passe, apita aqui. Se for qualquer outro (companheiro em posição legal ou um
  // adversário), a jogada segue e a vigilância se dissolve.
  if (resolveOffsideOnTouch(state, controller)) return;
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
  if (state.ball.lastTouch && state.ball.lastTouch !== controller.team) controller.memory.stats.interceptions += 1;
  state.ball.controllerId = controller.profile.id;
  // Alguém que não o goleiro alcançou a bola antes da meta: o chute foi bloqueado.
  resolveShot(state, "blocked");
  // Bola nova no pé chega à frente do corpo; a proteção se constrói a partir daí. Sem zerar,
  // uma âncora velha faria a bola nascer atrás das costas de quem acabou de dominar.
  if (!continuesOwnDribble) {
    controller.ballAnchor = 0;
    state.ball.controlStartedAt = state.elapsed;
  }
  clearDribbleOwner(state);
  state.ball.lastTouch = controller.team;
  state.ball.lastTouchPlayerId = controller.profile.id;
  registerControlledTeam(state, controller.team);
  emitCognitiveEvent(state, "controlClaimed", [controller.profile.id, ...relevantPlayersNear(state, controller.position)], {
    passId: state.pendingPass?.id,
    controllerId: controller.profile.id,
  });
  // A finta acabou quando a bola trocou de dono: quem foi vendido por outro volta a existir.
  for (const player of state.players) {
    if (player.evadedByAttackerId && player.evadedByAttackerId !== controller.profile.id) {
      player.evadedUntil = 0;
      player.evadedByAttackerId = null;
    }
  }
  state.stats[controller.team].possessionSeconds += dt;
  registerPassOutcome(state, controller);
  state.ball.lastAction = null;
};

/**
 * Lei 11 aplicada no toque. Devolve `true` — interrompendo o domínio — quando o impedimento é
 * apitado; nesse caso congela a bola no ponto da infração e abre a janela da bandeira, que o
 * ciclo de vida conta antes de sair o tiro livre. Em qualquer outro toque, só dissolve a
 * vigilância e deixa a jogada seguir.
 */
const resolveOffsideOnTouch = (state: MatchState, toucher: PlayerRuntime): boolean => {
  const watch = state.offsideWatch;
  if (!watch) return false;
  if (toucher.team !== watch.team || !watch.offenders.includes(toucher.profile.id)) {
    // Bola alcançada por um jogador legal (ou pelo adversário): não houve infração.
    state.offsideWatch = null;
    return false;
  }
  state.offsideWatch = null;
  state.offsideCall = {
    team: watch.team,
    offenderId: toucher.profile.id,
    lineProgress: watch.lineProgress,
    spot: {
      x: clamp(toucher.position.x, 4, FIELD.width - 4),
      y: clamp(toucher.position.y, 4, FIELD.height - 4),
    },
    calledAt: state.elapsed,
    resolveAt: state.elapsed + OFFSIDE.freezeSeconds,
  };
  // Congela a jogada: bola parada no ponto, sem dono nem passe/chute pendente.
  state.ball.velocity = { x: 0, y: 0 };
  state.ball.verticalVelocity = 0;
  state.ball.height = 0;
  state.ball.controllerId = null;
  clearDribbleOwner(state);
  if (state.pendingPass) emitCognitiveEvent(state, "passResolved", null, { passId: state.pendingPass.id, outcome: "out" });
  state.pendingPass = null;
  resolveShot(state, "dead");
  emitMatchEvent(state, { type: "offside-called", team: watch.team, playerId: toucher.profile.id });
  return true;
};

export const expirePendingPass = (state: MatchState): void => {
  const pending = state.pendingPass;
  if (!pending) return;
  const passer = state.players.find((player) => player.profile.id === pending.passerId);
  const closePass = (): void => {
    emitCognitiveEvent(state, "passResolved", relevantPlayersNear(state, state.ball.position), {
      passId: pending.id,
      outcome: "loose",
    });
    if (passer) passer.memory.stats.failedPasses += 1;
    state.pendingPass = null;
  };
  // O passe só morre por tempo. Encerrá-lo assim que a bola sai da rota parece certo e não é: o
  // desvio que interessa ao jogador é o que muda quem chega primeiro, e disso quem cuida é
  // `runtime/ball-situation` — quem deixou de ser o favorito para de esperar a bola no mesmo
  // quadro. Matar o `pendingPass` junto só apagava o crédito do passe que ainda se completava.
  //
  // O prazo é o de sempre MAIS o tempo em que a bola esteve alta demais para alguém: esse pedaço
  // do voo não foi chance de domínio nenhuma, e cobrá-lo do recebedor era o que matava metade
  // dos lançamentos antes de qualquer um poder encostar neles.
  const flightSeconds = pending.expectedArrivalAt - pending.startedAt;
  const controlWindow = POSSESSION.passControlSeconds
    + Math.max(0, flightSeconds - (pending.reachableSeconds ?? flightSeconds));
  if (state.elapsed <= pending.expectedArrivalAt + controlWindow) return;
  // O passe morreu no ar sem chegar ao impedido: aí sim não há mais o que vigiar.
  if (state.offsideWatch?.passId === pending.id) state.offsideWatch = null;
  closePass();
};
