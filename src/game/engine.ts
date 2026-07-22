import { decideAll, formationAnchor } from "./ai";
import { ANALYTICS_GRID, DEFAULT_MATCH_SEED, FIELD, MATCH_DURATION, PHYSICS } from "./config";
import { add, clamp, distance, dot, lerp, length, limit, normalize, rotate, scale, subtract } from "./math";
import type { AgentDecision, AutoballSave, BallAction, DribbleStyle, GameState, MatchEvent, PlayerRuntime, Team, Vec2 } from "./model";
import { createMemory } from "./roster";
import { lineupIds } from "./storage";
import { createPhaseSeconds, createTacticalState, updateTacticalContext } from "./tactics";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const teamStats = () => ({
  goals: 0, shots: 0, shotsOnTarget: 0, saves: 0, passes: 0, completedPasses: 0,
  longPasses: 0, completedLongPasses: 0, aerialPasses: 0, completedAerialPasses: 0,
  feintsAttempted: 0, feintsCompleted: 0, sprintDribbles: 0,
  tacklesAttempted: 0, tacklesWon: 0,
  goalsFromShots: 0, goalsFromPasses: 0, goalsFromDribbles: 0,
  possessionSeconds: 0, reward: 0,
  turnoversWon: 0, finalThirdEntries: 0, lineBreaks: 0, switches: 0, distanceCovered: 0,
  widthIntegral: 0, depthIntegral: 0, compactnessIntegral: 0, spatialSeconds: 0,
  phaseSeconds: createPhaseSeconds(),
});

const makePlayer = (save: AutoballSave, team: Team, id: string, lineupIndex: number): PlayerRuntime => {
  const profile = clone(save.players.find((candidate) => candidate.id === id)!);
  const memory = clone(save.memories[id] ?? createMemory(profile));
  const player: PlayerRuntime = {
    profile,
    memory,
    team,
    lineupIndex,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    facing: { x: team === "blue" ? 1 : -1, y: 0 },
    radius: FIELD.playerRadius,
    energy: 1,
    kickCooldown: 0,
    sprintTimer: 0,
    sprintCooldown: 0,
    reactionTimer: 0,
    duelCooldown: 0,
    controlCooldown: 0,
    pace: "walk",
    posture: "outOfPossession",
    intent: profile.position === "goalkeeper" ? "goalkeeping" : "covering",
    decisionReason: profile.position === "goalkeeper" ? "protectGoal" : "coverGoal",
  };
  player.position = formationAnchor(player);
  return player;
};

export function createGameState(save: AutoballSave, randomSeed = DEFAULT_MATCH_SEED): GameState {
  const players = (["blue", "coral"] as const).flatMap((team) =>
    lineupIds(save, team).map((id, index) => makePlayer(save, team, id, index)),
  );
  return {
    players,
    ball: {
      position: { x: FIELD.width / 2, y: FIELD.height / 2 }, velocity: { x: 0, y: 0 },
      height: 0, verticalVelocity: 0, radius: FIELD.ballRadius, lastTouch: null,
      lastTouchPlayerId: null, controllerId: null, lastAction: null, lastShotOnTarget: false,
      dribbleOwnerId: null, dribbleTarget: null, dribbleStyle: null, dribbleStartedAt: 0, controlStartedAt: 0,
    },
    stats: { blue: teamStats(), coral: teamStats() },
    events: [{ id: 1, time: 0, team: null, label: "Simulacao 4 x 4 iniciada" }],
    elapsed: 0,
    kickoffTimer: 1.1,
    possessionTeam: null,
    eventCounter: 1,
    randomSeed,
    learningEnabled: save.settings.learningEnabled,
    pendingPass: null,
    feintEvasion: null,
    lastAssist: null,
    previousControlledTeam: null,
    lastControlledTeam: null,
    controlChangedAt: 0,
    contestedSeconds: 0,
    tactics: { blue: createTacticalState("blue"), coral: createTacticalState("coral") },
    heatmaps: {
      blue: Array(ANALYTICS_GRID.columns * ANALYTICS_GRID.rows).fill(0) as number[],
      coral: Array(ANALYTICS_GRID.columns * ANALYTICS_GRID.rows).fill(0) as number[],
    },
    passNetwork: { blue: {}, coral: {} },
    nextAnalyticsSample: 0,
    finished: false,
  };
}

const addEvent = (state: GameState, team: Team | null, label: string): void => {
  const event: MatchEvent = { id: ++state.eventCounter, time: state.elapsed, team, label };
  state.events.unshift(event);
  state.events = state.events.slice(0, 7);
};

const nextRandom = (state: GameState): number => {
  state.randomSeed = (Math.imul(state.randomSeed, 1664525) + 1013904223) >>> 0;
  return state.randomSeed / 0x100000000;
};

const signedNoise = (state: GameState): number => nextRandom(state) - nextRandom(state);
const skillSpeed = (player: PlayerRuntime): number => 8.5 + player.profile.skills.sprintSpeed * 0.06;
const skillAcceleration = (player: PlayerRuntime): number => 22 + player.profile.skills.acceleration * 0.38;

const dribbleTravelPlan = (
  player: PlayerRuntime,
  style: DribbleStyle,
  target: Vec2,
  quality: number,
): { launchSpeed: number; chaseDuration: number } => {
  const intendedDistance = distance(player.position, target);
  const controlOffset = player.radius + FIELD.ballRadius + 0.15;
  const ballTravelDistance = Math.max(2.2, intendedDistance - controlOffset);
  const speedFactor = style === "knockOn" || style === "feint"
    ? PHYSICS.burstSpeedFactor
    : style === "controlledSprint"
      ? PHYSICS.runSpeedFactor
      : PHYSICS.controlledSpeedFactor;
  const expectedPlayerSpeed = skillSpeed(player) * speedFactor * (0.78 + quality * 0.14);
  const minimumDuration = style === "knockOn" ? 0.86 : style === "feint" ? 0.72 : style === "controlledSprint" ? 0.56 : 0.38;
  const maximumDuration = style === "knockOn" ? 1.45 : style === "feint" ? 1.2 : style === "controlledSprint" ? 1.05 : 0.76;
  const chaseDuration = clamp(intendedDistance / Math.max(1, expectedPlayerSpeed) + 0.12, minimumDuration, maximumDuration);
  const ballTravelTime = chaseDuration * (style === "carry" ? 0.82 : 0.72);
  const dragDistanceFactor = 1 - Math.exp(-PHYSICS.ballDrag * ballTravelTime);
  const distanceMatchedSpeed = ballTravelDistance * PHYSICS.ballDrag / Math.max(0.01, dragDistanceFactor);
  const minimumLaunchSpeed = style === "knockOn" ? 30 : style === "feint" ? 25 : style === "controlledSprint" ? 19 : 17;
  return {
    launchSpeed: clamp(distanceMatchedSpeed, minimumLaunchSpeed, PHYSICS.maxBallSpeed),
    chaseDuration,
  };
};

export const playerSpeedLimit = (player: PlayerRuntime, controlsBall: boolean, running = false): number => {
  const factor = controlsBall
    ? player.sprintTimer > 0 ? PHYSICS.controlledSprintSpeedFactor : PHYSICS.controlledSpeedFactor
    : player.sprintTimer > 0 ? PHYSICS.burstSpeedFactor : running ? PHYSICS.runSpeedFactor : PHYSICS.walkSpeedFactor;
  return skillSpeed(player) * factor;
};

const pressureAt = (state: GameState, player: PlayerRuntime): number => {
  const closest = Math.min(...state.players.filter((other) => other.team !== player.team).map((other) => distance(other.position, player.position)));
  return clamp(1 - closest / 10, 0, 1);
};

const ballClaimQuality = (state: GameState, player: PlayerRuntime, ownBox: boolean): number => {
  const skills = player.profile.skills;
  const value = ownBox && player.profile.position === "goalkeeper"
    ? skills.goalkeeping * 0.72 + skills.defending * 0.18 + skills.control * 0.1
    : state.pendingPass?.team === player.team
      ? skills.control * 0.62 + skills.acceleration * 0.15 + skills.vision * 0.13 + skills.defending * 0.1
      : state.pendingPass
        ? skills.defending * 0.48 + skills.control * 0.28 + skills.acceleration * 0.24
        : skills.control * 0.44 + skills.defending * 0.32 + skills.acceleration * 0.24;
  return clamp(value / 100, 0.05, 1);
};

const adapt = (player: PlayerRuntime, key: keyof PlayerRuntime["memory"]["policy"], amount: number): void => {
  if (amount === 0) return;
  player.memory.policy[key] = clamp(player.memory.policy[key] + amount, 0.28, 0.9);
  player.memory.version += 1;
};

const registerPassOutcome = (state: GameState, controller: PlayerRuntime): void => {
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
    adapt(passer, "pass", state.learningEnabled ? 0.002 : 0);
    state.lastAssist = { playerId: passer.profile.id, team: passer.team, time: state.elapsed };
  } else {
    passer.memory.stats.failedPasses += 1;
    if (controller.team !== pending.team) controller.memory.stats.interceptions += 1;
    adapt(passer, "pass", state.learningEnabled ? -0.0015 : 0);
    if (controller.team !== pending.team) adapt(controller, "press", state.learningEnabled ? 0.0015 : 0);
  }
  state.pendingPass = null;
};

const sampleSpatialAnalytics = (state: GameState): void => {
  if (state.elapsed + 0.0001 < state.nextAnalyticsSample) return;
  state.nextAnalyticsSample += ANALYTICS_GRID.sampleInterval;
  for (const player of state.players) {
    if (player.profile.position === "goalkeeper") continue;
    const column = clamp(Math.floor(player.position.x / FIELD.width * ANALYTICS_GRID.columns), 0, ANALYTICS_GRID.columns - 1);
    const row = clamp(Math.floor(player.position.y / FIELD.height * ANALYTICS_GRID.rows), 0, ANALYTICS_GRID.rows - 1);
    state.heatmaps[player.team][row * ANALYTICS_GRID.columns + column] += 1;
  }
};

const registerControlledTeam = (state: GameState, team: Team): void => {
  if (state.lastControlledTeam !== team) {
    if (state.lastControlledTeam) state.stats[team].turnoversWon += 1;
    state.previousControlledTeam = state.lastControlledTeam;
    state.lastControlledTeam = team;
    state.controlChangedAt = state.elapsed;
  }
  state.possessionTeam = team;
};

const clearDribbleOwner = (state: GameState): void => {
  state.ball.dribbleOwnerId = null;
  state.ball.dribbleTarget = null;
  state.ball.dribbleStyle = null;
  state.ball.dribbleStartedAt = 0;
};

const isEvadedDefender = (state: GameState, player: PlayerRuntime): boolean =>
  state.feintEvasion?.defenderId === player.profile.id && state.elapsed < state.feintEvasion.expiresAt;

const firstTouchOutcome = (
  state: GameState,
  player: PlayerRuntime,
  quality: number,
  ownBox: boolean,
  continuesOwnDribble: boolean,
): "clean" | "heavy" | "miss" => {
  const relativeSpeed = length(subtract(state.ball.velocity, player.velocity));
  const toBall = normalize(subtract(state.ball.position, player.position));
  const facingAlignment = clamp((dot(player.facing, toBall) + 1) / 2, 0, 1);
  const speedDifficulty = clamp(relativeSpeed / (ownBox ? 68 : 52), 0, 1) * (ownBox ? 0.5 : 0.64);
  const heightDifficulty = clamp(state.ball.height / 2.4, 0, 1) * 0.18;
  const positioningDifficulty = (1 - facingAlignment) * 0.16;
  const pressureDifficulty = pressureAt(state, player) * 0.1;
  const dribbleBonus = continuesOwnDribble ? 0.18 : 0;
  const margin = quality * 0.72 + player.energy * 0.1 + dribbleBonus + signedNoise(state) * 0.16
    - speedDifficulty - heightDifficulty - positioningDifficulty - pressureDifficulty;
  if (margin > (ownBox ? 0.08 : 0.16)) return "clean";
  if (margin > -0.13) return "heavy";
  return "miss";
};

const applyHeavyTouch = (state: GameState, player: PlayerRuntime, quality: number): void => {
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
  state.possessionTeam = null;
};

const updatePossession = (state: GameState, dt: number): void => {
  const current = state.players.find((player) => player.profile.id === state.ball.controllerId);
  if (current && state.ball.height < 1.8 && distance(current.position, state.ball.position) < PHYSICS.kickDistance + 0.7) {
    const challenger = [...state.players]
      .filter((player) => player.team !== current.team
        && player.reactionTimer <= 0
        && !isEvadedDefender(state, player)
        && distance(player.position, current.position) < current.radius + player.radius + 0.38)
      .sort((a, b) => distance(a.position, current.position) - distance(b.position, current.position))[0];
    if (challenger && current.duelCooldown <= 0 && challenger.duelCooldown <= 0) {
      state.stats[challenger.team].tacklesAttempted += 1;
      const holderScore = (current.profile.skills.control * 0.64 + current.profile.skills.burst * 0.2) / 100 + current.energy * 0.16;
      const defenderScore = (
        challenger.profile.skills.defending * 0.56
        + challenger.profile.skills.acceleration * 0.22
        + challenger.profile.skills.control * 0.12
      ) / 100 + challenger.energy * 0.1;
      const defenderWins = defenderScore - holderScore + signedNoise(state) * 0.34 > 0.04;
      current.duelCooldown = defenderWins ? 0.9 : 0.82;
      challenger.duelCooldown = defenderWins ? 1.05 : 1.12;
      if (defenderWins) {
        const approach = normalize(subtract(current.position, challenger.position));
        const side = signedNoise(state) >= 0 ? 1 : -1;
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
        state.possessionTeam = null;
        current.reactionTimer = Math.max(current.reactionTimer, 0.24);
        current.kickCooldown = Math.max(current.kickCooldown, 0.38);
        current.velocity = scale(current.velocity, 0.45);
        state.stats[challenger.team].tacklesWon += 1;
        state.contestedSeconds += dt;
        return;
      }
      const separationDirection = normalize(subtract(challenger.position, current.position));
      challenger.reactionTimer = Math.max(challenger.reactionTimer, 0.42);
      challenger.velocity = add(challenger.velocity, scale(separationDirection, 5.5));
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
    state.possessionTeam = null;
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
      return { player, quality, ownBox, range, gap, score: gap - quality * 0.92 - (ownBox ? 0.36 : 0) + fastBallPenalty - ownDribbleBonus };
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
    addEvent(state, controller.team, `${controller.profile.name} defendeu`);
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

const updatePlayer = (player: PlayerRuntime, decision: AgentDecision, controlsBall: boolean, dt: number): void => {
  player.posture = decision.posture;
  player.intent = decision.intent;
  player.decisionReason = decision.reason;
  player.kickCooldown = Math.max(0, player.kickCooldown - dt);
  player.sprintCooldown = Math.max(0, player.sprintCooldown - dt);
  player.sprintTimer = Math.max(0, player.sprintTimer - dt);
  player.reactionTimer = Math.max(0, player.reactionTimer - dt);
  player.duelCooldown = Math.max(0, player.duelCooldown - dt);
  player.controlCooldown = Math.max(0, player.controlCooldown - dt);
  if (decision.burst && player.sprintCooldown <= 0 && player.energy > 0.48) {
    player.sprintTimer = decision.burstDuration ?? PHYSICS.burstDuration;
    player.sprintCooldown = PHYSICS.burstCooldown;
  }
  const baseSpeed = skillSpeed(player);
  const movementGap = distance(decision.movementTarget, player.position);
  const running = !controlsBall && (
    movementGap > FIELD.width * 0.095
    || decision.intent === "pressing"
    || decision.intent === "sprinting"
    || decision.intent === "knockingOn"
    || decision.intent === "feinting"
  );
  const speedFactor = controlsBall
    ? player.sprintTimer > 0 ? PHYSICS.controlledSprintSpeedFactor : PHYSICS.controlledSpeedFactor
    : player.sprintTimer > 0 ? PHYSICS.burstSpeedFactor : running ? PHYSICS.runSpeedFactor : PHYSICS.walkSpeedFactor;
  player.pace = player.sprintTimer > 0 ? "burst" : controlsBall ? "closeControl" : running ? "run" : "walk";
  const desired = scale(normalize(subtract(decision.movementTarget, player.position)), baseSpeed * speedFactor);
  const steering = subtract(desired, player.velocity);
  const reactionFactor = player.reactionTimer > 0 ? 0.38 : 1;
  const burstAcceleration = player.sprintTimer > 0 ? PHYSICS.burstAccelerationFactor : 1;
  const acceleration = scale(normalize(steering), skillAcceleration(player) * (0.72 + player.energy * 0.28) * reactionFactor * burstAcceleration);
  player.velocity = add(player.velocity, scale(acceleration, dt));
  player.velocity = scale(player.velocity, Math.exp(-PHYSICS.playerDrag * dt));
  player.velocity = limit(player.velocity, baseSpeed * speedFactor * (player.reactionTimer > 0 ? 0.7 : 1));
  player.position = add(player.position, scale(player.velocity, dt));
  const speed = length(player.velocity);
  if (speed > 0.3 && (!controlsBall || decision.ballAction.kind === "dribble")) player.facing = normalize(player.velocity);
  const stamina = player.profile.skills.stamina / 100;
  const energyDelta = player.sprintTimer > 0
    ? -(0.14 - stamina * 0.045)
    : running
      ? -(0.026 - stamina * 0.018)
      : 0.032 + stamina * 0.012;
  player.energy = clamp(player.energy + energyDelta * dt, 0.35, 1);
  player.position.x = clamp(player.position.x, player.radius, FIELD.width - player.radius);
  player.position.y = clamp(player.position.y, player.radius, FIELD.height - player.radius);
};

const clampPlayerToField = (player: PlayerRuntime): void => {
  player.position.x = clamp(player.position.x, player.radius, FIELD.width - player.radius);
  player.position.y = clamp(player.position.y, player.radius, FIELD.height - player.radius);
};

const resolvePlayerCollision = (state: GameState, a: PlayerRuntime, b: PlayerRuntime): void => {
  const evasion = state.feintEvasion;
  if (evasion && state.elapsed < evasion.expiresAt) {
    const isEvasionPair = (a.profile.id === evasion.attackerId && b.profile.id === evasion.defenderId)
      || (a.profile.id === evasion.defenderId && b.profile.id === evasion.attackerId);
    if (isEvasionPair) return;
  }
  const delta = subtract(b.position, a.position);
  const separation = length(delta);
  const minimum = a.radius + b.radius;
  if (separation >= minimum || separation < 0.001) return;
  const normal = scale(delta, 1 / separation);
  const correction = scale(normal, (minimum - separation) / 2);
  a.position = subtract(a.position, correction);
  b.position = add(b.position, correction);
  const relative = (b.velocity.x - a.velocity.x) * normal.x + (b.velocity.y - a.velocity.y) * normal.y;
  if (relative < 0) {
    const impulse = scale(normal, relative * 0.38);
    a.velocity = add(a.velocity, impulse);
    b.velocity = subtract(b.velocity, impulse);
  }
};

const releaseBall = (state: GameState, player: PlayerRuntime, direction: Vec2, speed: number, lift: number): void => {
  state.ball.velocity = limit(scale(direction, speed), PHYSICS.maxBallSpeed);
  state.ball.verticalVelocity = lift;
  state.ball.height = 0;
  state.ball.controllerId = null;
  clearDribbleOwner(state);
  state.ball.controlStartedAt = 0;
  state.ball.lastTouch = player.team;
  state.ball.lastTouchPlayerId = player.profile.id;
  state.possessionTeam = null;
};

export const executeBallAction = (state: GameState, player: PlayerRuntime, action: BallAction): void => {
  if (action.kind === "none" || player.kickCooldown > 0 || player.reactionTimer > 0) return;
  const pressure = pressureAt(state, player);
  if (action.kind === "dribble") {
    const controlStartedAt = state.ball.controlStartedAt || state.elapsed;
    const quality = (player.profile.skills.control * 0.75 + player.profile.skills.burst * 0.25) / 100;
    const targetDirection = normalize(subtract(action.target, player.position));
    let success = true;
    let errorFactor = 0.32 + pressure * 0.28;
    let speed = 13.5 + quality * 3.5;
    let chosenDirection = targetDirection;
    let dribbleTarget = action.target;
    let defender: PlayerRuntime | null = null;
    if (action.style === "controlledSprint") {
      errorFactor = 0.44 + pressure * 0.34 + (1 - player.energy) * 0.22;
      speed = 18 + quality * 5;
    } else if (action.style === "knockOn") {
      errorFactor = 0.58 + pressure * 0.42 + (1 - player.energy) * 0.35;
      speed = 25 + quality * 9;
      state.stats[player.team].sprintDribbles += 1;
    } else if (action.style === "feint") {
      defender = [...state.players]
        .filter((candidate) => candidate.team !== player.team
          && candidate.reactionTimer <= 0
          && candidate.duelCooldown <= 0
          && distance(candidate.position, player.position) < FIELD.width * 0.075)
        .sort((a, b) => distance(a.position, player.position) - distance(b.position, player.position))[0];
      if (defender) {
        state.stats[player.team].feintsAttempted += 1;
        const attackerScore = (player.profile.skills.control * 0.58 + player.profile.skills.burst * 0.42) / 100;
        const defenderScore = (defender.profile.skills.defending * 0.62 + defender.profile.skills.acceleration * 0.38) / 100;
        success = attackerScore - defenderScore + signedNoise(state) * 0.42 > 0.08;
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
        adapt(player, "dribble", state.learningEnabled ? 0.0012 : 0);
        player.velocity = add(player.velocity, scale(chosenDirection, 9));
      } else {
        if (defender) chosenDirection = normalize(subtract(defender.position, player.position));
        adapt(player, "dribble", state.learningEnabled ? -0.0008 : 0);
      }
      player.duelCooldown = success ? 5.2 : 6.8;
      errorFactor = success ? 0.14 : 0.72;
      speed = success ? 23 + quality * 7 : 11.5;
    }
    if (action.style !== "feint" || success) {
      const travelPlan = dribbleTravelPlan(player, action.style, dribbleTarget, quality);
      speed = travelPlan.launchSpeed;
      if (action.style === "knockOn" || action.style === "feint") {
        player.sprintTimer = Math.max(player.sprintTimer, travelPlan.chaseDuration);
        player.sprintCooldown = Math.max(player.sprintCooldown, PHYSICS.burstCooldown);
      }
    }
    const direction = rotate(chosenDirection, signedNoise(state) * (1 - quality) * errorFactor);
    releaseBall(state, player, direction, speed, 0);
    state.ball.lastAction = "dribble";
    state.ball.lastShotOnTarget = false;
    if (action.style === "feint") {
      state.feintEvasion = success && defender
        ? { attackerId: player.profile.id, defenderId: defender.profile.id, expiresAt: state.elapsed + PHYSICS.feintEvasionDuration }
        : null;
    }
    if (action.style !== "feint" || success) {
      state.ball.dribbleOwnerId = player.profile.id;
      state.ball.dribbleTarget = { ...dribbleTarget };
      state.ball.dribbleStyle = action.style;
      state.ball.dribbleStartedAt = state.elapsed;
      state.ball.controlStartedAt = controlStartedAt;
      state.possessionTeam = player.team;
    }
    player.kickCooldown = action.style === "feint"
      ? success ? 0.32 : 0.42
      : action.style === "knockOn"
        ? 0.3
        : action.style === "controlledSprint"
          ? 0.22
          : 0.16;
    return;
  }
  if (action.kind === "shot") {
    const quality = clamp((player.profile.skills.finishing * 0.72 + player.profile.skills.control * 0.28) / 100 - pressure * 0.22, 0.2, 0.98);
    const direction = rotate(normalize(subtract(action.target, state.ball.position)), signedNoise(state) * (1 - quality) * 0.5);
    const skillFactor = 0.78 + player.profile.skills.kickPower / 220;
    const speed = lerp(58, 98, action.power) * skillFactor;
    releaseBall(state, player, direction, speed, 0);
    state.ball.lastAction = "shot";
    player.kickCooldown = 0.48;
    player.memory.stats.shots += 1;
    state.stats[player.team].shots += 1;
    const goalLineX = player.team === "blue" ? FIELD.width : 0;
    const travel = Math.abs(direction.x) > 0.001 ? (goalLineX - state.ball.position.x) / direction.x : -1;
    const projectedY = state.ball.position.y + direction.y * travel;
    state.ball.lastShotOnTarget = travel > 0 && projectedY > FIELD.goalTop && projectedY < FIELD.goalBottom;
    if (state.ball.lastShotOnTarget) state.stats[player.team].shotsOnTarget += 1;
    addEvent(state, player.team, `${player.profile.name} finalizou`);
    return;
  }
  const baseQuality = (player.profile.skills.passing * 0.68 + player.profile.skills.vision * 0.32) / 100;
  const passDistance = distance(state.ball.position, action.target);
  const distanceDifficulty = action.range === "long" ? clamp(passDistance / FIELD.width, 0.08, 0.34) * 0.42 : 0;
  const difficulty = distanceDifficulty + (action.trajectory === "air" ? 0.07 : 0) + pressure * 0.2 + (1 - player.energy) * 0.12;
  const quality = clamp(baseQuality - difficulty, 0.18, 0.97);
  const angularError = action.range === "long" ? 0.56 : action.trajectory === "air" ? 0.48 : 0.38;
  const direction = rotate(normalize(subtract(action.target, state.ball.position)), signedNoise(state) * (1 - quality) * angularError);
  const distancePower = clamp(passDistance / (action.range === "long" ? 76 : 48), 0, 1);
  const chosenPower = clamp(Math.max(action.power, 0.44 + distancePower * 0.44), 0.42, 1);
  const speedBase = action.range === "long" ? lerp(30, 63, chosenPower) : lerp(18, action.targeting === "space" ? 50 : 43, chosenPower);
  const speed = speedBase * (0.9 + player.profile.skills.kickPower / 430) * (1 + signedNoise(state) * (1 - quality) * 0.14);
  const lift = action.trajectory === "air" ? lerp(12, action.range === "long" ? 20 : 15, chosenPower) : 0;
  releaseBall(state, player, direction, speed, lift);
  state.ball.lastAction = "pass";
  state.ball.lastShotOnTarget = false;
  player.kickCooldown = 0.4;
  state.stats[player.team].passes += 1;
  if (action.range === "long") state.stats[player.team].longPasses += 1;
  if (action.trajectory === "air") state.stats[player.team].aerialPasses += 1;
  const progress = (player.team === "blue" ? 1 : -1) * (action.target.x - player.position.x);
  if (progress > FIELD.width * 0.15) state.stats[player.team].lineBreaks += 1;
  const crossesCenter = (player.position.y - FIELD.height / 2) * (action.target.y - FIELD.height / 2) < 0;
  if (crossesCenter && Math.abs(action.target.y - player.position.y) > FIELD.height * 0.3) state.stats[player.team].switches += 1;
  state.pendingPass = {
    passerId: player.profile.id,
    receiverId: action.receiverId,
    team: player.team,
    startedAt: state.elapsed,
    trajectory: action.trajectory,
    range: action.range,
  };
};

const attachControlledBall = (state: GameState, player: PlayerRuntime, dt: number): void => {
  const facing = length(player.facing) > 0 ? player.facing : { x: player.team === "blue" ? 1 : -1, y: 0 };
  const target = add(player.position, scale(facing, player.radius + state.ball.radius + 0.15));
  const error = subtract(target, state.ball.position);
  const correction = limit(
    scale(error, 1 - Math.exp(-PHYSICS.controlSpring * dt)),
    PHYSICS.controlledBallRepositionSpeed * dt,
  );
  const blend = clamp(1 - Math.exp(-PHYSICS.controlSpring * dt), 0, 1);
  state.ball.position = add(state.ball.position, correction);
  state.ball.velocity = add(scale(state.ball.velocity, 1 - blend), scale(player.velocity, blend));
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
    const cross = current.x * desired.y - current.y * desired.x;
    const turnSign = Math.abs(cross) > 0.0001 ? Math.sign(cross) : player.team === "blue" ? 1 : -1;
    player.facing = rotate(current, maximumTurn * turnSign);
  }
  if (decision.ballAction.kind === "dribble") return true;
  return dot(player.facing, desired) > PHYSICS.ballActionAlignment;
};

const resolveBallPlayerCollision = (state: GameState): void => {
  if (state.ball.height > 1.8 || state.ball.controllerId) return;
  const nearest = state.players
    .filter((player) => !isEvadedDefender(state, player))
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
};

const resetPositions = (state: GameState, kickoffTeam: Team): void => {
  const restartOffset = signedNoise(state) * 5;
  for (const player of state.players) {
    player.position = formationAnchor(player);
    player.position.y = clamp(player.position.y + restartOffset * (player.team === "blue" ? 0.2 : -0.2), 4, FIELD.height - 4);
    player.velocity = { x: 0, y: 0 };
    player.facing = { x: player.team === "blue" ? 1 : -1, y: 0 };
    player.kickCooldown = 0;
    player.sprintTimer = 0;
    player.sprintCooldown = 0;
    player.reactionTimer = 0;
    player.duelCooldown = 0;
    player.controlCooldown = 0;
    player.pace = "walk";
    player.energy = Math.min(1, player.energy + 0.16);
  }
  state.ball.position = { x: kickoffTeam === "blue" ? FIELD.width / 2 - 1.5 : FIELD.width / 2 + 1.5, y: FIELD.height / 2 + restartOffset };
  state.ball.velocity = { x: 0, y: 0 };
  state.ball.height = 0;
  state.ball.verticalVelocity = 0;
  state.ball.lastTouch = null;
  state.ball.lastTouchPlayerId = null;
  state.ball.controllerId = null;
  clearDribbleOwner(state);
  state.ball.controlStartedAt = 0;
  state.ball.lastAction = null;
  state.ball.lastShotOnTarget = false;
  state.possessionTeam = null;
  state.pendingPass = null;
  state.feintEvasion = null;
  state.kickoffTimer = 1.15;
};

const otherTeam = (team: Team): Team => team === "blue" ? "coral" : "blue";

const restartPlay = (
  state: GameState,
  team: Team,
  kind: "throwIn" | "corner" | "goalKick",
  exitPosition: Vec2,
): void => {
  const eligible = state.players.filter((player) => player.team === team && (kind === "goalKick"
    ? player.profile.position === "goalkeeper"
    : player.profile.position !== "goalkeeper"));
  const restarter = [...eligible].sort((a, b) => distance(a.position, exitPosition) - distance(b.position, exitPosition))[0];
  if (!restarter) return;
  const attacksRight = team === "blue";
  let restartPosition: Vec2;
  let facing: Vec2;
  if (kind === "throwIn") {
    const top = exitPosition.y < FIELD.height / 2;
    restartPosition = { x: clamp(exitPosition.x, fieldRestartMargin(), FIELD.width - fieldRestartMargin()), y: top ? 5 : FIELD.height - 5 };
    facing = normalize({ x: attacksRight ? 0.35 : -0.35, y: top ? 1 : -1 });
  } else if (kind === "corner") {
    const fromLeft = exitPosition.x < FIELD.width / 2;
    const top = exitPosition.y < FIELD.height / 2;
    restartPosition = { x: fromLeft ? 5 : FIELD.width - 5, y: top ? 5 : FIELD.height - 5 };
    facing = normalize({ x: fromLeft ? 1 : -1, y: top ? 1 : -1 });
  } else {
    const ownLeft = team === "blue";
    restartPosition = { x: ownLeft ? FIELD.goalAreaDepth * 0.72 : FIELD.width - FIELD.goalAreaDepth * 0.72, y: FIELD.height / 2 };
    facing = { x: ownLeft ? 1 : -1, y: 0 };
  }
  restarter.position = restartPosition;
  restarter.velocity = { x: 0, y: 0 };
  restarter.facing = facing;
  restarter.kickCooldown = 0;
  const releaseDistance = restarter.radius + state.ball.radius + 0.15;
  state.ball.position = add(restarter.position, scale(facing, releaseDistance));
  state.ball.velocity = { x: 0, y: 0 };
  state.ball.height = 0;
  state.ball.verticalVelocity = 0;
  state.ball.controllerId = restarter.profile.id;
  clearDribbleOwner(state);
  state.ball.controlStartedAt = state.elapsed;
  state.ball.lastTouch = team;
  state.ball.lastTouchPlayerId = restarter.profile.id;
  state.ball.lastAction = null;
  state.ball.lastShotOnTarget = false;
  state.possessionTeam = team;
  state.pendingPass = null;
  state.feintEvasion = null;
  state.kickoffTimer = 0.72;
  const label = kind === "throwIn" ? "Lateral" : kind === "corner" ? "Escanteio" : "Tiro de meta";
  addEvent(state, team, `${label} para ${team === "blue" ? "NILO" : "MAYA"}`);
};

const fieldRestartMargin = (): number => Math.max(8, FIELD.goalAreaDepth * 0.55);

const registerGoal = (state: GameState, scorerTeam: Team): void => {
  const conceding: Team = scorerTeam === "blue" ? "coral" : "blue";
  const scorer = state.players.find((player) => player.profile.id === state.ball.lastTouchPlayerId && player.team === scorerTeam);
  const origin = state.ball.lastAction ?? "dribble";
  state.stats[scorerTeam].goals += 1;
  if (origin === "shot") state.stats[scorerTeam].goalsFromShots += 1;
  else if (origin === "pass") state.stats[scorerTeam].goalsFromPasses += 1;
  else state.stats[scorerTeam].goalsFromDribbles += 1;
  state.stats[scorerTeam].reward += 1;
  state.stats[conceding].reward -= 1;
  if (scorer) {
    scorer.memory.stats.goals += 1;
    const learningAmount = state.learningEnabled ? 0.009 : 0;
    adapt(scorer, origin === "shot" ? "shoot" : origin === "pass" ? "pass" : "dribble", learningAmount);
  }
  const assist = state.lastAssist && state.lastAssist.team === scorerTeam && state.elapsed - state.lastAssist.time < 8
    ? state.players.find((player) => player.profile.id === state.lastAssist?.playerId)
    : null;
  if (assist && assist.profile.id !== scorer?.profile.id) assist.memory.stats.assists += 1;
  const originLabel = origin === "shot" ? "finalização" : origin === "pass" ? "passe" : "condução";
  addEvent(state, scorerTeam, `Gol de ${scorer?.profile.name ?? (scorerTeam === "blue" ? "NILO" : "MAYA")} (${originLabel})`);
  state.lastAssist = null;
  resetPositions(state, conceding);
};

const updateBall = (state: GameState, dt: number): void => {
  const ball = state.ball;
  const airborne = ball.height > 0 || ball.verticalVelocity > 0;
  const drag = airborne ? PHYSICS.airBallDrag : PHYSICS.ballDrag;
  ball.velocity = scale(ball.velocity, Math.exp(-drag * dt));
  ball.position = add(ball.position, scale(ball.velocity, dt));
  if (airborne) {
    ball.verticalVelocity -= PHYSICS.gravity * dt;
    ball.height += ball.verticalVelocity * dt;
    if (ball.height <= 0) {
      const impactSpeed = Math.abs(ball.verticalVelocity);
      const reboundSpeed = impactSpeed * PHYSICS.ballBounce;
      ball.height = 0;
      ball.velocity = scale(ball.velocity, PHYSICS.landingFriction);
      ball.verticalVelocity = impactSpeed > 3 && reboundSpeed > 2.2 ? reboundSpeed : 0;
    }
  }
  const inGoal = ball.position.y > FIELD.goalTop && ball.position.y < FIELD.goalBottom;
  if (ball.position.x < -ball.radius) {
    if (inGoal && ball.height < 4.8) registerGoal(state, "coral");
    else if (!inGoal) {
      const defendingTeam: Team = "blue";
      const restartTeam = ball.lastTouch === defendingTeam ? otherTeam(defendingTeam) : defendingTeam;
      restartPlay(state, restartTeam, restartTeam === defendingTeam ? "goalKick" : "corner", ball.position);
    } else ball.velocity.x = Math.abs(ball.velocity.x);
    return;
  }
  if (ball.position.x > FIELD.width + ball.radius) {
    if (inGoal && ball.height < 4.8) registerGoal(state, "blue");
    else if (!inGoal) {
      const defendingTeam: Team = "coral";
      const restartTeam = ball.lastTouch === defendingTeam ? otherTeam(defendingTeam) : defendingTeam;
      restartPlay(state, restartTeam, restartTeam === defendingTeam ? "goalKick" : "corner", ball.position);
    } else ball.velocity.x = -Math.abs(ball.velocity.x);
    return;
  }
  if (ball.position.y < -ball.radius || ball.position.y > FIELD.height + ball.radius) {
    const restartTeam = ball.lastTouch ? otherTeam(ball.lastTouch) : (ball.position.x < FIELD.width / 2 ? "blue" : "coral");
    restartPlay(state, restartTeam, "throwIn", ball.position);
  }
};

export function stepGame(state: GameState, dt: number): void {
  if (state.finished) return;
  const nextElapsed = state.elapsed + dt;
  state.elapsed = nextElapsed >= MATCH_DURATION - 0.000_001 ? MATCH_DURATION : nextElapsed;
  if (state.feintEvasion && state.elapsed >= state.feintEvasion.expiresAt) state.feintEvasion = null;
  sampleSpatialAnalytics(state);
  if (state.kickoffTimer > 0) {
    state.kickoffTimer = Math.max(0, state.kickoffTimer - dt);
    state.contestedSeconds += dt;
    updateTacticalContext(state, dt);
    if (state.elapsed >= MATCH_DURATION) {
      state.finished = true;
      addEvent(state, null, "Fim de partida");
    }
    return;
  }
  updatePossession(state, 0);
  updateTacticalContext(state, 0);
  const decisions = decideAll(state);
  for (const player of state.players) {
    const decision = decisions.get(player.profile.id)!;
    updatePlayer(player, decision, state.ball.controllerId === player.profile.id, dt);
    state.stats[player.team].distanceCovered += length(player.velocity) * dt;
  }
  for (let first = 0; first < state.players.length; first += 1) {
    for (let second = first + 1; second < state.players.length; second += 1) resolvePlayerCollision(state, state.players[first], state.players[second]);
  }
  for (const player of state.players) clampPlayerToField(player);
  const controller = state.players.find((player) => player.profile.id === state.ball.controllerId);
  if (controller) {
    const actionReady = prepareControlledBall(controller, decisions.get(controller.profile.id)!, dt);
    attachControlledBall(state, controller, dt);
    const firstTouchSettled = state.elapsed - state.ball.controlStartedAt >= PHYSICS.firstTouchSettleTime;
    if (actionReady && firstTouchSettled) executeBallAction(state, controller, decisions.get(controller.profile.id)!.ballAction);
  }
  updateBall(state, dt);
  updatePossession(state, dt);
  resolveBallPlayerCollision(state);
  updateTacticalContext(state, dt);
  if (state.pendingPass && state.elapsed - state.pendingPass.startedAt > 4) {
    const passer = state.players.find((player) => player.profile.id === state.pendingPass?.passerId);
    if (passer) passer.memory.stats.failedPasses += 1;
    state.pendingPass = null;
  }
  if (state.elapsed >= MATCH_DURATION) {
    state.finished = true;
    addEvent(state, null, "Fim de partida");
  }
}

export const matchMemories = (state: GameState) => state.players.map((player) => clone(player.memory));
