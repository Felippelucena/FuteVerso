const FIELD_SCALE = 1.8;
const GOAL_SCALE = 1.4;
const fieldWidth = 100 * FIELD_SCALE;
const fieldHeight = 60 * FIELD_SCALE;
const goalOpening = 24 * GOAL_SCALE;

export const FIELD = {
  width: fieldWidth,
  height: fieldHeight,
  goalTop: (fieldHeight - goalOpening) / 2,
  goalBottom: (fieldHeight + goalOpening) / 2,
  goalDepth: 5 * GOAL_SCALE,
  penaltyDepth: 16 * GOAL_SCALE,
  penaltyWidth: 34 * GOAL_SCALE,
  goalAreaDepth: 7 * GOAL_SCALE,
  playerRadius: 2.25,
  ballRadius: 1.15,
} as const;

export const PHYSICS = {
  playerDrag: 2.35,
  ballDrag: 0.72,
  airBallDrag: 0.16,
  ballBounce: 0.38,
  landingFriction: 0.86,
  ballPlayerRestitution: 0.42,
  gravity: 29,
  controlSpring: 14,
  controlledBallRepositionSpeed: 10,
  firstTouchSettleTime: 0.055,
  playerBounce: 0.25,
  kickDistance: 4.15,
  kickCooldown: 0.42,
  maxBallSpeed: 88,
  controlledSpeedFactor: 0.78,
  controlledSprintSpeedFactor: 0.94,
  runSpeedFactor: 1.48,
  burstSpeedFactor: 1.85,
  burstDuration: 0.62,
  burstCooldown: 1.75,
  feintReactionDuration: 0.52,
  ballCarryTurnRate: 20,
  ballActionAlignment: 0.64,
} as const;

export const FIXED_STEP = 1 / 120;
export const MATCH_DURATION = 10 * 60;
export const DEFAULT_MATCH_SEED = 0x4a39b70d;

export const TACTICS = {
  counterAttackWindow: 4.5,
  counterPressWindow: 3.2,
  recoveryWindow: 7,
  finalThirdStart: 0.68,
  buildUpEnd: 0.34,
} as const;

export const ANALYTICS_GRID = {
  columns: 12,
  rows: 8,
  sampleInterval: 0.5,
} as const;
