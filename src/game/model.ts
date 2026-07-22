export type Team = "blue" | "coral";

export interface Vec2 {
  x: number;
  y: number;
}

export type PlayerPosition = "goalkeeper" | "centerBack" | "fullBack" | "midfielder" | "forward";
export type PlayerRole = "finisher" | "playmaker" | "defender";
export type TeamPosture = "inPossession" | "outOfPossession";
export type InPossessionPhase = "buildUp" | "progression" | "finalThird" | "counterAttack";
export type OutOfPossessionPhase = "highPress" | "midBlock" | "lowBlock" | "counterPress" | "recovery";
export type TacticalPhase = InPossessionPhase | OutOfPossessionPhase;
export type DecisionReason =
  | "shootingWindow"
  | "progressivePass"
  | "switchPlay"
  | "wallPass"
  | "escapePressure"
  | "carryIntoSpace"
  | "giveWidth"
  | "runInBehind"
  | "thirdManSupport"
  | "restDefense"
  | "pressBall"
  | "coverGoal"
  | "markThreat"
  | "protectGoal";
export type PlayerIntent =
  | "carrying"
  | "sprinting"
  | "knockingOn"
  | "feinting"
  | "passing"
  | "shooting"
  | "supporting"
  | "pressing"
  | "marking"
  | "covering"
  | "goalkeeping";
export type MovementPace = "walk" | "run" | "burst" | "closeControl";

export interface PlayerSkills {
  acceleration: number;
  sprintSpeed: number;
  burst: number;
  stamina: number;
  control: number;
  passing: number;
  vision: number;
  finishing: number;
  defending: number;
  kickPower: number;
  goalkeeping: number;
}

export interface PlayerProfile {
  id: string;
  name: string;
  number: number;
  position: PlayerPosition;
  role: PlayerRole;
  skills: PlayerSkills;
}

export interface PlayerPolicy {
  shoot: number;
  pass: number;
  dribble: number;
  press: number;
  mark: number;
  cover: number;
}

export interface PlayerCareerStats {
  matches: number;
  goals: number;
  assists: number;
  completedPasses: number;
  failedPasses: number;
  interceptions: number;
  dribbles: number;
  shots: number;
}

export interface PlayerMemory {
  playerId: string;
  version: number;
  policy: PlayerPolicy;
  stats: PlayerCareerStats;
}

export interface Lineup {
  goalkeeperId: string;
  fieldPlayerIds: [string, string, string];
}

export interface AutoballSave {
  schemaVersion: 1;
  players: PlayerProfile[];
  lineups: Record<Team, Lineup>;
  memories: Record<string, PlayerMemory>;
  settings: {
    learningEnabled: boolean;
    randomSeed: number;
  };
}

export interface PlayerRuntime {
  profile: PlayerProfile;
  memory: PlayerMemory;
  team: Team;
  lineupIndex: number;
  position: Vec2;
  velocity: Vec2;
  facing: Vec2;
  radius: number;
  energy: number;
  kickCooldown: number;
  sprintTimer: number;
  sprintCooldown: number;
  reactionTimer: number;
  duelCooldown: number;
  controlCooldown: number;
  pace: MovementPace;
  posture: TeamPosture;
  intent: PlayerIntent;
  decisionReason: DecisionReason;
}

export interface Ball {
  position: Vec2;
  velocity: Vec2;
  height: number;
  verticalVelocity: number;
  radius: number;
  lastTouch: Team | null;
  lastTouchPlayerId: string | null;
  controllerId: string | null;
  lastAction: "shot" | "pass" | "dribble" | null;
  lastShotOnTarget: boolean;
  dribbleOwnerId: string | null;
  dribbleTarget: Vec2 | null;
  dribbleStyle: DribbleStyle | null;
  dribbleStartedAt: number;
  controlStartedAt: number;
}

export type PassTrajectory = "ground" | "air";
export type PassRange = "short" | "long";
export type PassTargeting = "feet" | "space";
export type DribbleStyle = "carry" | "controlledSprint" | "knockOn" | "feint";

export type BallAction =
  | { kind: "none" }
  | { kind: "dribble"; target: Vec2; style: DribbleStyle }
  | { kind: "shot"; target: Vec2; power: number }
  | {
    kind: "pass";
    receiverId: string;
    target: Vec2;
    trajectory: PassTrajectory;
    range: PassRange;
    targeting: PassTargeting;
    power: number;
  };

export interface AgentDecision {
  movementTarget: Vec2;
  burst: boolean;
  burstDuration?: number;
  posture: TeamPosture;
  intent: PlayerIntent;
  reason: DecisionReason;
  ballAction: BallAction;
}

export interface PendingPass {
  passerId: string;
  receiverId: string;
  team: Team;
  startedAt: number;
  trajectory: PassTrajectory;
  range: PassRange;
}

export interface FeintEvasion {
  attackerId: string;
  defenderId: string;
  expiresAt: number;
}

export interface TeamStats {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  saves: number;
  passes: number;
  completedPasses: number;
  longPasses: number;
  completedLongPasses: number;
  aerialPasses: number;
  completedAerialPasses: number;
  feintsAttempted: number;
  feintsCompleted: number;
  sprintDribbles: number;
  tacklesAttempted: number;
  tacklesWon: number;
  goalsFromShots: number;
  goalsFromPasses: number;
  goalsFromDribbles: number;
  possessionSeconds: number;
  reward: number;
  turnoversWon: number;
  finalThirdEntries: number;
  lineBreaks: number;
  switches: number;
  distanceCovered: number;
  widthIntegral: number;
  depthIntegral: number;
  compactnessIntegral: number;
  spatialSeconds: number;
  phaseSeconds: Record<TacticalPhase, number>;
}

export interface TeamShape {
  width: number;
  depth: number;
  compactness: number;
  lineHeight: number;
}

export interface TeamTacticalState {
  phase: TacticalPhase;
  phaseStartedAt: number;
  shape: TeamShape;
  wasInFinalThird: boolean;
}

export interface MatchEvent {
  id: number;
  time: number;
  team: Team | null;
  label: string;
}

export interface GameState {
  players: PlayerRuntime[];
  ball: Ball;
  stats: Record<Team, TeamStats>;
  events: MatchEvent[];
  elapsed: number;
  kickoffTimer: number;
  possessionTeam: Team | null;
  eventCounter: number;
  randomSeed: number;
  learningEnabled: boolean;
  pendingPass: PendingPass | null;
  feintEvasion: FeintEvasion | null;
  lastAssist: { playerId: string; team: Team; time: number } | null;
  previousControlledTeam: Team | null;
  lastControlledTeam: Team | null;
  controlChangedAt: number;
  contestedSeconds: number;
  tactics: Record<Team, TeamTacticalState>;
  heatmaps: Record<Team, number[]>;
  passNetwork: Record<Team, Record<string, number>>;
  nextAnalyticsSample: number;
  finished: boolean;
}
