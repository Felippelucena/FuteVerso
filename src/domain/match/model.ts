import type { PlayerMemory, PlayerProfile } from "../roster/model";
import type { PlayerInstruction, TeamDirectives } from "../tactics/model";
import type { TacticalSlotId } from "../tactics/slots";
import type { AttackChannel, BuildUpStyle, DefensiveBlock, PressTrigger } from "../tactics/vocabulary";
import type { MatchRules } from "./rules";
import type { Team, Vec2 } from "../shared/model";

export type { MatchRules, MatchRulesOptions, StoppageRules } from "./rules";
export type { Team, Vec2 } from "../shared/model";
export type {
  PlayerCareerStats,
  PlayerMemory,
  PlayerMentalAttributes,
  PlayerPolicy,
  PlayerPosition,
  PlayerProfile,
  PlayerRole,
  PlayerSkills,
} from "../roster/model";
// O vocabulário tático é declarado por domain/tactics, que é quem oferece essas opções ao
// treinador; o motor as consome e reexporta para manter sua superfície pública intacta.
export type { AttackChannel, BuildUpStyle, DefensiveBlock, PressTrigger } from "../tactics/vocabulary";
export type { PlayerInstruction, TacticalMentality, TeamDirectives } from "../tactics/model";
export type { TacticalSlotId } from "../tactics/slots";

/**
 * O que o plano tático entrega ao motor sobre um jogador. O motor não conhece
 * `TeamTacticalPlan`: recebe o resultado já resolvido, participante a participante.
 */
export interface MatchParticipant {
  team: Team;
  lineupIndex: number;
  profile: PlayerProfile;
  memory: PlayerMemory;
  /** Camisa vestida nesta partida. Vem do contrato, não do jogador. */
  shirtNumber: number;
  /** Slot do plano tático em que o jogador foi escalado; define a âncora dele em campo. */
  slotId: TacticalSlotId;
  /**
   * Encaixe do jogador no slot (0..1), vindo de domain/tactics/position-fit. 1 é posição
   * natural; abaixo disso o atleta está improvisando e rende menos.
   */
  positionFit: number;
  /** Instrução individual do treinador para este slot. */
  instruction: PlayerInstruction;
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
  /** As diretrizes com que cada lado entra em campo. Ver `TeamDirectives`. */
  teams: Record<Team, TeamDirectives>;
  /** O regulamento desta partida. Ausente vale `DEFAULT_MATCH_RULES`. Ver `rules.ts`. */
  rules?: MatchRules;
}

/**
 * Ajuste de meio de jogo — o que o treinador grita da beira. Diretrizes e instruções valem na
 * hora, e os onze podem trocar de posição entre si. Quem entra e quem sai, não: isso é
 * substituição, outra regra, que o motor ainda não tem.
 */
export interface TeamAdjustment {
  directives: TeamDirectives;
  /** Novo slot de quem já está em campo, por id. Quem não aparecer fica onde está. */
  slotByPlayer: Record<string, TacticalSlotId>;
  instructionBySlot: Partial<Record<TacticalSlotId, PlayerInstruction>>;
}

export type TeamPosture = "inPossession" | "outOfPossession";
export type InPossessionPhase = "buildUp" | "progression" | "finalThird" | "counterAttack";
export type OutOfPossessionPhase = "highPress" | "midBlock" | "lowBlock" | "counterPress" | "recovery";
export type TacticalPhase = InPossessionPhase | OutOfPossessionPhase;
export type PassPurpose = "feet" | "throughBall" | "cross" | "cutback" | "switch" | "layoff";
export type ShotTechnique = "placed" | "power" | "volley" | "header" | "redirect";
export type GoalkeeperAction = "standingSave" | "lowDive" | "highDive" | "verticalJump" | "aerialClaim" | "punch";
/** Origem da tentativa. Não é o rótulo do passe: é a régua do lance (mão na alta, pé na rasteira). */
export type GoalkeeperSource = "shot" | "aerial" | "loose";
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
  | "holdZone"
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
  shirtNumber: number;
  /** Slot do plano tático. Manda na âncora e na zona que o jogador defende. */
  slotId: TacticalSlotId;
  /** Encaixe no slot (0..1). Abaixo de 1, o jogador está improvisando. */
  positionFit: number;
  instruction: PlayerInstruction;
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
  /**
   * Janela em que este defensor foi passado por uma finta: até lá ele atravessa o driblador em vez
   * de colidir, e não disputa a bola. Mora no defensor (e não na partida) porque é um efeito que
   * ele sofre — num 11x11 duas fintas simultâneas em lados opostos do campo se atropelariam num
   * slot global único.
   */
  evadedUntil: number;
  evadedByAttackerId: string | null;
  /**
   * Onde a bola está no corpo deste jogador enquanto ele a controla: ângulo relativo ao `facing`,
   * 0 = à frente. Negativo/positivo é o pé de um lado ou do outro. É o que permite pôr o corpo
   * entre a bola e o marcador.
   */
  ballAnchor: number;
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
  dribbleOwnerId: string | null;
  dribbleTarget: Vec2 | null;
  dribbleStyle: DribbleStyle | null;
  dribbleTouchRange: DribbleTouchRange | null;
  dribbleStartedAt: number;
  controlStartedAt: number;
}

/**
 * Em que estado a bola está, do ponto de vista de quem joga:
 *
 * - `controlled` — no pé de alguém, sob a mola do controle;
 * - `owned` — solta, mas alguém chega nela com folga (a bola adiantada num pique, o passe
 *   íntegro a caminho do destinatário);
 * - `contested` — solta e a corrida está em aberto, seja porque dois chegam juntos, seja
 *   porque ninguém chega tão cedo.
 *
 * Substitui o "quem tocou por último", que confundia os três num id só e fazia o time inteiro
 * tratar uma bola adiantada — ou desviada — como se estivesse colada no pé de alguém.
 */
export type BallPhase = "controlled" | "owned" | "contested";

export interface BallContender {
  playerId: string;
  team: Team;
  /** Segundos até ele alcançar o ponto de contato. */
  eta: number;
}

/** Ver `runtime/ball-situation`. Recalculada uma vez por quadro e lida por todo mundo. */
export interface BallSituation {
  phase: BallPhase;
  /** Onde o próximo toque acontece — a posição da bola, quando ela já está num pé. */
  contactPoint: Vec2;
  /** Segundos até esse toque. */
  contactIn: number;
  /** Todo mundo apto a disputá-la, do mais rápido ao mais lento. `favourite` é o primeiro. */
  contenders: BallContender[];
  /** Quem chega primeiro. Nulo só quando não há ninguém apto a tocá-la. */
  favourite: BallContender | null;
  /** O melhor do outro time, quando algum entra no páreo. */
  rival: BallContender | null;
  /** `rival.eta − favourite.eta`. Grande = lance resolvido; perto de zero = dividida. */
  margin: number;
}

export type PassTrajectory = "ground" | "air";
export type PassRange = "short" | "long";
export type PassTargeting = "feet" | "space";
export type DribbleStyle = "carry" | "knockOn" | "feint" | "knockPast";
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
  /**
   * Quanto do voo a bola passou ao alcance de um jogador. A rasteira vale o voo inteiro; a
   * erguida, só as pontas. É daqui que sai o prazo em que o passe ainda pode se completar —
   * antes eram quatro constantes por variante que não conheciam a trajetória real.
   *
   * Opcional como os vizinhos: o cenário montado à mão não precisa conhecê-lo, e a ausência
   * significa "alcançável o voo inteiro", que é a verdade de qualquer bola rasteira.
   */
  reachableSeconds?: number;
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

/**
 * Uma disputa em curso pela bola. O duelo deixou de ser um `if` de um quadro e virou uma coisa
 * com duração: enquanto ela existe, os desafiantes empurram a bola para fora do pé do portador e
 * o controle dele a puxa de volta, quadro a quadro. Ninguém escreve a posição da bola — o
 * desfecho é a corrida entre as duas forças, e quem pega a sobra é o caminho normal de bola solta.
 *
 * Única por partida porque só há uma bola.
 */
export interface Engagement {
  holderId: string;
  challengerIds: string[];
  startedAt: number;
  /** Quanto a bola já foi arrancada do pé, em unidades. */
  advantage: number;
  /**
   * A bola chegou a ser arrancada do pé durante esta disputa. É o que separa desarme de entrega:
   * quem consegue passar sob pressão nunca sai do controle, e não deve creditar desarme a ninguém.
   */
  pried: boolean;
  /** Quem entrou de forma imprudente nesta disputa, e em quem. Preenchidos ao apitar a falta. */
  recklessById: string | null;
  victimId: string | null;
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
  fouls: number;
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
  /** Diretrizes do treinador para este lado. Constantes durante a partida. */
  directives: TeamDirectives;
  phase: TacticalPhase;
  phaseStartedAt: number;
  candidatePhase: TacticalPhase;
  candidatePhaseStartedAt: number;
  shape: TeamShape;
  finalThirdLatched: boolean;
  lastFinalThirdEntryAt: number;
  collectivePlan: TeamCollectivePlan | null;
  /** Último homem da atualização anterior. Só existe para dar histerese ao rest defense. */
  safetyPlayerId: string | null;
}

/**
 * O que um jogador está encarregado de fazer agora. É a entrega do nível coletivo para o
 * individual: quem decide movimento e ação lê o dever, em vez de redescobrir o trabalho a
 * partir de booleanos avulsos e da função do atleta.
 */
export type AssignmentDuty =
  // Com a bola nos pés (ou a caminho deles).
  | "carry"
  | "receive"
  // Sem a bola, com o time em posse.
  | "runInBehind"
  | "support"
  | "width"
  | "overlap"
  | "restDefense"
  /**
   * A tabela: quem se oferece ATRÁS da linha da bola para ela voltar e sair de novo. Era o
   * buraco da forma — todo apoio vivia à frente do portador (de +7 a +35 m) e a única opção
   * atrás era o rest defense, a 19-25 m e com alvo próprio. Entre um e outro não havia ninguém
   * encarregado de se oferecer, e por isso a triangulação não tinha como acontecer.
   */
  | "recycle"
  // Sem a bola, com o time fora de posse.
  | "press"
  | "trackRunner"
  | "holdLine"
  // Em qualquer momento.
  | "goalkeep";

/** Célula da grade tática 7x5 — as mesmas coordenadas de `TacticalSlot.zone`. */
export interface AssignmentZone {
  column: number;
  row: number;
}

/**
 * Onde a forma do time está agora. A formação desenha a estrutura (quem fica à frente de quem);
 * a colocação diz onde essa estrutura inteira se encontra no gramado neste instante. É o que
 * permite os dois times ocuparem a mesma região do campo e se misturarem, em vez de cada um
 * viver na sua metade.
 */
export interface TeamShapePlacement {
  /** Profundidade da linha de campo mais recuada, em % da largura, a partir do próprio gol. */
  lineHeight: number;
  /** Fração da altura do campo que a formação abre, de 0 (fila indiana) a 1 (linha a linha). */
  width: number;
  /**
   * Multiplicador da distância entre as linhas. 1 é a forma desenhada na escalação; abaixo disso
   * o time encurta — um bloco defendendo a própria área tem metade da profundidade de um time
   * esticado saindo para o jogo.
   */
  depth: number;
  /**
   * Deslize lateral do bloco inteiro, em fração da altura do campo: para o canal de ataque com a
   * bola, para o lado da bola sem ela. Contínuo, e não um passo de linha na grade — o passo
   * saturava na borda e esmagava o time contra uma lateral (ver `cellLane`).
   */
  lateralShift: number;
  /**
   * Profundidade máxima de qualquer célula, em % da largura. Para quem ataca é a última linha
   * adversária: é a restrição posicional que o impedimento cria, e sem ela os atacantes vivem
   * atrás da defesa esperando a bola longa. O motor não apita impedimento — impede a posição.
   */
  forwardLimit: number;
}

export interface PlayerAssignment {
  duty: AssignmentDuty;
  /**
   * Ordem dentro do dever: 0 é quem manda nele — o primeiro pressionador, o último homem, o
   * corredor de referência. Substitui os ids únicos que o plano coletivo nomeava um a um e
   * mantém a singularidade onde ela importa, sem impedir que o dever seja de vários.
   */
  priority: number;
  /** Célula que este jogador ocupa agora. Distinta da de todo companheiro. */
  zone: AssignmentZone;
  /** Alvo humano quando o dever é relacional (marcar, pressionar, receber). */
  targetPlayerId: string | null;
  /** 0..1 — quanto o jogador pode se afastar da célula antes de estar fora de posição. */
  freedom: number;
  /**
   * 0..1 — quanto o jogador estica para fora da forma para fixar o próprio marcador e manter
   * aberto o espaço que um vizinho vai atacar. É o ponta que abre na linha lateral porque viu
   * o meia entrando por dentro.
   */
  lateralPull: number;
  rationale: DecisionReason;
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
  /** Gatilho de pressão em vigor, ou nulo quando o que a situação propôs não está habilitado. */
  pressTrigger: PressTrigger | null;
  /** Onde a forma do time está agora: altura da linha mais recuada e largura aberta. */
  placement: TeamShapePlacement;
  /**
   * Incumbência de cada jogador do time, indexada por id. É uma função **total** sobre os onze
   * — nenhum jogador fica sem dever — e duas incumbências nunca apontam para a mesma célula da
   * grade. Essas duas invariantes são o que impede um jogador de ficar perdido em campo.
   */
  assignments: Record<string, PlayerAssignment>;
}

interface MatchEventBase {
  id: number;
  time: number;
}

export interface MatchStartedEvent extends MatchEventBase {
  type: "match-started";
}

export interface HalfStartedEvent extends MatchEventBase {
  type: "half-started";
  half: number;
  kickoffTeam: Team;
}

export interface HalfEndedEvent extends MatchEventBase {
  type: "half-ended";
  half: number;
  /** Acréscimo cumprido: segundos além do fim nominal do tempo quando o apito soou. */
  addedTime: number;
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
  restartKind: "throwIn" | "corner" | "goalKick" | "freeKick";
}

/**
 * O evento carrega a geometria do julgamento — a linha e o instante do passe — porque é ela que
 * a transmissão rebobina para mostrar. O motor não guarda isso para desenhar: guarda porque é o
 * que descreve a infração.
 */
export interface OffsideCalledEvent extends MatchEventBase {
  type: "offside-called";
  /** Time que cometeu o impedimento. O tiro livre indireto sai para o adversário. */
  team: Team;
  playerId: string;
  lineProgress: number;
  passAt: number;
}

export interface FoulCalledEvent extends MatchEventBase {
  type: "foul-called";
  /** Time que cometeu a falta. O tiro livre sai para o adversário. */
  team: Team;
  playerId: string;
}

export interface GoalScoredEvent extends MatchEventBase {
  type: "goal-scored";
  team: Team;
  playerId: string | null;
  origin: "shot" | "pass" | "dribble";
}

export interface MatchFinishedEvent extends MatchEventBase {
  type: "match-finished";
  /** Acréscimo cumprido: segundos além do fim nominal da partida quando o apito final soou. */
  addedTime: number;
}

/**
 * Placar de acréscimos: quantos segundos o quarto árbitro anunciou ao esgotar o tempo nominal.
 * `final` distingue o fim do último tempo (fim de jogo) do intervalo.
 */
export interface AddedTimeSignalledEvent extends MatchEventBase {
  type: "added-time-signalled";
  half: number;
  seconds: number;
  final: boolean;
}

export type MatchEvent =
  | MatchStartedEvent
  | HalfStartedEvent
  | HalfEndedEvent
  | SaveMadeEvent
  | ShotTakenEvent
  | RestartAwardedEvent
  | OffsideCalledEvent
  | FoulCalledEvent
  | GoalScoredEvent
  | AddedTimeSignalledEvent
  | MatchFinishedEvent;

type WithoutEventMetadata<T> = T extends MatchEvent ? Omit<T, "id" | "time"> : never;
export type MatchEventData = WithoutEventMetadata<MatchEvent>;

/**
 * Tipos de bola parada. `kickoff` é a saída de bola (início de tempo, pós-gol); os demais são os
 * reinícios com a bola saindo pela linha, mais o tiro livre indireto do impedimento.
 */
export type RestartKind = "kickoff" | "throwIn" | "corner" | "goalKick" | "freeKick";

/**
 * Bola parada em andamento — a cobrança caminhada, não um teleporte. Enquanto existe, valem as
 * restrições da Regra 8:
 *
 * - antes de a bola entrar em jogo (`ballInPlay` falso), ela fica parada no ponto e ninguém a
 *   disputa: o cobrador ainda está caminhando até ela;
 * - depois de cobrada, quem cobrou não pode tocá-la de novo até outro jogador tocar — é isto que
 *   obriga o primeiro toque a ser um passe. O estado morre quando qualquer outro jogador toca.
 */
export interface RestartState {
  kind: RestartKind;
  /** Time que cobra o reinício. */
  team: Team;
  /** Quem cobra: goleiro no tiro de meta, cobrador mais avançado na saída, mais próximo nos demais. */
  takerId: string;
  /** Onde a bola é posta e fica parada até a cobrança. */
  spot: Vec2;
  /** Onde o cobrador para (no lateral/escanteio, do lado de fora do campo). */
  takerStand: Vec2;
  /** Direção para onde o cobrador olha; orienta a bola no pé quando a posse é entregue. */
  facing: Vec2;
  /** `state.elapsed` no início da sequência: base do tempo mínimo de preparo e da trava anti-deadlock. */
  startedAt: number;
  /** Falso enquanto a bola está parada e o cobrador caminha; verdadeiro quando ele assume a posse. */
  ballInPlay: boolean;
}

/**
 * Acréscimos do tempo em curso. `accrued` soma o tempo de bola morta; quando o tempo nominal mais
 * o acréscimo se esgota, `awaitingEnd` liga e o apito espera a próxima bola morta ou o fim do lance.
 */
export interface StoppageState {
  /** Segundos de bola morta acumulados no tempo atual (a serem devolvidos como acréscimo). */
  accrued: number;
  /** Tempo nominal + acréscimo esgotado: o apito aguarda um momento de bola morta / fim de lance. */
  awaitingEnd: boolean;
  /** `state.elapsed` quando a janela de acréscimo abriu (base do teto absoluto). */
  pendingSince: number | null;
  /** Acréscimo anunciado (o que foi ao placar) quando a janela abriu. */
  announced: number | null;
  /** Quem atacava quando a janela abriu: se perder a posse com clareza, o lance se desfez. */
  attackerAtOpen: Team | null;
}

/**
 * Vigilância de impedimento (Lei 11) armada por um passe: quem estava em posição de impedimento
 * no instante do toque, e onde estava a linha. Vive enquanto o passe está no ar; morre quando
 * alguém encosta na bola — apitando a infração se for um dos vigiados, ou se dissolvendo se for
 * qualquer outro. Ver `runtime/offside`.
 */
export interface OffsideWatch {
  team: Team;
  passId: number;
  offenders: string[];
  lineProgress: number;
  /** Instante do julgamento: quando a bola saiu do pé. É o único frame em que a linha significa algo. */
  passAt: number;
}

/**
 * Impedimento apitado e ainda não reiniciado: a jogada fica parada até `resolveAt`, quando sai o
 * tiro livre indireto. É o beat do apito, igual ao da falta — a linha da bandeira não vive aqui,
 * porque ela só faz sentido no instante do passe (a transmissão a mostra no replay).
 */
export interface OffsideCall {
  /** Time que cometeu a infração (o que atacava). O tiro livre é do adversário. */
  team: Team;
  offenderId: string;
  /** Ponto da infração: onde o impedido se envolveu na jogada. É de onde sai o reinício. */
  spot: Vec2;
  calledAt: number;
  resolveAt: number;
}

/**
 * Lei 12 — falta apitada. Mesmo desenho do impedimento: congela a jogada por um instante e sai o
 * tiro livre no ponto, para o time que sofreu. A imprudência é medida na disputa: entrar em
 * velocidade no corpo, e não na bola.
 */
export interface FoulCall {
  /** Time que cometeu a falta. O tiro livre é do adversário. */
  team: Team;
  offenderId: string;
  victimId: string;
  spot: Vec2;
  calledAt: number;
  resolveAt: number;
}

export interface MatchState {
  /** O regulamento desta partida: duração, acréscimos e o que vale. Constante durante o jogo. */
  rules: MatchRules;
  players: PlayerRuntime[];
  ball: Ball;
  stats: Record<Team, TeamStats>;
  events: MatchEvent[];
  cognitiveEvents: CognitiveEvent[];
  elapsed: number;
  /** Tempo em curso, de 1 a `MATCH_HALVES`. O relógio (`elapsed`) não zera entre eles. */
  half: number;
  /** Bola parada em andamento (cobrança caminhada), ou nula em jogo corrido. Unifica a antiga saída de bola. */
  restart: RestartState | null;
  /**
   * Quem alcança a bola primeiro, e com que folga. Derivada da posição dos corpos e da rota da
   * bola a cada quadro, como `tactics[].shape` — não é estado que alguém escreve.
   */
  ballSituation: BallSituation;
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
  /** Passe sob vigilância de impedimento, ou nulo quando não há ninguém em posição ilegal. */
  offsideWatch: OffsideWatch | null;
  /** Impedimento apitado, congelando a jogada até o tiro livre; nulo em jogo normal. */
  offsideCall: OffsideCall | null;
  /** Falta apitada, congelando a jogada até o tiro livre; nulo em jogo normal. */
  foulCall: FoulCall | null;
  /**
   * Verdadeiro logo após um lateral, escanteio ou tiro de meta: o primeiro passe (a cobrança em
   * si) não é julgado por impedimento — não há impedimento direto desses reinícios. Cai no toque
   * seguinte, quando o jogo volta a ser corrido.
   */
  offsideExemptRestart: boolean;
  /** Disputa em curso pela bola, ou nulo quando o portador está livre. */
  engagement: Engagement | null;
  lastAssist: { playerId: string; team: Team; time: number } | null;
  previousControlledTeam: Team | null;
  lastControlledTeam: Team | null;
  controlChangedAt: number;
  contestedSeconds: number;
  tactics: Record<Team, TeamTacticalState>;
  heatmaps: Record<Team, number[]>;
  passNetwork: Record<Team, Record<string, number>>;
  nextAnalyticsSample: number;
  /** `elapsed` do último quadro percebido. Ver `COGNITION.perceptionSeconds`. */
  perceivedAt: number;
  nextCognitionAt: number;
  finished: boolean;
  stoppage: StoppageState;
}
