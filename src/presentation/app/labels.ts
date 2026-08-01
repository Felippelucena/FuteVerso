import { HALF_DURATION } from "../../domain/match/config";
import type { AssignmentDuty, DecisionReason, DribbleRangeReason, DribbleTouchRange, MatchState, MovementPace, PassPurpose, ShotTechnique, TacticalPhase } from "../../domain/match/model";
import type { PlayerPosition } from "../../domain/roster/model";
import type { TacticalDuty } from "../../domain/tactics/roles";
import type { Team } from "../../domain/shared/model";
import type {
  FreedomInstruction,
  MarkingInstruction,
  SupportInstruction,
  TacticalMentality,
} from "../../domain/tactics/model";
import type { PositionFitLevel } from "../../domain/tactics/position-fit";
import type { RoleFitLevel } from "../../domain/tactics/role-fit";
import type { TacticalPlanIssueKind } from "../../domain/tactics/rules";
import type { BuildUpStyle, DefensiveBlock, PressTrigger } from "../../domain/tactics/vocabulary";

export const POSITION_LABELS: Record<PlayerPosition, string> = {
  goalkeeper: "Goleiro",
  centerBack: "Zagueiro",
  rightBack: "Lateral-direito",
  leftBack: "Lateral-esquerdo",
  defensiveMid: "Volante",
  centerMid: "Meia-central",
  rightMid: "Meia-direita",
  leftMid: "Meia-esquerda",
  attackingMid: "Meia-ofensivo",
  rightWing: "Ponta-direita",
  leftWing: "Ponta-esquerda",
  striker: "Atacante",
};

/** Siglas do campo tático e das listagens compactas. */
export const POSITION_SHORT_LABELS: Record<PlayerPosition, string> = {
  goalkeeper: "GOL",
  centerBack: "ZAG",
  rightBack: "LD",
  leftBack: "LE",
  defensiveMid: "VOL",
  centerMid: "MC",
  rightMid: "MD",
  leftMid: "ME",
  attackingMid: "MEI",
  rightWing: "PD",
  leftWing: "PE",
  striker: "ATA",
};

/**
 * O dever tático, no eixo do FM. Os rótulos das FUNÇÕES não moram aqui: cada uma já carrega o seu em
 * `domain/tactics/roles`, do mesmo jeito que cada slot carrega a própria sigla — o catálogo é a fonte
 * única, e duplicá-lo aqui só criaria uma segunda lista para envelhecer.
 */
export const TACTICAL_DUTY_LABELS: Record<TacticalDuty, string> = {
  defend: "Defender",
  support: "Apoiar",
  attack: "Atacar",
};

export const INTENT_LABELS = {
  carrying: "Conduzindo",
  sprinting: "Sprint controlado",
  knockingOn: "Pique com a bola",
  feinting: "Fintando",
  passing: "Passando",
  shooting: "Finalizando",
  receiving: "Recebendo passe",
  firstTime: "Preparando ação de primeira",
  breaking: "Avanço agressivo",
  supporting: "Apoiando",
  pressing: "Pressionando",
  marking: "Marcando",
  covering: "Cobrindo",
  preparingSave: "Preparando defesa",
  diving: "Mergulhando",
  jumping: "Saltando alto",
  claimingHighBall: "Saindo no cruzamento",
  recoveringSave: "Recuperando da defesa",
  goalkeeping: "Protegendo o gol",
  holdingBall: "Segurando a bola",
} as const;

export const DRIBBLE_TOUCH_LABELS: Record<DribbleTouchRange, string> = {
  short: "Pique curto",
  medium: "Pique médio",
  long: "Pique longo",
};

export const DRIBBLE_RANGE_REASON_LABELS: Record<DribbleRangeReason, string> = {
  clearRunway: "Corredor frontal livre",
  reducedForEnergy: "Faixa reduzida pela energia",
  reducedForRace: "Faixa reduzida pela disputa",
  touchCooldown: "Preparando o próximo pique",
  insufficientRunway: "Corredor insuficiente",
};

export const PASS_PURPOSE_LABELS: Record<PassPurpose, string> = {
  feet: "Nos pés",
  throughBall: "Passe em profundidade",
  cross: "Cruzamento",
  cutback: "Passe para trás",
  switch: "Inversão",
  layoff: "Devolução",
};

export const SHOT_TECHNIQUE_LABELS: Record<ShotTechnique, string> = {
  placed: "Colocado",
  power: "Potente",
  volley: "Voleio",
  header: "Cabeceio",
  redirect: "Desvio",
};

export const PACE_LABELS: Record<MovementPace, string> = {
  walk: "Caminhada",
  run: "Corrida",
  burst: "Explosão",
  closeControl: "Domínio curto",
};

export const PHASE_LABELS: Record<TacticalPhase, string> = {
  buildUp: "Construção",
  progression: "Progressão",
  finalThird: "Último terço",
  counterAttack: "Contra-ataque",
  highPress: "Pressão alta",
  midBlock: "Bloco médio",
  lowBlock: "Bloco baixo",
  counterPress: "Contra-pressão",
  recovery: "Recomposição",
};

/** Nome curto de cada dever, para a linha de distribuição do painel de análise. */
export const DUTY_LABELS: Record<AssignmentDuty, string> = {
  carry: "com a bola",
  receive: "recebendo",
  runInBehind: "em profundidade",
  support: "apoio",
  width: "amplitude",
  overlap: "sobreposição",
  recycle: "tabela",
  restDefense: "retaguarda",
  press: "pressão",
  trackRunner: "marcação",
  holdLine: "zona",
  goalkeep: "goleiro",
};

export const REASON_LABELS: Record<DecisionReason, string> = {
  shootingWindow: "Janela de finalização",
  progressivePass: "Passe rompe linha",
  switchPlay: "Inverter lado congestionado",
  wallPass: "Devolver para tabela",
  escapePressure: "Escapar da pressão",
  carryIntoSpace: "Atacar espaço livre",
  giveWidth: "Dar amplitude",
  runInBehind: "Atacar profundidade",
  thirdManSupport: "Apoio de terceiro homem",
  restDefense: "Proteger o contra-ataque",
  pressBall: "Pressionar o portador",
  coverGoal: "Cobrir o gol",
  holdZone: "Sustentar a zona",
  markThreat: "Marcar ameaça",
  attackReception: "Atacar a recepção",
  firstTimeAction: "Ação de primeira",
  aggressiveBreak: "Avanço agressivo",
  longShot: "Finalização de longe",
  reactToShot: "Reagir ao chute",
  attackCross: "Atacar o cruzamento",
  recoverFromSave: "Recuperar após a defesa",
  protectGoal: "Proteger o gol",
  holdInHands: "Segurar a bola nas mãos",
  reboundAlert: "Alerta após o rebote",
  smotherLoose: "Recolher bola solta",
  recoverShape: "Recompor em disparada",
  overlapRun: "Sobreposição do lateral",
};

/**
 * Eixos de mentalidade na ordem em que o editor os mostra, com o que cada ponta significa. A
 * ordem é a do plano: o que o time faz sem a bola, depois com ela.
 */
export const MENTALITY_AXES: readonly { key: keyof TacticalMentality; label: string; low: string; high: string }[] = [
  { key: "defensiveLine", label: "Linha", low: "recuada", high: "adiantada" },
  { key: "pressing", label: "Pressão", low: "espera", high: "sufoca" },
  { key: "width", label: "Amplitude", low: "por dentro", high: "aberto" },
  { key: "tempo", label: "Ritmo", low: "segura", high: "acelera" },
  { key: "risk", label: "Risco", low: "seguro", high: "ousado" },
];

export const BUILD_UP_LABELS: Record<BuildUpStyle | "auto", string> = {
  auto: "O time decide",
  short: "Saída curta",
  balanced: "Equilibrado",
  direct: "Jogo direto",
};

export const DEFENSIVE_BLOCK_LABELS: Record<DefensiveBlock | "auto", string> = {
  auto: "O time decide",
  high: "Bloco alto",
  mid: "Bloco médio",
  low: "Bloco baixo",
};

export const PRESS_TRIGGER_LABELS: Record<PressTrigger, string> = {
  looseBall: "Bola solta",
  counterPress: "Perda da posse",
  touchline: "Perto da linha",
  compact: "Bloco formado",
};

export const SUPPORT_LABELS: Record<SupportInstruction, string> = {
  hold: "Segura a posição",
  balanced: "Equilibrado",
  attack: "Acompanha o ataque",
};

export const MARKING_LABELS: Record<MarkingInstruction, string> = {
  zone: "Por zona",
  man: "Individual",
};

export const FREEDOM_LABELS: Record<FreedomInstruction, string> = {
  rarely: "Raramente",
  normal: "Normal",
  often: "Sempre que der",
};

export const POSITION_FIT_LABELS: Record<PositionFitLevel, string> = {
  natural: "Posição natural",
  accomplished: "Joga bem na função",
  secondary: "Posição secundária",
  awkward: "Improviso leve",
  makeshift: "Improviso pesado",
  blocked: "Não pode jogar aqui",
};

/**
 * Aptidão do atleta para a função pedida. Curto de propósito: aparece ao lado do nome de cada função
 * no seletor, como o `++` do EA FC, e um rótulo longo ali empurraria a função para fora da linha.
 */
export const ROLE_FIT_LABELS: Record<RoleFitLevel, string> = {
  natural: "★★★",
  accomplished: "★★",
  capable: "★",
  awkward: "–",
  unsuited: "✗",
};

export const PLAN_ISSUE_LABELS: Record<TacticalPlanIssueKind, string> = {
  "wrong-size": "A escalação precisa de onze titulares.",
  "unknown-slot": "Um titular está num slot que não existe.",
  "duplicate-slot": "Dois titulares ocupam o mesmo slot.",
  "duplicate-player": "O mesmo jogador foi escalado duas vezes.",
  "unknown-player": "Alguém do plano não está mais no elenco.",
  "missing-goalkeeper": "Falta o goleiro.",
  "blocked-position": "Alguém foi escalado numa posição que não pode ocupar.",
  "bench-conflict": "Alguém está no banco e em campo ao mesmo tempo.",
};

/** Nome de cada lado nesta partida. Vem dos clubes escolhidos, não do time do motor. */
export type TeamNames = Record<Team, string>;

export const teamLabel = (team: Team, names: TeamNames): string => names[team];

export const formatClock = (seconds: number): string => (
  `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`
);

/**
 * Relógio da partida com acréscimos: mostra "05:00 +00:07" ao passar do fim nominal do tempo ou
 * enquanto a placa de acréscimos está no ar. O relógio é contínuo (não zera no intervalo).
 */
export const formatMatchClock = (state: MatchState): string => {
  const nominal = HALF_DURATION * state.half;
  if (state.elapsed > nominal || state.stoppage.awaitingEnd) {
    const base = Math.min(state.elapsed, nominal);
    return `${formatClock(base)} +${formatClock(state.elapsed - nominal)}`;
  }
  return formatClock(state.elapsed);
};

export const percentage = (value: number, total: number): string => `${total > 0 ? Math.round(value / total * 100) : 0}%`;
