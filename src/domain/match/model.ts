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
  /**
   * Estamina longa com que o atleta entra em campo (0..1). No jogo rápido é sempre 1;
   * em modos com progressão diária (carreira/roguelike) carrega o desgaste do dia.
   */
  startingStamina?: number;
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
export type PassPurpose = "feet" | "throughBall" | "cross" | "cutback" | "switch" | "layoff";
export type ShotTechnique = "placed" | "power" | "volley" | "header" | "redirect";
export type GoalkeeperAction = "standingSave" | "lowDive" | "highDive" | "verticalJump" | "aerialClaim" | "punch";
export type GoalkeeperSource = "shot" | "cross" | "loose";
export type SaveOutcome = "catch" | "parry" | "glance" | "miss";
export type PlayerObjective = "aggressiveBreak" | null;
export type PreparedReceptionKind = "shot" | "pass" | "control" | "redirect";
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
  | "firstTimeAction"
  | "aggressiveBreak"
  | "longShot"
  | "reactToShot"
  | "attackCross"
  | "recoverFromSave"
  | "protectGoal"
  | "holdInHands"
  | "reboundAlert"
  | "smotherLoose"
  | "recoverShape"
  | "overlapRun";
export type PlayerIntent =
  | "carrying"
  | "sprinting"
  | "knockingOn"
  | "feinting"
  | "passing"
  | "shooting"
  | "receiving"
  | "firstTime"
  | "breaking"
  | "supporting"
  | "pressing"
  | "marking"
  | "covering"
  | "preparingSave"
  | "diving"
  | "jumping"
  | "claimingHighBall"
  | "recoveringSave"
  | "goalkeeping"
  | "holdingBall";
export type MovementPace = "walk" | "run" | "burst" | "closeControl";

export interface PlayerRuntime {
  profile: PlayerProfile;
  memory: PlayerMemory;
  team: Team;
  lineupIndex: number;
  position: Vec2;
  /** Posição-base na formação (âncora fixa do jogador), calculada uma vez na criação da partida. */
  homeAnchor: Vec2;
  velocity: Vec2;
  facing: Vec2;
  radius: number;
  /** Estamina longa (fôlego de partida): só decai em jogo e modula a volátil. */
  stamina: number;
  /** Estamina volátil (piques/explosões): drena em disparada e recupera rápido. */
  sprintEnergy: number;
  kickCooldown: number;
  sprintTimer: number;
  sprintCooldown: number;
  dribbleTouchCooldown: number;
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
  lastCognitiveEventId: number;
  objective: PlayerObjective;
  objectiveExpiresAt: number;
  goalkeeperAttempt: GoalkeeperAttempt | null;
  goalkeeperRecoveryUntil: number;
  /** Enquanto ativo, o goleiro segura a bola nas mãos: imune a desarme, esperando o time subir. */
  goalkeeperHoldUntil: number;
  /** Após rebater/espalmar, o goleiro fica em alerta e se reposiciona em velocidade. */
  goalkeeperAlertUntil: number;
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
  dribbleTouchRange: DribbleTouchRange | null;
  dribbleStartedAt: number;
  controlStartedAt: number;
}

export type PassTrajectory = "ground" | "air";
export type PassRange = "short" | "long";
export type PassTargeting = "feet" | "space";
export type DribbleStyle = "carry" | "knockOn" | "feint";
export type DribbleTouchRange = "short" | "medium" | "long";
export type DribbleRangeReason = "clearRunway" | "reducedForEnergy" | "reducedForRace" | "touchCooldown" | "insufficientRunway";

export type BallAction =
  | { kind: "none" }
  | {
    kind: "dribble";
    target: Vec2;
    style: DribbleStyle;
    touchRange?: DribbleTouchRange;
    runway?: number;
    carrierEta?: number;
    opponentEta?: number;
    rangeReason?: DribbleRangeReason;
  }
  | {
    kind: "shot";
    target: Vec2;
    targetHeight?: number;
    power: number;
    technique?: ShotTechnique;
    preparedPassId?: number;
    utility?: number;
    blocked?: boolean;
    goalkeeperGap?: number;
  }
  | {
    kind: "pass";
    receiverId: string;
    target: Vec2;
    trajectory: PassTrajectory;
    range: PassRange;
    targeting: PassTargeting;
    purpose?: PassPurpose;
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
  objective: PlayerObjective;
  preparedReceptionAction: PreparedReceptionAction | null;
  startedAt: number;
  expiresAt: number;
  possessionTeam: Team | null;
  controllerId: string | null;
  ballActorId: string | null;
  collectivePlanStartedAt: number;
  duringRestart: boolean;
}

export interface PreparedReceptionAction {
  passId: number;
  kind: PreparedReceptionKind;
  technique?: ShotTechnique;
  target: Vec2;
  receiverId?: string;
  validFrom: number;
  expiresAt: number;
  expectedHeight: number;
  expectedSpeed: number;
  score: number;
  fallback: "orientedControl" | "protectBall";
}

export interface PendingPass {
  id?: number;
  passerId: string;
  receiverId: string;
  team: Team;
  startedAt: number;
  trajectory: PassTrajectory;
  range: PassRange;
  targeting: PassTargeting;
  purpose?: PassPurpose;
  selectionReason: DecisionReason;
  target: Vec2;
  landingPoint: Vec2;
  expectedArrivalAt: number;
  receiverEta: number;
  opponentEta: number;
  expectedHeight?: number;
  expectedSpeed?: number;
}

export interface ActiveShot {
  id: number;
  shooterId: string;
  team: Team;
  startedAt: number;
  technique: ShotTechnique;
  target: Vec2;
  targetHeight: number;
  expectedArrivalAt: number;
  expectedSpeed: number;
  goalPoint: { position: Vec2; height: number };
  onTarget: boolean;
  goalkeeperTouched: boolean;
}

/**
 * A save is a commitment, not a guided trajectory. While `launchedAt` is null the keeper is
 * still repositioning on his feet and free to change his mind. Once he launches, the direction
 * is frozen and the body flies ballistically until it lands — reaching the ball or not.
 */
export interface GoalkeeperAttempt {
  source: GoalkeeperSource;
  sourceId: number;
  action: GoalkeeperAction;
  startedAt: number;
  reactionReadyAt: number;
  expiresAt: number;
  origin: Vec2;
  /** Where the keeper shuffles to while the launch window is still closed. */
  approachTarget: Vec2;
  launchedAt: number | null;
  /** Frozen at launch. Null while grounded. */
  launchDirection: Vec2 | null;
  launchSpeed: number;
  launchVertical: number;
  /** How long the body stays committed before it lands and the keeper can act again. */
  flightTime: number;
  /** Body radius plus arm span: the sphere that has to intersect the ball. */
  reachRadius: number;
  /** True when the keeper launched knowing he could not get there. */
  desperate: boolean;
  outcome: SaveOutcome | null;
  contactQuality: number | null;
  resolvedAt: number | null;
}

export type CognitiveEventType = "passCommitted" | "shotCommitted" | "ballTrajectoryChanged" | "controlClaimed" | "passResolved" | "saveResolved" | "possessionChanged";

export interface CognitiveEvent {
  id: number;
  time: number;
  type: CognitiveEventType;
  playerIds: string[] | null;
  passId?: number;
  shotId?: number;
  controllerId?: string;
  outcome?: "received" | "otherTeammate" | "intercepted" | "loose" | "out";
  saveOutcome?: SaveOutcome;
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
  saveAttempts: number;
  catches: number;
  parries: number;
  glancingTouches: number;
  highBallClaims: number;
  punches: number;
  passes: number;
  completedPasses: number;
  longPasses: number;
  completedLongPasses: number;
  aerialPasses: number;
  completedAerialPasses: number;
  feintsAttempted: number;
  feintsCompleted: number;
  sprintDribbles: number;
  shortSprintDribbles: number;
  mediumSprintDribbles: number;
  longSprintDribbles: number;
  crosses: number;
  cutbacks: number;
  throughBalls: number;
  firstTimeShots: number;
  headers: number;
  volleys: number;
  longShots: number;
  aggressiveBreaks: number;
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
  safetyPlayerId: string | null;
  safetySelectedAt: number;
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
  /** Segundo defensor que sai da linha para dividir na zona de perigo (Item 1). */
  secondPresserId: string | null;
  /** Lateral liberado a sobrepor como peça de triangulação no ataque (Item 4). */
  overlapFullBackId: string | null;
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
  outcome?: "catch" | "parry";
  height?: number;
  shotId?: number | null;
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
  cognitiveEvents: CognitiveEvent[];
  elapsed: number;
  kickoffTimer: number;
  ballControlTeam: Team | null;
  possessionTeam: Team | null;
  possessionCandidateTeam: Team | null;
  possessionCandidateSince: number;
  lastPossessionChangeAt: number;
  eventCounter: number;
  cognitiveEventCounter: number;
  passCounter: number;
  shotCounter: number;
  randomSeed: number;
  learningEnabled: boolean;
  pendingPass: PendingPass | null;
  activeShot: ActiveShot | null;
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
