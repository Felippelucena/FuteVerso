import { formationAnchor } from "./ai";
import { ANALYTICS_GRID, DEFAULT_MATCH_SEED, FIELD } from "./config";
import type { MatchConfig, MatchParticipant, MatchState, PlayerRuntime } from "./model";
import { createPhaseSeconds, createTacticalState } from "./systems/tactics-system";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const teamStats = () => ({
  goals: 0, shots: 0, shotsOnTarget: 0, saves: 0, passes: 0, completedPasses: 0,
  longPasses: 0, completedLongPasses: 0, aerialPasses: 0, completedAerialPasses: 0,
  feintsAttempted: 0, feintsCompleted: 0, sprintDribbles: 0,
  shortSprintDribbles: 0, mediumSprintDribbles: 0, longSprintDribbles: 0,
  tacklesAttempted: 0, tacklesWon: 0,
  goalsFromShots: 0, goalsFromPasses: 0, goalsFromDribbles: 0,
  possessionSeconds: 0, reward: 0,
  turnoversWon: 0, finalThirdEntries: 0, lineBreaks: 0, switches: 0, distanceCovered: 0,
  widthIntegral: 0, depthIntegral: 0, compactnessIntegral: 0, spatialSeconds: 0,
  phaseSeconds: createPhaseSeconds(),
});

const makePlayer = (participant: MatchParticipant): PlayerRuntime => {
  const profile = clone(participant.profile);
  const memory = clone(participant.memory);
  const { team, lineupIndex } = participant;
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
    dribbleTouchCooldown: 0,
    reactionTimer: 0,
    duelCooldown: 0,
    controlCooldown: 0,
    pace: "walk",
    posture: "outOfPossession",
    intent: profile.position === "goalkeeper" ? "goalkeeping" : "covering",
    decisionReason: profile.position === "goalkeeper" ? "protectGoal" : "coverGoal",
    plan: null,
    nextThinkAt: 0,
    lastDecisionAt: 0,
  };
  player.position = formationAnchor(player);
  return player;
};

export function createMatchState(config: MatchConfig): MatchState {
  const players = config.participants.map(makePlayer);
  return {
    players,
    ball: {
      position: { x: FIELD.width / 2, y: FIELD.height / 2 }, velocity: { x: 0, y: 0 },
      height: 0, verticalVelocity: 0, radius: FIELD.ballRadius, lastTouch: null,
      lastTouchPlayerId: null, controllerId: null, lastAction: null, lastShotOnTarget: false,
      dribbleOwnerId: null, dribbleTarget: null, dribbleStyle: null, dribbleTouchRange: null,
      dribbleStartedAt: 0, controlStartedAt: 0,
    },
    stats: { blue: teamStats(), coral: teamStats() },
    events: [{ id: 1, time: 0, type: "match-started" }],
    elapsed: 0,
    kickoffTimer: 1.1,
    ballControlTeam: null,
    possessionTeam: null,
    possessionCandidateTeam: null,
    possessionCandidateSince: 0,
    lastPossessionChangeAt: 0,
    eventCounter: 1,
    randomSeed: config.seed ?? DEFAULT_MATCH_SEED,
    learningEnabled: config.learningEnabled,
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
    nextCognitionAt: 0,
    finished: false,
  };
}

export const extractPlayerMemories = (state: MatchState) => state.players.map((player) => clone(player.memory));
