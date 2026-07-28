import { DUEL, FIELD, PHYSICS, SHIELD } from "../config";
import { add, clamp, cross, distance, dot, lerp, length, limit, normalize, rotate, scale, subtract } from "../../shared/math";
import { desiredBallAnchor } from "../runtime/ball-anchor";
import { activeChallengers, contestForces, gripFactor } from "../runtime/engagement";
import type { AgentDecision, BallAction, DribbleStyle, DribbleTouchRange, MatchState, PlayerRuntime, Team, Vec2 } from "../model";
import {
  adaptPlayerPolicy,
  clearDribbleOwner,
  pressureAt,
  registerControlledTeam,
  registerLooseBall,
} from "../runtime/control";
import { emitMatchEvent } from "../runtime/events";
import { emitCognitiveEvent, relevantPlayersNear } from "../runtime/cognitive-events";
import { duelEdge } from "../runtime/duel";
import { GOAL_MOUTH, insideGoalMouth, resolveGoalFrameContact } from "../runtime/goal-frame";
import { beginRestart, registerRestartKick } from "../runtime/restart";
import { offsideOffendersAtPass } from "../runtime/offside";
import { playerSkillSpeed } from "../runtime/player-metrics";
import { signedMatchNoise } from "../runtime/random";
import { solvePassTrajectory, targetAlongDirection } from "../runtime/pass-trajectory";
import { beginShot, resolveShot } from "../runtime/shot";
import { predictShotPoint, solveShotTrajectory } from "../runtime/shot-trajectory";
import { resolveGoalkeeperContact } from "./goalkeeper-system";

const dribbleTravelPlan = (
  player: PlayerRuntime,
  style: DribbleStyle,
  touchRange: DribbleTouchRange | undefined,
  target: Vec2,
  quality: number,
): { launchSpeed: number; chaseDuration: number } => {
  const intendedDistance = distance(player.position, target);
  const controlOffset = player.radius + FIELD.ballRadius + 0.15;
  const ballTravelDistance = Math.max(2.2, intendedDistance - controlOffset);
  const speedFactor = style === "knockOn" || style === "feint"
    ? PHYSICS.burstSpeedFactor
    : PHYSICS.controlledSpeedFactor;
  const expectedPlayerSpeed = playerSkillSpeed(player) * speedFactor * (0.78 + quality * 0.14);
  const minimumDuration = style === "knockOn"
    ? touchRange === "short" ? 0.42 : touchRange === "medium" ? 0.62 : 0.86
    : style === "feint" ? 0.72 : 0.38;
  const maximumDuration = style === "knockOn"
    ? touchRange === "short" ? 0.68 : touchRange === "medium" ? 0.96 : 1.35
    : style === "feint" ? 1.2 : 0.76;
  const chaseDuration = clamp(intendedDistance / Math.max(1, expectedPlayerSpeed) + 0.12, minimumDuration, maximumDuration);
  const ballTravelTime = chaseDuration * (style === "carry" ? 0.82 : 0.72);
  const dragDistanceFactor = 1 - Math.exp(-PHYSICS.ballDrag * ballTravelTime);
  const distanceMatchedSpeed = ballTravelDistance * PHYSICS.ballDrag / Math.max(0.01, dragDistanceFactor);
  const minimumLaunchSpeed = style === "knockOn"
    ? touchRange === "short" ? 18 : touchRange === "medium" ? 24 : 30
    : style === "feint" ? 25 : 17;
  return {
    launchSpeed: clamp(distanceMatchedSpeed, minimumLaunchSpeed, PHYSICS.maxBallSpeed),
    chaseDuration,
  };
};

/** O marcador REAL no raio de colisão (raios quase se tocando) — não um adversário em espaço vazio. */
const nearestEngagedOpponent = (state: MatchState, player: PlayerRuntime): PlayerRuntime | null =>
  [...state.players]
    .filter((candidate) => candidate.team !== player.team
      && candidate.reactionTimer <= 0
      && candidate.duelCooldown <= 0
      && distance(candidate.position, player.position) < player.radius + candidate.radius + DUEL.feintEngageMargin)
    .sort((a, b) => distance(a.position, player.position) - distance(b.position, player.position))[0] ?? null;

const releaseBall = (state: MatchState, player: PlayerRuntime, direction: Vec2, speed: number, lift: number): void => {
  state.ball.velocity = limit(scale(direction, speed), PHYSICS.maxBallSpeed);
  state.ball.verticalVelocity = lift;
  state.ball.height = 0;
  state.ball.controllerId = null;
  clearDribbleOwner(state);
  state.ball.controlStartedAt = 0;
  state.ball.lastTouch = player.team;
  state.ball.lastTouchPlayerId = player.profile.id;
  state.ballControlTeam = null;
  state.possessionCandidateSince = state.elapsed;
  // Regra 8: a bola parada entra em jogo quando o cobrador a chuta e ela se move claramente — que
  // é exatamente o que acontece aqui. A partir deste instante ele não pode tocá-la de novo.
  registerRestartKick(state, player.profile.id);
};

export const executeBallAction = (state: MatchState, player: PlayerRuntime, action: BallAction): void => {
  if (action.kind === "none" || player.kickCooldown > 0 || player.reactionTimer > 0) return;
  const rawPressure = pressureAt(state, player);
  const pressure = rawPressure * (1.16 - player.profile.mental.composure / 190);
  if (action.kind === "dribble") {
    if (action.style === "knockOn" && player.dribbleTouchCooldown > 0) return;
    const controlStartedAt = state.ball.controlStartedAt || state.elapsed;
    const quality = (player.profile.skills.control * 0.75 + player.profile.skills.burst * 0.25) / 100;
    const targetDirection = normalize(subtract(action.target, player.position));
    if (action.style === "carry") {
      // Close control: a bola fica colada no pé, em velocidade baixa. Avançar em pique
      // exige soltar a bola à frente (knockOn), nunca a condução colada.
      state.ball.lastAction = "dribble";
      state.ball.lastTouch = player.team;
      state.ball.lastTouchPlayerId = player.profile.id;
      state.ball.controlStartedAt = controlStartedAt;
      clearDribbleOwner(state);
      registerControlledTeam(state, player.team);
      return;
    }
    let success = true;
    let errorFactor = 0.32 + pressure * 0.28;
    let speed = 13.5 + quality * 3.5;
    let chosenDirection = targetDirection;
    let dribbleTarget = action.target;
    let defender: PlayerRuntime | null = null;
    let lift = 0;
    if (action.style === "knockPast") {
      // Bola erguida por cima da dividida e corrida atrás: o recurso de quem tem pique em vez de
      // repertório. Era um desfecho do duelo, mas nunca foi — é uma decisão do atacante.
      defender = nearestEngagedOpponent(state, player);
      if (!defender) return;
      const toDefender = normalize(subtract(defender.position, player.position));
      const goalward = { x: player.team === "blue" ? 1 : -1, y: 0 };
      const leftRot = rotate(goalward, Math.PI / 6);
      const rightRot = rotate(goalward, -Math.PI / 6);
      chosenDirection = dot(leftRot, toDefender) < dot(rightRot, toDefender) ? leftRot : rightRot;
      dribbleTarget = add(player.position, scale(chosenDirection, DUEL.knockPastProbe * FIELD.width * 2));
      errorFactor = 0.3 + pressure * 0.3;
      speed = DUEL.knockPastSpeed;
      lift = DUEL.knockPastLift; // apex ≈ 0,85 < 1,8 → a bola segue jogável
      player.dribbleTouchCooldown = Math.max(player.dribbleTouchCooldown, 0.3);
      defender.velocity = add(scale(defender.velocity, 0.85), scale(toDefender, 1.5));
      state.stats[player.team].sprintDribbles += 1;
    } else if (action.style === "knockOn") {
      errorFactor = 0.58 + pressure * 0.42 + (1 - player.sprintEnergy) * 0.35;
      speed = 25 + quality * 9;
      state.stats[player.team].sprintDribbles += 1;
      const touchRange = action.touchRange ?? "medium";
      // Cadência entre toques: curta o bastante para o avanço ser uma sequência de piques.
      // Na prática o jogador só volta a tocar ao alcançar a bola; isto só evita toque duplo.
      const touchCooldown = touchRange === "short" ? 0.3 : touchRange === "medium" ? 0.42 : 0.55;
      player.dribbleTouchCooldown = Math.max(player.dribbleTouchCooldown, touchCooldown);
      if (touchRange === "short") state.stats[player.team].shortSprintDribbles += 1;
      else if (touchRange === "medium") state.stats[player.team].mediumSprintDribbles += 1;
      else state.stats[player.team].longSprintDribbles += 1;
    } else if (action.style === "feint") {
      defender = nearestEngagedOpponent(state, player);
      if (defender) {
        state.stats[player.team].feintsAttempted += 1;
        // Mesma força de duelo do desarme: ler uma finta e cravar um carrinho pedem a mesma
        // virtude. Antes esta fórmula ignorava estamina e cabeça, e o zagueiro exausto lia o
        // drible tão bem quanto o inteiro. Ruído maior que o do contato — finta é mais loteria.
        success = duelEdge(player, defender) + signedMatchNoise(state) * 0.42 > 0.08;
        if (success) {
          defender.reactionTimer = Math.max(defender.reactionTimer, PHYSICS.feintReactionDuration * (0.8 + quality * 0.4));
          defender.duelCooldown = Math.max(defender.duelCooldown, PHYSICS.feintEvasionDuration + 0.22);
          defender.controlCooldown = Math.max(defender.controlCooldown, PHYSICS.feintEvasionDuration);
        }
      } else {
        success = false;
      }
      if (success) {
        const towardDefender = normalize(subtract(defender!.position, player.position));
        const firstSide = { x: -towardDefender.y, y: towardDefender.x };
        const secondSide = scale(firstSide, -1);
        const escapeSide = dot(firstSide, targetDirection) >= dot(secondSide, targetDirection) ? firstSide : secondSide;
        const goalward = { x: player.team === "blue" ? 1 : -1, y: 0 };
        chosenDirection = normalize(add(add(scale(goalward, 0.72), scale(targetDirection, 0.28)), scale(escapeSide, 0.92)));
        dribbleTarget = {
          x: clamp(defender!.position.x + goalward.x * FIELD.width * 0.07, 4, FIELD.width - 4),
          y: clamp(defender!.position.y + escapeSide.y * FIELD.height * 0.075, 4, FIELD.height - 4),
        };
        defender!.velocity = add(scale(defender!.velocity, 0.25), scale(escapeSide, -6.5));
        state.stats[player.team].feintsCompleted += 1;
        player.memory.stats.dribbles += 1;
        adaptPlayerPolicy(player, "dribble", state.learningEnabled ? 0.0012 : 0);
        player.velocity = add(player.velocity, scale(chosenDirection, 9));
      } else {
        if (defender) chosenDirection = normalize(subtract(defender.position, player.position));
        adaptPlayerPolicy(player, "dribble", state.learningEnabled ? -0.0008 : 0);
      }
      player.duelCooldown = success ? DUEL.feintCooldownWon : DUEL.feintCooldownLost;
      errorFactor = success ? 0.14 : 0.72;
      speed = success ? 23 + quality * 7 : 11.5;
    }
    // Finta lida pelo marcador: o atacante NÃO perde a posse por tentar o drible. Mantém a bola
    // no pé (close control) e come um cooldown; o eventual desarme fica a cargo do contato real
    // (resolveContact), que dispara quando os raios colidem. (Antes o releaseBall incondicional
    // largava a bola solta sem dono → perda de posse gratuita.)
    if (action.style === "feint" && !success) {
      state.ball.lastAction = "dribble";
      state.ball.lastTouch = player.team;
      state.ball.lastTouchPlayerId = player.profile.id;
      state.ball.controlStartedAt = controlStartedAt;
      clearDribbleOwner(state);
      registerControlledTeam(state, player.team);
      player.kickCooldown = 0.42;
      return;
    }
    // O balão por cima já nasce com velocidade e altura próprias; os demais estilos calculam o
    // toque pelo plano de perseguição.
    if (action.style !== "knockPast") {
      const travelPlan = dribbleTravelPlan(player, action.style, action.touchRange, dribbleTarget, quality);
      speed = travelPlan.launchSpeed;
      // Quem empurra a bola à frente precisa disparar atrás dela — a não ser exaurido. Não trava o
      // sprintCooldown: a perseguição se sustenta em piques encadeados, limitada pela volátil.
      if ((action.style === "knockOn" || action.style === "feint") && player.sprintEnergy > 0.1) {
        player.sprintTimer = Math.max(player.sprintTimer, travelPlan.chaseDuration);
      }
    } else if (player.sprintEnergy > 0.1) {
      player.sprintTimer = Math.max(player.sprintTimer, 0.6);
    }
    const direction = rotate(chosenDirection, signedMatchNoise(state) * (1 - quality) * errorFactor);
    releaseBall(state, player, direction, speed, lift);
    state.ball.lastAction = "dribble";
    if (action.style === "feint" && defender) {
      defender.evadedUntil = state.elapsed + PHYSICS.feintEvasionDuration;
      defender.evadedByAttackerId = player.profile.id;
    }
    state.ball.dribbleOwnerId = player.profile.id;
    state.ball.dribbleTarget = { ...dribbleTarget };
    state.ball.dribbleStyle = action.style;
    state.ball.dribbleTouchRange = action.style === "knockOn" ? action.touchRange ?? "medium" : null;
    state.ball.dribbleStartedAt = state.elapsed;
    state.ball.controlStartedAt = controlStartedAt;
    registerControlledTeam(state, player.team);
    player.kickCooldown = action.style === "feint" ? 0.32
      : action.style === "knockOn" || action.style === "knockPast" ? 0.3
        : 0.16;
    return;
  }
  if (action.kind === "shot") {
    const contactHeight = state.ball.height;
    const technique = action.technique ?? "power";
    const aerialDifficulty = technique === "header" ? 0.1 : technique === "volley" ? 0.14 : technique === "redirect" ? 0.08 : 0;
    const quality = clamp((player.profile.skills.finishing * 0.72 + player.profile.skills.control * 0.28) / 100
      - pressure * 0.22 - aerialDifficulty, 0.2, 0.98);
    const direction = rotate(normalize(subtract(action.target, state.ball.position)), signedMatchNoise(state) * (1 - quality) * (technique === "volley" ? 0.64 : 0.5));
    const skillFactor = 0.78 + player.profile.skills.kickPower / 220;
    const techniqueSpeed = technique === "header" ? 0.76 : technique === "redirect" ? 0.82 : 1;
    const speed = lerp(54, 92, action.power) * skillFactor * techniqueSpeed;
    const executedTarget = targetAlongDirection(state.ball.position, action.target, direction);
    const requestedHeight = clamp(action.targetHeight ?? (technique === "header" ? 2.9 : technique === "volley" ? 2.65 : 0.35), 0.1, GOAL_MOUTH.ceiling - 0.25);
    const solution = solveShotTrajectory(state.ball.position, executedTarget, contactHeight, requestedHeight, speed);
    releaseBall(state, player, normalize(solution.velocity), length(solution.velocity), solution.verticalVelocity);
    state.ball.height = contactHeight;
    state.ball.lastAction = "shot";
    player.kickCooldown = 0.48;
    player.memory.stats.shots += 1;
    state.stats[player.team].shots += 1;
    if (action.preparedPassId !== undefined) state.stats[player.team].firstTimeShots += 1;
    if (technique === "header") state.stats[player.team].headers += 1;
    if (technique === "volley") state.stats[player.team].volleys += 1;
    if (distance(player.position, action.target) > FIELD.width * 0.29) state.stats[player.team].longShots += 1;
    const goalLineX = player.team === "blue" ? FIELD.width : 0;
    const goalPoint = predictShotPoint(state.ball.position, state.ball.velocity, state.ball.height, state.ball.verticalVelocity, solution.duration);
    // Previsão da rota, e só isso: é o que faz o goleiro reagir. A estatística de chute no alvo
    // sai do DESFECHO (ver runtime/shot), e não daqui.
    const { id: shotId } = beginShot(state, {
      shooterId: player.profile.id,
      team: player.team,
      startedAt: state.elapsed,
      technique,
      target: executedTarget,
      targetHeight: requestedHeight,
      expectedArrivalAt: state.elapsed + solution.duration,
      expectedSpeed: solution.arrivalSpeed,
      goalPoint: { position: { x: goalLineX, y: goalPoint.position.y }, height: goalPoint.height },
      onTarget: solution.duration > 0 && insideGoalMouth(goalPoint.position.y, goalPoint.height),
      goalkeeperTouched: false,
    });
    const goalkeeper = state.players.find((candidate) => candidate.team !== player.team && candidate.profile.position === "goalkeeper");
    emitCognitiveEvent(state, "shotCommitted", goalkeeper ? [goalkeeper.profile.id] : null, { shotId });
    emitMatchEvent(state, { type: "shot-taken", team: player.team, playerId: player.profile.id });
    return;
  }
  const baseQuality = (player.profile.skills.passing * 0.68 + player.profile.skills.vision * 0.32) / 100;
  const passDistance = distance(state.ball.position, action.target);
  const distanceDifficulty = action.range === "long" ? clamp(passDistance / FIELD.width, 0.08, 0.34) * 0.42 + 0.015 : 0;
  const difficulty = distanceDifficulty + (action.trajectory === "air" ? 0.07 : action.range === "short" ? 0.12 : 0)
    + pressure * 0.2 + (1 - player.stamina) * 0.12;
  const quality = clamp(baseQuality - difficulty, 0.18, 0.97);
  const angularError = action.range === "long" ? 0.56 : action.trajectory === "air" ? 0.48 : 0.82;
  const direction = rotate(normalize(subtract(action.target, state.ball.position)), signedMatchNoise(state) * (1 - quality) * angularError);
  const distancePower = clamp(passDistance / (action.range === "long" ? 76 : 48), 0, 1);
  const chosenPower = clamp(Math.max(action.power, 0.44 + distancePower * 0.44), 0.42, 1);
  const executedTarget = targetAlongDirection(state.ball.position, action.target, direction);
  const solution = solvePassTrajectory(state.ball.position, executedTarget, action.trajectory, action.range, action.targeting, chosenPower);
  releaseBall(state, player, normalize(solution.velocity), length(solution.velocity), solution.verticalVelocity);
  state.ball.lastAction = "pass";
  // O ataque seguiu com outra bola: um chute que ainda estivesse em curso morreu aqui.
  resolveShot(state, "dead");
  player.kickCooldown = 0.4;
  state.stats[player.team].passes += 1;
  if (action.range === "long") state.stats[player.team].longPasses += 1;
  if (action.trajectory === "air") state.stats[player.team].aerialPasses += 1;
  const progress = (player.team === "blue" ? 1 : -1) * (action.target.x - player.position.x);
  if (progress > FIELD.width * 0.15) state.stats[player.team].lineBreaks += 1;
  const crossesCenter = (player.position.y - FIELD.height / 2) * (action.target.y - FIELD.height / 2) < 0;
  if (crossesCenter && Math.abs(action.target.y - player.position.y) > FIELD.height * 0.3) state.stats[player.team].switches += 1;
  const passId = ++state.passCounter;
  const purpose = action.purpose ?? "feet";
  state.pendingPass = {
    id: passId,
    passerId: player.profile.id,
    receiverId: action.receiverId,
    team: player.team,
    startedAt: state.elapsed,
    trajectory: action.trajectory,
    range: action.range,
    targeting: action.targeting,
    purpose,
    selectionReason: action.selectionReason ?? "progressivePass",
    target: executedTarget,
    landingPoint: solution.landingPoint,
    expectedArrivalAt: state.elapsed + solution.duration,
    receiverEta: action.receiverEta ?? solution.duration,
    opponentEta: action.opponentEta ?? solution.duration,
    expectedHeight: action.trajectory === "air" ? 1.2 : 0,
    expectedSpeed: length(solution.velocity) * Math.exp(-(action.trajectory === "air" ? PHYSICS.airBallDrag : PHYSICS.ballDrag) * solution.duration),
  };
  if (purpose === "cross") state.stats[player.team].crosses += 1;
  else if (purpose === "cutback") state.stats[player.team].cutbacks += 1;
  else if (purpose === "throughBall") state.stats[player.team].throughBalls += 1;
  armOffsideWatch(state, player, passId);
  emitCognitiveEvent(state, "passCommitted", [action.receiverId, ...relevantPlayersNear(state, solution.landingPoint)], { passId });
};

/**
 * Lei 11 — julgamento no instante do passe. Congela quem está em posição de impedimento agora;
 * a punição só virá se um deles se envolver na jogada (ver possession-system). O primeiro passe
 * de um lateral/escanteio/tiro de meta é a própria cobrança e não se julga: consome a isenção e
 * arma normalmente a partir do toque seguinte.
 */
const armOffsideWatch = (state: MatchState, passer: PlayerRuntime, passId: number): void => {
  if (state.offsideExemptRestart) {
    state.offsideExemptRestart = false;
    state.offsideWatch = null;
    return;
  }
  const { offenders, lineProgress } = offsideOffendersAtPass(state, passer.team, passer.profile.id);
  state.offsideWatch = offenders.length > 0
    ? { team: passer.team, passId, offenders, lineProgress }
    : null;
};

/**
 * A bola no pé do portador, quadro a quadro: a mola do controle a puxa para a âncora enquanto a
 * disputa a empurra para fora. É a corrida entre as duas que resolve o desarme — e é por isso que
 * nada aqui escreve uma posição de desfecho. Quando a pressão vence, a bola já sai andando na
 * velocidade que ganhou, sem descontinuidade no instante em que o controle cai.
 */
const attachControlledBall = (state: MatchState, player: PlayerRuntime, shielding: boolean, dt: number): void => {
  const facing = length(player.facing) > 0 ? player.facing : { x: player.team === "blue" ? 1 : -1, y: 0 };
  // A bola contorna o corpo em velocidade finita: saltar direto para a âncora desejada seria
  // trocar um teleporte por outro.
  const anchorTurn = SHIELD.turnRate * dt;
  const anchorError = desiredBallAnchor(state, player, shielding) - player.ballAnchor;
  player.ballAnchor += clamp(anchorError, -anchorTurn, anchorTurn);
  const carry = rotate(facing, player.ballAnchor);
  const target = add(player.position, scale(carry, player.radius + state.ball.radius + 0.15));
  const challengers = state.engagement ? activeChallengers(state, player) : [];
  const contest = contestForces(state, player, challengers);
  // A trombada empurra o PORTADOR; a bola fica onde estava. É essa separação que o tira dela.
  player.velocity = add(player.velocity, scale(contest.shove, dt));
  const grip = PHYSICS.controlSpring * gripFactor(player, contest.bite);
  const error = subtract(target, state.ball.position);
  const correction = limit(
    scale(error, 1 - Math.exp(-grip * dt)),
    PHYSICS.controlledBallRepositionSpeed * dt,
  );
  const blend = clamp(1 - Math.exp(-grip * dt), 0, 1);
  state.ball.position = add(add(state.ball.position, correction), scale(contest.pressure, dt));
  state.ball.velocity = add(
    add(scale(state.ball.velocity, 1 - blend), scale(player.velocity, blend)),
    contest.pressure,
  );
  state.ball.height = 0;
  state.ball.verticalVelocity = 0;
};

const actionDirection = (player: PlayerRuntime, action: BallAction): Vec2 | null => {
  if (action.kind === "none") return null;
  return normalize(subtract(action.target, player.position));
};

const prepareControlledBall = (player: PlayerRuntime, decision: AgentDecision, dt: number): boolean => {
  const desired = actionDirection(player, decision.ballAction);
  if (!desired || length(desired) < 0.001) return true;
  const current = length(player.facing) > 0.001 ? player.facing : { x: player.team === "blue" ? 1 : -1, y: 0 };
  const remainingAngle = Math.acos(clamp(dot(current, desired), -1, 1));
  const maximumTurn = PHYSICS.ballCarryTurnRate * (decision.ballAction.kind === "dribble" ? 0.45 : 1) * dt;
  if (remainingAngle <= maximumTurn) {
    player.facing = desired;
  } else {
    const turn = cross(current, desired);
    const turnSign = Math.abs(turn) > 0.0001 ? Math.sign(turn) : player.team === "blue" ? 1 : -1;
    player.facing = rotate(current, maximumTurn * turnSign);
  }
  if (decision.ballAction.kind === "dribble") return true;
  return dot(player.facing, desired) > PHYSICS.ballActionAlignment;
};

export const updateControlledBall = (state: MatchState, decisions: Map<string, AgentDecision>, dt: number): void => {
  const controller = state.players.find((player) => player.profile.id === state.ball.controllerId);
  if (!controller) return;
  const decision = decisions.get(controller.profile.id)!;
  const actionReady = prepareControlledBall(controller, decision, dt);
  const restart = state.restart;
  if (restart && !restart.ballInPlay && restart.takerId === controller.profile.id) {
    // Cobrança de bola parada: a bola fica no ponto (o cobrador pode estar fora do campo, no
    // lateral/escanteio) e é golpeada dali, não conduzida no pé.
    state.ball.position = { ...restart.spot };
    state.ball.velocity = { x: 0, y: 0 };
    state.ball.height = 0;
    state.ball.verticalVelocity = 0;
  } else {
    // Protege a bola enquanto ainda está lendo o jogo ou conduzindo colado; ao decidir o passe,
    // o chute ou o toque à frente, recompõe a bola à frente para bater nela.
    const shielding = decision.ballAction.kind === "none"
      || (decision.ballAction.kind === "dribble" && decision.ballAction.style === "carry");
    attachControlledBall(state, controller, shielding, dt);
  }
  const firstTouchSettled = state.elapsed - state.ball.controlStartedAt >= PHYSICS.firstTouchSettleTime;
  if (actionReady && firstTouchSettled) executeBallAction(state, controller, decision.ballAction);
};

const otherTeam = (team: Team): Team => team === "blue" ? "coral" : "blue";

const registerGoal = (state: MatchState, scorerTeam: Team): void => {
  const conceding: Team = scorerTeam === "blue" ? "coral" : "blue";
  const activeShooter = state.activeShot?.team === scorerTeam ? state.activeShot.shooterId : null;
  const scorer = state.players.find((player) => player.profile.id === (activeShooter ?? state.ball.lastTouchPlayerId) && player.team === scorerTeam);
  const origin = state.activeShot?.team === scorerTeam ? "shot" : state.ball.lastAction ?? "dribble";
  // Antes do reinício, que fecharia o chute como jogada desfeita: quem terminou no fundo da rede
  // acertou o alvo, e é este o único lugar que sabe disso.
  resolveShot(state, origin === "shot" ? "goal" : "dead");
  state.stats[scorerTeam].goals += 1;
  if (origin === "shot") state.stats[scorerTeam].goalsFromShots += 1;
  else if (origin === "pass") state.stats[scorerTeam].goalsFromPasses += 1;
  else state.stats[scorerTeam].goalsFromDribbles += 1;
  state.stats[scorerTeam].reward += 1;
  state.stats[conceding].reward -= 1;
  if (scorer) {
    scorer.memory.stats.goals += 1;
    const learningAmount = state.learningEnabled ? 0.009 : 0;
    adaptPlayerPolicy(scorer, origin === "shot" ? "shoot" : origin === "pass" ? "pass" : "dribble", learningAmount);
  }
  const assist = state.lastAssist && state.lastAssist.team === scorerTeam && state.elapsed - state.lastAssist.time < 8
    ? state.players.find((player) => player.profile.id === state.lastAssist?.playerId)
    : null;
  if (assist && assist.profile.id !== scorer?.profile.id) assist.memory.stats.assists += 1;
  emitMatchEvent(state, { type: "goal-scored", team: scorerTeam, playerId: scorer?.profile.id ?? null, origin });
  state.lastAssist = null;
  // Bola no meio: os jogadores voltam à formação e o cobrador caminha até a marca central. A
  // posição de saída não importa aqui — o kickoff sempre nasce no centro.
  beginRestart(state, "kickoff", conceding, state.ball.position);
};

/**
 * Bateu na madeira: o chute (ou o cruzamento) morreu ali e a sobra é bola livre. Quem estava
 * lendo aquela trajetória precisa saber que ela mudou — sem isso o goleiro segue defendendo um
 * chute que já ricocheteou e o recebedor segue esperando um passe que não chega.
 */
const registerFrameRebound = (state: MatchState): void => {
  const shotId = state.activeShot?.id;
  const pass = state.pendingPass;
  resolveShot(state, "woodwork");
  state.pendingPass = null;
  state.ball.lastAction = null;
  clearDribbleOwner(state);
  registerLooseBall(state);
  const nearby = relevantPlayersNear(state, state.ball.position);
  if (pass) emitCognitiveEvent(state, "passResolved", nearby, { passId: pass.id, outcome: "loose" });
  emitCognitiveEvent(state, "ballTrajectoryChanged", nearby, { shotId, passId: pass?.id });
};

export const updateBall = (state: MatchState, dt: number): void => {
  const ball = state.ball;
  // Bola parada: enquanto o cobrador caminha (ninguém com a posse), a bola fica presa no ponto —
  // sem física livre e sem re-detectar limite. Quando o cobrador assume, o controle a solta daqui.
  if (state.restart && !state.restart.ballInPlay && ball.controllerId === null) {
    ball.position = { ...state.restart.spot };
    ball.velocity = { x: 0, y: 0 };
    ball.height = 0;
    ball.verticalVelocity = 0;
    return;
  }
  const previousPosition = { ...ball.position };
  const previousHeight = ball.height;
  const airborne = ball.height > 0 || ball.verticalVelocity > 0;
  const drag = airborne ? PHYSICS.airBallDrag : PHYSICS.ballDrag;
  ball.velocity = scale(ball.velocity, Math.exp(-drag * dt));
  ball.position = add(ball.position, scale(ball.velocity, dt));
  if (airborne) {
    ball.verticalVelocity -= PHYSICS.gravity * dt;
    ball.height += ball.verticalVelocity * dt;
    if (resolveGoalkeeperContact(state, previousPosition, previousHeight, dt) && ball.controllerId) return;
    if (ball.height <= 0) {
      const impactSpeed = Math.abs(ball.verticalVelocity);
      const reboundSpeed = impactSpeed * PHYSICS.ballBounce;
      ball.height = 0;
      ball.velocity = scale(ball.velocity, PHYSICS.landingFriction);
      ball.verticalVelocity = impactSpeed > 3 && reboundSpeed > 2.2 ? reboundSpeed : 0;
      if (state.pendingPass && impactSpeed > 3) {
        emitCognitiveEvent(state, "ballTrajectoryChanged", relevantPlayersNear(state, ball.position), { passId: state.pendingPass.id });
      }
    }
  } else if (resolveGoalkeeperContact(state, previousPosition, previousHeight, dt) && ball.controllerId) return;
  // A baliza é sólida: o ricochete pode jogar a bola para dentro ou para fora, e o julgamento
  // da linha só acontece no trajeto já desviado — daí resolvê-la antes de olhar os limites.
  if (ball.controllerId === null && resolveGoalFrameContact(ball, previousPosition, previousHeight)) {
    registerFrameRebound(state);
    return;
  }
  const goalLineX = ball.position.x < -ball.radius ? 0
    : ball.position.x > FIELD.width + ball.radius ? FIELD.width
    : null;
  if (goalLineX !== null) {
    const travelX = ball.position.x - previousPosition.x;
    const amount = Math.abs(travelX) > 0.0001 ? clamp((goalLineX - previousPosition.x) / travelX, 0, 1) : 1;
    const crossingY = previousPosition.y + (ball.position.y - previousPosition.y) * amount;
    const crossingHeight = Math.max(0, previousHeight + (ball.height - previousHeight) * amount);
    const defendingTeam: Team = goalLineX === 0 ? "blue" : "coral";
    // Regra 10: passou inteira pela linha de meta ou é gol (pela boca) ou é bola fora de jogo —
    // por cima do travessão e por fora dos postes valem a mesma saída, não um rebote em campo.
    //
    // Gol se faz com a bola livre, nunca com ela dominada — mesmo guarda que a baliza já usa logo
    // acima. Quem atravessa a linha carregando a bola põe a bola fora de jogo; a meta se bate com
    // um chute, um passe ou um toque à frente, e todos soltam a bola antes de ela cruzar.
    if (ball.controllerId === null && insideGoalMouth(crossingY, crossingHeight)) registerGoal(state, otherTeam(defendingTeam));
    else {
      const restartTeam = ball.lastTouch === defendingTeam ? otherTeam(defendingTeam) : defendingTeam;
      beginRestart(state, restartTeam === defendingTeam ? "goalKick" : "corner", restartTeam, ball.position);
    }
    return;
  }
  if (ball.position.y < -ball.radius || ball.position.y > FIELD.height + ball.radius) {
    const restartTeam = ball.lastTouch ? otherTeam(ball.lastTouch) : (ball.position.x < FIELD.width / 2 ? "blue" : "coral");
    beginRestart(state, "throwIn", restartTeam, ball.position);
  }
};
