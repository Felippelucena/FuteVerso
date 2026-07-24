// Deterministic match rules. Keep these values independent from presentation settings.
const FIELD_SCALE = 2.5;
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
/**
 * Corrida de referência para calibrar a estamina: gol a gol, descontando o espaço atrás de
 * cada linha de fundo, onde ninguém dispara. Tudo que mede desgaste por distância se apoia
 * nela, de forma que redimensionar o gramado não mude o custo de atravessar o campo.
 */
export const GOAL_TO_GOAL_SPRINT = fieldWidth - 10;

// Fração da barra volátil consumida numa travessia gol a gol, por ritmo. São estes os
// números de game design; o custo por unidade percorrida sai deles.
//
// Cuidado ao mexer: nenhum jogador atravessa o campo num pique só (burstDuration cobre ~8%
// do gramado), então esta é uma régua de calibragem, não uma corrida que acontece em jogo.
// O que se sente em campo é o ciclo pique/espera contra volatileRecoveryPerSecond — ver a
// faixa de mínimos verificada em volatile-probe.test.ts.
const VOLATILE_BURST_PER_CROSSING = 0.7;
const VOLATILE_RUN_PER_CROSSING = 0.18;

export const STAMINA = {
  // --- Volátil (piques/explosões) ---
  // Derivado do campo: uma travessia gol a gol custa sempre a mesma fatia da barra, tenha o
  // gramado a medida do 5x5 ou a do 11x11. Antes o custo era fixo por unidade e crescer o
  // campo encarecia cada corrida sem ninguém perceber.
  volatileBurstCostPerUnit: VOLATILE_BURST_PER_CROSSING / GOAL_TO_GOAL_SPRINT,
  volatileRunCostPerUnit: VOLATILE_RUN_PER_CROSSING / GOAL_TO_GOAL_SPRINT,
  // Do zero ao cheio em ~4,5s parado/trotando.
  volatileRecoveryPerSecond: 0.22,
  // --- Longa (fôlego de partida): só decai ---
  longBurstCostPerUnit: 0.00040,
  longRunCostPerUnit: 0.00022,
  longWalkCostPerUnit: 0.00010,
  longIdleCostPerSecond: 0.00092,
  longFloor: 0.2,
  // Escala global do desgaste longo, ajustada pela calibração (médio termina ~55%).
  // ATENÇÃO: ao contrário da volátil, a longa ainda é custo fixo por unidade percorrida —
  // este número é o knob manual que absorve mudanças de tamanho do campo. Redimensionar o
  // gramado exige reajustá-lo até a média de fim de jogo voltar à faixa de 50% a 60%.
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
    holdingBall: 0.3,
  },
} as const;

export const GOALKEEPING = {
  lowHeight: 0.35,
  mediumHeight: 1.8,
  highHeight: 3.8,
  // Reflexo do goleiro depois de ler o chute. Goleiro é reação rápida: mesmo o mais fraco
  // dispara em ~0,16s e o de elite em ~0,05s — nada de ficar "acordando" enquanto a bola passa.
  minimumReaction: 0.05,
  maximumReaction: 0.16,
  catchThreshold: 0.62,
  parryThreshold: 0.25,
  catchRecovery: 0.56,
  diveRecovery: 0.92,
  maximumAttemptAge: 2.2,
  // Reach beyond the body, as a multiple of the keeper's own radius: one radius of arm.
  // Everything past that has to be earned by actually moving the body there.
  handReachFactor: 1,
  // Launch impulse of a dive, in field units per second. A touch beyond a sprint
  // (PHYSICS.burstSpeedFactor puts a sprint near 26) because a dive is an explosive
  // whole-body lunge, not a teleport. It decays under diveDrag and cannot be steered.
  // Dimensionado para um mergulho pleno cobrir na casa de 4× o raio do goleiro além do
  // alcance de braço na janela típica de um chute — um voo de verdade, não um estica.
  diveLaunchSpeed: 31, 
  diveDrag: 1.4,
  // Tempo de voo do mergulho, do impulso até o pouso, quando a bola está no alcance do corpo.
  jumpLaunchVertical: 5.6,
  // Gravidade durante o salto, em unidades de altura do gol.
  jumpGravity: 15.5,
  // Tempo de voo do salto, do impulso até o pouso, quando a bola está no alcance do corpo.
  groundedDiveTime: 0.42,
  // Alcance do goleiro em pé, do chão até a ponta dos dedos, em unidades de altura do gol.
  standingReach: 2.85,
  // How fast the keeper shuffles across the line while waiting for the launch window.
  approachSpeedFactor: 1.25,
  // If the window never opens, launch anyway this close to arrival and come up short.
  desperationLead: 0.07,
  // Upper bound on how far ahead the launch solver looks along the ball path.
  launchSearchStep: 0.02,
  // Margem de segurança do commit: o goleiro salta assim que faltar só este tempo de
  // sobra para o mergulho ainda chegar, em vez de esperar o último tick possível. Folgado
  // de propósito para o corpo decolar logo após o chute (mergulho pleno) em vez de ficar
  // ajustando os pés enquanto a bola passa.
  commitLead: 0.24,
  // O impulso do mergulho é dimensionado para pousar no ponto de interceptação (a
  // perpendicular à rota da bola), limitado a este múltiplo do diveLaunchSpeed.
  maxDiveSpeedFactor: 1,
  // Bola solta perigosa na própria área: o goleiro sai/mergulha para recolher mesmo sem ser
  // um chute a gol. Só dispara quando a bola está lenta, um adversário ameaça recolhê-la, e o
  // goleiro chega antes dele — senão fica na linha e deixa para a defesa.
  looseClaimMaxBallSpeed: 46,
  looseClaimBeatMargin: 1.4,
  looseClaimThreatRange: 16,
  // Depois de agarrar nas mãos, segura a posse (imune a desarme) por este tempo, esperando o
  // time se reposicionar antes de distribuir — ignorando o marcador que pressiona.
  secureHoldSeconds: 1.9,
  // Depois de espalmar/rebater, fica em alerta e se reposiciona em velocidade por este tempo.
  alertSeconds: 2.6,
  // Velocidade de reposicionamento durante o alerta (corrida, não a corridinha de ajuste).
  alertSpeedFactor: 1.85,
} as const;

// Comportamento defensivo além do presser único. Frações são múltiplos de FIELD.width/height,
// resolvidas em quem consome (o config mantém o vocabulário absoluto do resto do motor).
export const DEFENSE = {
  // --- Item 1: segundo engajador na zona de perigo ---
  // Só quando a bola do adversário está no nosso terço defensivo (progresso 0 = nosso gol).
  dangerZoneProgress: 0.33,
  // O 1º presser precisa estar ao menos isto longe da bola (fração de width) para o portador
  // contar como "sem pressão real" — espelha o raio de pressão fieldX(7)/width = 0,07.
  secondPresserUnpressuredGap: 0.07,
  // Não puxar um zagueiro que esteja mais longe que isto (fração de width) do portador.
  secondPresserEngageRange: 0.16,
  // --- Item 4: recomposição garantida do zagueiro adiantado ---
  // Quão à frente do próprio anchor (fração de width) conta como "adiantado".
  recoverAdvancedGap: 0.07,
  // Janela após perder a posse em que a recomposição em disparada é garantida (só para a zaga).
  recoverWindow: 3.5,
  // Fora dessa janela, qualquer um recompõe em disparada desde que tenha pique sobrando.
  recoverMinEnergy: 0.35,
  // Teto de duração do pique de recomposição.
  recoverBurstMax: 1.6,
  // Risco mínimo do plano coletivo para liberar o lateral a sobrepor no ataque.
  overlapMinRisk: 0.5,
  // --- Marcação zonal ---
  // Raio (fração de width) em que um adversário conta como "dentro da minha zona". Acima disso
  // o defensor sustenta a célula e não encosta em ninguém: é o que impede a marcação zonal de
  // virar perseguição individual disfarçada.
  zoneRadius: 0.14,
} as const;

// Desfechos de contato (tabela resolveContact). Os gates de "roubo limpo" exigem momento real
// do defensor; sem eles o duelo cai no desfecho neutro (pokeLoose), idêntico ao histórico.
export const DUEL = {
  // Roubo com agressividade controlada (defensor segue com a bola freando).
  cleanStealMinClosing: 6, // pique do defensor ATRAVÉS do portador (u/s) mínimo
  cleanStealMarginGate: 0.12, // margem de vitória no duelo além do limiar base (0,04)
  cleanStealCarryFactor: 0.6, // fração da velocidade do defensor levada à bola (freada)
  cleanStealMinCarry: 8,
  cleanStealMaxCarry: 22,
  cleanStealSpitBack: 5, // impulso que cospe o atacante no contrário do toque
  // Balão baixo por cima da dividida (o atacante venceu o contato).
  knockPastProbe: 0.08, // até onde sondar espaço atrás do defensor (fração de width)
  knockPastMinSpace: 0.045, // espaço livre mínimo atrás (fração de width) para valer a pena
  knockPastSpeed: 26,
  knockPastLift: 7, // apex ≈ v²/(2·gravity) ≈ 0,85 < 1,8 → bola segue jogável
  // Finta/contato só engajam quando os raios dos jogadores quase colidem: distância <
  // (raio + raio + isto). Antes a finta disparava a ~18u (espaço vazio); agora ~6,5u.
  feintEngageMargin: 2,
} as const;

// Lookahead de condução→finalização: valoriza conduzir para abrir um chute melhor.
export const CONDUCT = {
  carryShotWeight: 0.6, // peso do bônus na utilidade de drible
  carryShotMinGain: 0.3, // só conta se o chute futuro superar o atual por esta margem
  carryShotCap: 1.2, // teto do ganho considerado
  carryShotMaxDistance: 20, // o chute futuro precisa ser de dentro de fieldX(20) para valer
} as const;

export const ANALYTICS_GRID = {
  columns: 12,
  rows: 8,
  sampleInterval: 0.5,
} as const;
