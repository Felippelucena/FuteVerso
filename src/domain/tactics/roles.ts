import type { PlayerMentalAttributes, PlayerPosition, PlayerSkills } from "../roster/model";
import type { PlayerInstruction } from "./model";
import type { TacticalSlotId } from "./slots";
import type { AssignmentDuty } from "./vocabulary";

/**
 * **Função e dever** — o que o treinador pede de cada jogador, no eixo do Football Manager.
 *
 * A função diz *que tipo de jogador ele é naquele slot*; o dever diz *quanto ele avança para fazê-lo*.
 * Antes isto era um campo do atleta (`PlayerRole`: finisher/playmaker/defender), três opções fixas que
 * o treinador não escolhia e que o motor lia em quatro lugares soltos. Duas coisas estavam erradas
 * nisso: função é escolha de quem escala, não atributo de nascença; e três valores não têm como
 * expressar a diferença entre um lateral que sobe e um que não sobe.
 *
 * O que uma função faz, concretamente, é **enviesar o dever que o motor já escolhe sozinho** — que é
 * exatamente o gancho que `docs/architecture.md` descreve: ligar um botão do plano significa mudar
 * *como a incumbência é escolhida*, não acrescentar um sistema paralelo.
 */

export type TacticalDuty = "defend" | "support" | "attack";

export const TACTICAL_DUTIES: readonly TacticalDuty[] = ["defend", "support", "attack"];

export type TacticalRoleId =
  | "goalkeeper" | "sweeperKeeper"
  | "centreBack" | "ballPlayingDefender" | "fullBack" | "wingBack"
  | "anchor" | "deepPlaymaker" | "boxToBox" | "advancedPlaymaker"
  | "wideMidfielder" | "winger" | "insideForward"
  | "targetMan" | "poacher" | "falseNine";

/** Peso de aptidão por atributo. As chaves são as de `PlayerSkills` e `PlayerMentalAttributes`. */
export type AptitudeWeights = Partial<Record<keyof PlayerSkills | keyof PlayerMentalAttributes, number>>;

export interface TacticalRole {
  id: TacticalRoleId;
  label: string;
  /** Posições em que a função faz sentido — a mesma lista que o slot já usa para encaixe. */
  positions: readonly PlayerPosition[];
  /** Deveres válidos. Um poacher não "defende", e um zagueiro não "ataca". */
  duties: readonly TacticalDuty[];
  /**
   * Onde ele vive, de -1 (colado na própria área) a +1 (nas costas da linha). Substitui os dois
   * números cravados que liam `profile.role`: o viés de profundidade da formação e o `fromRole` da
   * ordem de avanço.
   */
  depth: number;
  /** -1 pelo miolo, +1 na linha lateral. */
  width: number;
  /** Ele é retaguarda: entra no rest defense, no segundo pressionador e na cobertura garantida. */
  holdsTheLine: boolean;
  /**
   * Deveres que esta função procura quando o time tem a bola, em ordem de preferência. É por aqui
   * que "ala de apoio" vira `overlap` e "ponta" vira `width`, em vez de o motor adivinhar pela
   * posição no gramado.
   */
  seeks: readonly AssignmentDuty[];
  /** Padrões da instrução individual. O treinador ainda afina cada eixo por cima. */
  instruction: Partial<PlayerInstruction>;
  /** O que faz alguém ser bom NESTA função. Pesos relativos; `roleFit` os normaliza. */
  aptitude: AptitudeWeights;
}

const DEFENDER_POSITIONS: readonly PlayerPosition[] = ["centerBack", "rightBack", "leftBack"];
const FULL_BACK_POSITIONS: readonly PlayerPosition[] = ["rightBack", "leftBack"];
const MIDFIELD_POSITIONS: readonly PlayerPosition[] = ["defensiveMid", "centerMid", "attackingMid"];
const WIDE_POSITIONS: readonly PlayerPosition[] = ["rightMid", "leftMid", "rightWing", "leftWing"];
const FORWARD_POSITIONS: readonly PlayerPosition[] = ["striker", "attackingMid"];

export const TACTICAL_ROLES: readonly TacticalRole[] = [
  {
    id: "goalkeeper",
    label: "Goleiro",
    positions: ["goalkeeper"],
    duties: ["defend"],
    depth: -1,
    width: 0,
    holdsTheLine: true,
    seeks: ["goalkeep"],
    instruction: { support: "hold", shootFreedom: "rarely", dribbleFreedom: "rarely" },
    aptitude: { goalkeeping: 6, anticipation: 2, composure: 2, decisionMaking: 1 },
  },
  {
    id: "sweeperKeeper",
    label: "Goleiro-líbero",
    positions: ["goalkeeper"],
    duties: ["defend", "support"],
    depth: -0.85,
    width: 0,
    holdsTheLine: true,
    seeks: ["goalkeep"],
    instruction: { support: "balanced", dribbleFreedom: "normal" },
    aptitude: { goalkeeping: 5, passing: 2, anticipation: 2, composure: 2, decisionMaking: 1 },
  },

  {
    id: "centreBack",
    label: "Zagueiro",
    positions: DEFENDER_POSITIONS,
    duties: ["defend"],
    depth: -0.8,
    width: -0.3,
    holdsTheLine: true,
    seeks: ["restDefense", "holdLine"],
    instruction: { support: "hold", shootFreedom: "rarely", dribbleFreedom: "rarely" },
    aptitude: { defending: 5, strength: 3, anticipation: 3, decisionMaking: 2, sprintSpeed: 1 },
  },
  {
    id: "ballPlayingDefender",
    label: "Zagueiro construtor",
    positions: DEFENDER_POSITIONS,
    duties: ["defend", "support"],
    depth: -0.7,
    width: -0.3,
    holdsTheLine: true,
    seeks: ["restDefense", "recycle"],
    instruction: { support: "hold", dribbleFreedom: "normal" },
    aptitude: { defending: 4, passing: 3, vision: 2, composure: 2, strength: 2, decisionMaking: 2 },
  },
  {
    id: "fullBack",
    label: "Lateral",
    positions: FULL_BACK_POSITIONS,
    duties: ["defend", "support"],
    depth: -0.5,
    width: 0.7,
    holdsTheLine: true,
    seeks: ["width", "restDefense"],
    instruction: { support: "balanced", shootFreedom: "rarely" },
    aptitude: { defending: 4, stamina: 3, sprintSpeed: 3, anticipation: 2, passing: 1 },
  },
  {
    id: "wingBack",
    label: "Ala",
    positions: FULL_BACK_POSITIONS,
    duties: ["support", "attack"],
    depth: 0,
    width: 0.9,
    holdsTheLine: false,
    seeks: ["overlap", "width"],
    instruction: { support: "attack" },
    aptitude: { stamina: 4, sprintSpeed: 4, acceleration: 2, passing: 2, defending: 2, teamwork: 1 },
  },

  {
    id: "anchor",
    label: "Volante de contenção",
    positions: ["defensiveMid", "centerMid"],
    duties: ["defend"],
    depth: -0.45,
    width: -0.5,
    holdsTheLine: true,
    seeks: ["restDefense", "recycle"],
    instruction: { support: "hold", shootFreedom: "rarely" },
    aptitude: { defending: 4, anticipation: 3, teamwork: 3, strength: 2, decisionMaking: 2 },
  },
  {
    id: "deepPlaymaker",
    label: "Volante construtor",
    positions: ["defensiveMid", "centerMid"],
    duties: ["defend", "support"],
    depth: -0.3,
    width: -0.6,
    holdsTheLine: true,
    seeks: ["recycle", "support"],
    instruction: { support: "balanced" },
    aptitude: { passing: 5, vision: 4, composure: 3, decisionMaking: 3, control: 2 },
  },
  {
    id: "boxToBox",
    label: "Meia de área a área",
    positions: MIDFIELD_POSITIONS,
    duties: ["support", "attack"],
    depth: 0.15,
    width: -0.2,
    holdsTheLine: false,
    seeks: ["support", "runInBehind"],
    instruction: { support: "balanced", shootFreedom: "normal" },
    aptitude: { stamina: 5, sprintSpeed: 2, defending: 2, passing: 2, finishing: 2, intensity: 2 },
  },
  {
    id: "advancedPlaymaker",
    label: "Meia armador",
    positions: ["centerMid", "attackingMid"],
    duties: ["support", "attack"],
    depth: 0.4,
    width: -0.5,
    holdsTheLine: false,
    seeks: ["receive", "support"],
    instruction: { support: "attack", dribbleFreedom: "often" },
    aptitude: { vision: 5, passing: 4, creativity: 4, control: 3, composure: 2 },
  },

  {
    id: "wideMidfielder",
    label: "Meia pela ponta",
    positions: WIDE_POSITIONS,
    duties: ["defend", "support"],
    depth: 0,
    width: 0.8,
    holdsTheLine: false,
    seeks: ["width", "support"],
    instruction: { support: "balanced" },
    aptitude: { stamina: 4, passing: 3, defending: 2, sprintSpeed: 2, teamwork: 2 },
  },
  {
    id: "winger",
    label: "Ponta",
    positions: WIDE_POSITIONS,
    duties: ["support", "attack"],
    depth: 0.55,
    width: 1,
    holdsTheLine: false,
    seeks: ["width", "runInBehind"],
    instruction: { support: "attack", dribbleFreedom: "often" },
    aptitude: { acceleration: 4, sprintSpeed: 4, control: 3, creativity: 3, passing: 2 },
  },
  {
    id: "insideForward",
    label: "Ponta invertido",
    positions: WIDE_POSITIONS,
    duties: ["support", "attack"],
    depth: 0.7,
    width: 0.25,
    holdsTheLine: false,
    seeks: ["runInBehind", "receive"],
    instruction: { support: "attack", shootFreedom: "often", dribbleFreedom: "often" },
    aptitude: { finishing: 4, acceleration: 3, control: 3, creativity: 3, kickPower: 2 },
  },

  {
    id: "targetMan",
    label: "Centroavante de referência",
    positions: ["striker"],
    duties: ["support", "attack"],
    depth: 0.75,
    width: -0.4,
    holdsTheLine: false,
    seeks: ["receive", "runInBehind"],
    instruction: { support: "attack", shootFreedom: "often" },
    aptitude: { strength: 5, finishing: 4, control: 2, composure: 2, anticipation: 2 },
  },
  {
    id: "poacher",
    label: "Finalizador",
    positions: ["striker"],
    duties: ["attack"],
    depth: 1,
    width: -0.5,
    holdsTheLine: false,
    seeks: ["runInBehind", "receive"],
    instruction: { support: "attack", shootFreedom: "often", dribbleFreedom: "rarely" },
    aptitude: { finishing: 6, anticipation: 4, acceleration: 3, composure: 2 },
  },
  {
    id: "falseNine",
    label: "Falso nove",
    positions: FORWARD_POSITIONS,
    duties: ["support"],
    depth: 0.45,
    width: -0.5,
    holdsTheLine: false,
    seeks: ["receive", "support"],
    instruction: { support: "balanced", dribbleFreedom: "often" },
    aptitude: { vision: 4, passing: 4, control: 3, creativity: 3, finishing: 2 },
  },
];

const ROLES_BY_ID = new Map<string, TacticalRole>(TACTICAL_ROLES.map((role) => [role.id, role]));

export const findRole = (id: string): TacticalRole | null => ROLES_BY_ID.get(id) ?? null;

export const isTacticalRoleId = (value: unknown): value is TacticalRoleId =>
  typeof value === "string" && ROLES_BY_ID.has(value);

/** As funções que fazem sentido para uma posição. Nunca vazia: goleiro tem as suas, linha tem as dela. */
export const rolesForPosition = (position: PlayerPosition): readonly TacticalRole[] =>
  TACTICAL_ROLES.filter((role) => role.positions.includes(position));

/**
 * Quanto o dever empurra a função para frente. É um eixo só, em cima do `depth` da função — o mesmo
 * ala com dever de defender e de atacar vira dois jogadores diferentes sem precisar de duas funções.
 */
export const DUTY_DEPTH_SHIFT: Record<TacticalDuty, number> = {
  defend: -0.25,
  support: 0,
  attack: 0.25,
};

/**
 * A função escolhida para um slot, resolvida em números. É o único ponto que o motor precisa
 * conhecer — quem lê `depth` não precisa saber que existe um catálogo.
 */
export interface ResolvedRole {
  depth: number;
  width: number;
  holdsTheLine: boolean;
  seeks: readonly AssignmentDuty[];
}

/**
 * A função de quem não escolheu nenhuma — e a que o motor usa quando o id não existe mais (plano
 * salvo por uma versão antiga). Neutra nos dois eixos, para não deslocar quem ninguém posicionou.
 */
const NEUTRAL_ROLE_ID: TacticalRoleId = "boxToBox";

/**
 * **Com que função cada slot nasce.** O treinador troca; isto é só o ponto de partida.
 *
 * Mora aqui, e não em `slots.ts`, porque é conhecimento de função e não de geometria — o slot sabe
 * onde fica no gramado, o catálogo sabe o que se joga ali. E precisa existir: um padrão global único
 * (`boxToBox` para todo mundo) deixava o time **sem retaguarda nenhuma**, porque `holdsTheLine` é
 * propriedade da função. O zagueiro tem de nascer zagueiro.
 */
export const DEFAULT_ROLE_BY_SLOT: Record<TacticalSlotId, { role: TacticalRoleId; duty: TacticalDuty }> = {
  gol: { role: "goalkeeper", duty: "defend" },

  le: { role: "fullBack", duty: "support" },
  "zag-e": { role: "centreBack", duty: "defend" },
  zag: { role: "centreBack", duty: "defend" },
  "zag-d": { role: "centreBack", duty: "defend" },
  ld: { role: "fullBack", duty: "support" },

  ae: { role: "wingBack", duty: "support" },
  "med-e": { role: "anchor", duty: "defend" },
  med: { role: "anchor", duty: "defend" },
  "med-d": { role: "anchor", duty: "defend" },
  ad: { role: "wingBack", duty: "support" },

  me: { role: "wideMidfielder", duty: "support" },
  "mc-e": { role: "boxToBox", duty: "support" },
  mc: { role: "boxToBox", duty: "support" },
  "mc-d": { role: "boxToBox", duty: "support" },
  md: { role: "wideMidfielder", duty: "support" },

  ee: { role: "winger", duty: "support" },
  "mo-e": { role: "advancedPlaymaker", duty: "support" },
  mo: { role: "advancedPlaymaker", duty: "support" },
  "mo-d": { role: "advancedPlaymaker", duty: "support" },
  ed: { role: "winger", duty: "support" },

  pe: { role: "winger", duty: "attack" },
  "ata-e": { role: "poacher", duty: "attack" },
  ata: { role: "poacher", duty: "attack" },
  "ata-d": { role: "poacher", duty: "attack" },
  pd: { role: "winger", duty: "attack" },

  "ce-e": { role: "poacher", duty: "attack" },
  ce: { role: "poacher", duty: "attack" },
  "ce-d": { role: "poacher", duty: "attack" },
};

/** A função × dever de uma instrução, já resolvida em números. É o que o motor consome. */
export const resolvedRoleOf = (instruction: { role: TacticalRoleId; duty: TacticalDuty }): ResolvedRole =>
  resolveRole(findRole(instruction.role) ?? findRole(NEUTRAL_ROLE_ID)!, instruction.duty);

export const resolveRole = (role: TacticalRole, duty: TacticalDuty): ResolvedRole => ({
  depth: Math.max(-1, Math.min(1, role.depth + DUTY_DEPTH_SHIFT[duty])),
  width: role.width,
  // Quem recebe dever de atacar deixa de ser retaguarda, por mais recuada que a função seja.
  holdsTheLine: role.holdsTheLine && duty !== "attack",
  seeks: role.seeks,
});
