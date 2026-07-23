// Deterministic match rules. Keep these values independent from presentation settings.
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
  goalHeight: 4.8,
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
  feintControlSettleTime: 0.28,
  controlAttemptCooldown: 0.2,
  heavyTouchCooldown: 0.32,
  passiveCollisionRadiusFactor: 0.78,
  playerBounce: 0.25,
  kickDistance: 4.15,
  kickCooldown: 0.42,
  maxBallSpeed: 108,
  walkSpeedFactor: 0.62,
  controlledSpeedFactor: 0.68,
  runSpeedFactor: 1.32,
  burstSpeedFactor: 2.05,
  burstAccelerationFactor: 2.25,
  burstDuration: 0.78,
  burstCooldown: 2.1,
  feintReactionDuration: 0.7,
  feintEvasionDuration: 0.72,
  ballCarryTurnRate: 20,
  ballActionAlignment: 0.64,
} as const;

// Duas barras de estamina. A longa (fôlego) só decai na partida e termina entre 50%–60%
// para um atleta médio; a volátil (piques) drena em disparada e recupera em ~4,5s parado.
// Custos são por unidade de distância percorrida, então "atravessar o campo" tem preço fixo.
export const STAMINA = {
  // --- Volátil (piques/explosões) ---
  // 0,0035/u × ~170u (gol a gol em disparada) ≈ 0,60 da barra.
  volatileBurstCostPerUnit: 0.0035,
  volatileRunCostPerUnit: 0.0009,
  // Do zero ao cheio em ~4,5s parado/trotando.
  volatileRecoveryPerSecond: 0.22,
  // --- Longa (fôlego de partida): só decai ---
  longBurstCostPerUnit: 0.00040,
  longRunCostPerUnit: 0.00022,
  longWalkCostPerUnit: 0.00010,
  longIdleCostPerSecond: 0.00092,
  longFloor: 0.2,
  // Escala global do desgaste longo, ajustada pela calibração (médio termina ~55%).
  longDrainScale: 0.215,
  // --- Interação longa → volátil (penalidade modesta) ---
  // Custo da volátil ×(1 + (1-longa)·slope); recarga ×(1 - (1-longa)·slope).
  fatigueVolatileCostSlope: 0.5,
  fatigueVolatileRecoverySlope: 0.35,
  // Queda sutil de velocidade de topo com o cansaço: vel ×(1 - (1-longa)·slope) → ~5% a 50%.
  fatigueSpeedSlope: 0.1,
  // Recuperação da volátil concedida a cada bola parada (a longa não recupera).
  volatileDeadBallRecovery: 0.34,
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
  collectivePlanSeconds: 2.2,
  predictionMinSeconds: 0.5,
  predictionMaxSeconds: 1.8,
} as const;

export const POSSESSION = {
  confirmationSeconds: 0.32,
  looseBallGraceSeconds: 0.55,
  phaseDebounceSeconds: 0.45,
  minimumPhaseSeconds: 0.75,
  finalThirdEnter: 0.68,
  finalThirdRearm: 0.58,
  finalThirdEntryCooldown: 7.5,
} as const;

export const COGNITION = {
  teamTickSeconds: 0.15,
  fastestThinkSeconds: 0.14,
  slowestThinkSeconds: 0.32,
  planDuration: {
    passing: 0.25,
    shooting: 0.25,
    receiving: 0.7,
    firstTime: 0.28,
    breaking: 0.65,
    carrying: 0.45,
    sprinting: 0.45,
    knockingOn: 0.45,
    feinting: 0.45,
    pressing: 0.65,
    marking: 0.65,
    covering: 0.65,
    supporting: 0.85,
    goalkeeping: 0.5,
    preparingSave: 0.18,
    diving: 0.32,
    jumping: 0.32,
    claimingHighBall: 0.4,
    recoveringSave: 0.35,
  },
} as const;

export const GOALKEEPING = {
  lowHeight: 0.35,
  mediumHeight: 1.8,
  highHeight: 3.8,
  minimumReaction: 0.08,
  maximumReaction: 0.28,
  catchThreshold: 0.62,
  parryThreshold: 0.25,
  catchRecovery: 0.56,
  diveRecovery: 0.92,
  maximumAttemptAge: 2.2,
  // Reach beyond the body, as a multiple of the keeper's own radius: one radius of arm.
  // Everything past that has to be earned by actually moving the body there.
  handReachFactor: 1,
  // Launch impulse of a dive, in field units per second. Comparable to a sprint
  // (PHYSICS.burstSpeedFactor puts a sprint near 26) because a dive is an explosive
  // push, not a teleport. It decays under diveDrag and cannot be steered.
  diveLaunchSpeed: 27,
  diveDrag: 1.45,
  // Vertical impulse and gravity of the jump, in goal-height units.
  jumpLaunchVertical: 5.6,
  jumpGravity: 15.5,
  // A dive with no vertical component still commits the body for this long.
  groundedDiveTime: 0.42,
  // Vertical reach of a grounded keeper (crossbar sits at FIELD.goalHeight).
  standingReach: 2.85,
  // How fast the keeper shuffles across the line while waiting for the launch window.
  approachSpeedFactor: 1.25,
  // If the window never opens, launch anyway this close to arrival and come up short.
  desperationLead: 0.07,
  // Upper bound on how far ahead the launch solver looks along the ball path.
  launchSearchStep: 0.02,
} as const;

export const ANALYTICS_GRID = {
  columns: 12,
  rows: 8,
  sampleInterval: 0.5,
} as const;
