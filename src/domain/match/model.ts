import type { PlayerMemory, PlayerProfile } from "../roster/model";
import type { Team, Vec2 } from "../shared/model";

export type { Team, Vec2 } from "../shared/model";
export type {
  Lineup,
  PlayerCareerStats,
  PlayerMemory,
  PlayerMentalAttributes,
  PlayerPolicy,
  PlayerPosition,
  PlayerProfile,
  PlayerRole,
  PlayerSkills,
} from "../roster/model";

export interface MatchParticipant {
  team: Team;
  lineupIndex: number;
  profile: PlayerProfile;
  memory: PlayerMemory;
}

export interface MatchConfig {
  seed: number;
  learningEnabled: boolean;
  participants: MatchParticipant[];
}

export type TeamPosture = "inPossession" | "outOfPossession";
export type InPossessionPhase = "buildUp" | "progression" | "finalThird" | "counterAttack";
export type OutOfPossessionPhase = "highPress" | "midBlock" | "lowBlock" | "counterPress" | "recovery";
export type TacticalPhase = InPossessionPhase | OutOfPossessionPhase;
export type AttackChannel = "left" | "center" | "right";
export type BuildUpStyle = "short" | "balanced" | "direct";
export type DefensiveBlock = "high" | "mid" | "low";
export type PressTrigger = "looseBall" | "counterPress" | "touchline" | "compact";
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
  | "attackReception"
  | "protectGoal";
export type PlayerIntent =
  | "carrying"
  | "sprinting"
  | "knockingOn"
  | "feinting"
  | "passing"
  | "shooting"
  | "receiving"
  | "supporting"
  | "pressing"
  | "marking"
  | "covering"
  | "goalkeeping";
export type MovementPace = "walk" | "run" | "burst" | "closeControl";

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
  plan: PlayerPlan | null;
  nextThinkAt: number;
  lastDecisionAt: number;
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
    receiverEta?: number;
    opponentEta?: number;
    selectionReason?: DecisionReason;
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

export type PlanTarget =
  | { kind: "point"; position: Vec2 }
  | { kind: "ball"; offset: Vec2 }
  | { kind: "player"; playerId: string; offset: Vec2 }
  | { kind: "goalkeeper" };

export interface PlayerPlan {
  target: PlanTarget;
  burst: boolean;
  burstDuration?: number;
  posture: TeamPosture;
  intent: PlayerIntent;
  reason: DecisionReason;
  ballAction: BallAction;
  startedAt: number;
  expiresAt: number;
  possessionTeam: Team | null;
  controllerId: string | null;
  ballActorId: string | null;
  collectivePlanStartedAt: number;
  duringRestart: boolean;
}

export interface PendingPass {
  passerId: string;
  receiverId: string;
  team: Team;
  startedAt: number;
  trajectory: PassTrajectory;
  range: PassRange;
  targeting: PassTargeting;
  selectionReason: DecisionReason;
  target: Vec2;
  landingPoint: Vec2;
  expectedArrivalAt: number;
  receiverEta: number;
  opponentEta: number;
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
  candidatePhase: TacticalPhase;
  candidatePhaseStartedAt: number;
  shape: TeamShape;
  finalThirdLatched: boolean;
  lastFinalThirdEntryAt: number;
  collectivePlan: TeamCollectivePlan | null;
}

export interface TeamCollectivePlan {
  startedAt: number;
  expiresAt: number;
  phase: TacticalPhase;
  posture: TeamPosture;
  ballActorId: string | null;
  buildUpStyle: BuildUpStyle;
  attackChannel: AttackChannel;
  defensiveBlock: DefensiveBlock;
  risk: number;
  primaryRunnerId: string | null;
  secondaryRunnerId: string | null;
  safetyPlayerId: string | null;
  presserId: string | null;
  pressTrigger: PressTrigger;
}

interface MatchEventBase {
  id: number;
  time: number;
}

export interface MatchStartedEvent extends MatchEventBase {
  type: "match-started";
}

export interface SaveMadeEvent extends MatchEventBase {
  type: "save-made";
  team: Team;
  playerId: string;
}

export interface ShotTakenEvent extends MatchEventBase {
  type: "shot-taken";
  team: Team;
  playerId: string;
}

export interface RestartAwardedEvent extends MatchEventBase {
  type: "restart-awarded";
  team: Team;
  restartKind: "throwIn" | "corner" | "goalKick";
}

export interface GoalScoredEvent extends MatchEventBase {
  type: "goal-scored";
  team: Team;
  playerId: string | null;
  origin: "shot" | "pass" | "dribble";
}

export interface MatchFinishedEvent extends MatchEventBase {
  type: "match-finished";
}

export type MatchEvent =
  | MatchStartedEvent
  | SaveMadeEvent
  | ShotTakenEvent
  | RestartAwardedEvent
  | GoalScoredEvent
  | MatchFinishedEvent;

type WithoutEventMetadata<T> = T extends MatchEvent ? Omit<T, "id" | "time"> : never;
export type MatchEventData = WithoutEventMetadata<MatchEvent>;

export interface MatchState {
  players: PlayerRuntime[];
  ball: Ball;
  stats: Record<Team, TeamStats>;
  events: MatchEvent[];
  elapsed: number;
  kickoffTimer: number;
  ballControlTeam: Team | null;
  possessionTeam: Team | null;
  possessionCandidateTeam: Team | null;
  possessionCandidateSince: number;
  lastPossessionChangeAt: number;
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
  nextCognitionAt: number;
  finished: boolean;
}
