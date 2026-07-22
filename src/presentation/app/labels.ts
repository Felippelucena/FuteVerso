import type { DecisionReason, DribbleRangeReason, DribbleTouchRange, MovementPace, TacticalPhase } from "../../domain/match/model";
import type { PlayerPosition, PlayerRole } from "../../domain/roster/model";
import type { Team } from "../../domain/shared/model";

export const POSITION_LABELS: Record<PlayerPosition, string> = {
  goalkeeper: "Goleiro",
  centerBack: "Zagueiro",
  fullBack: "Lateral",
  midfielder: "Meio-campo",
  forward: "Atacante",
};

export const ROLE_LABELS: Record<PlayerRole, string> = {
  finisher: "Finalizador",
  playmaker: "Construção",
  defender: "Defesa",
};

export const INTENT_LABELS = {
  carrying: "Conduzindo",
  sprinting: "Sprint controlado",
  knockingOn: "Pique com a bola",
  feinting: "Fintando",
  passing: "Passando",
  shooting: "Finalizando",
  receiving: "Recebendo passe",
  supporting: "Apoiando",
  pressing: "Pressionando",
  marking: "Marcando",
  covering: "Cobrindo",
  goalkeeping: "Protegendo o gol",
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
  markThreat: "Marcar ameaça",
  attackReception: "Atacar a recepção",
  protectGoal: "Proteger o gol",
};

export const escapeHtml = (value: string): string => value.replace(
  /[&<>"]/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!,
);

export const teamLabel = (team: Team): string => team === "blue" ? "NILO" : "MAYA";

export const formatClock = (seconds: number): string => (
  `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`
);

export const percentage = (value: number, total: number): string => `${total > 0 ? Math.round(value / total * 100) : 0}%`;
