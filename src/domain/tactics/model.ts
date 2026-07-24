import type { TacticalSlotId } from "./slots";
import type { BuildUpStyle, DefensiveBlock, PressTrigger } from "./vocabulary";

/** Jogadores em campo por time, incluindo o goleiro. */
export const TEAM_SIZE = 11;

/**
 * Cinco eixos de 0 a 100, todos neutros em 50. O motor lê estes valores como viés sobre o
 * que já calcula sozinho: 50 mantém o comportamento emergente, os extremos empurram para
 * um lado. Nenhum deles força uma decisão — o jogador ainda decide.
 */
export interface TacticalMentality {
  /** Altura da linha defensiva: 0 recua para a própria área, 100 joga colado no meio-campo. */
  defensiveLine: number;
  /** Disposição para pressionar longe do próprio gol. */
  pressing: number;
  /** Abertura do time com a bola: 0 concentra no miolo, 100 usa toda a largura. */
  width: number;
  /** Velocidade de circulação: 0 segura a bola, 100 acelera a cada toque. */
  tempo: number;
  /** Apetite por passe e drible arriscados em vez da opção segura. */
  risk: number;
}

export const NEUTRAL_MENTALITY: TacticalMentality = {
  defensiveLine: 50,
  pressing: 50,
  width: 50,
  tempo: 50,
  risk: 50,
};

export type SupportInstruction = "hold" | "balanced" | "attack";
export type MarkingInstruction = "zone" | "man";
export type FreedomInstruction = "rarely" | "normal" | "often";

export interface PlayerInstruction {
  /** Quanto o jogador abandona a âncora do slot para acompanhar o ataque. */
  support: SupportInstruction;
  marking: MarkingInstruction;
  shootFreedom: FreedomInstruction;
  dribbleFreedom: FreedomInstruction;
}

export const DEFAULT_INSTRUCTION: PlayerInstruction = {
  support: "balanced",
  marking: "zone",
  shootFreedom: "normal",
  dribbleFreedom: "normal",
};

export interface TacticalAssignment {
  slotId: TacticalSlotId;
  playerId: string;
}

/**
 * Plano tático de um time. Vive dentro do clube como padrão (`Club.defaultPlan`) e é
 * copiado para a partida: editar o plano de um jogo nunca altera o clube.
 */
export interface TeamTacticalPlan {
  /**
   * Preset de origem da escalação, quando ela veio de um. `null` é formação personalizada:
   * o treinador arrastou jogadores para slots fora do preset. Serve para rotular o plano e
   * para recompor a escalação quando um titular deixa o elenco.
   */
  formationId: string | null;
  /** Titulares, um por slot ocupado. Exatamente TEAM_SIZE, com um e só um goleiro. */
  assignments: TacticalAssignment[];
  /** Reservas na ordem escolhida pelo treinador. Sem efeito até existirem substituições. */
  bench: string[];
  mentality: TacticalMentality;
  /** `auto` deixa o motor decidir pela fase do jogo, como faz hoje. */
  buildUpStyle: BuildUpStyle | "auto";
  defensiveBlock: DefensiveBlock | "auto";
  /** Gatilhos habilitados. Lista vazia significa time que não pressiona por gatilho. */
  pressTriggers: PressTrigger[];
  /** Só os slots que fogem de DEFAULT_INSTRUCTION são guardados. */
  instructions: Partial<Record<TacticalSlotId, PlayerInstruction>>;
}

export const instructionFor = (plan: TeamTacticalPlan, slotId: TacticalSlotId): PlayerInstruction =>
  plan.instructions[slotId] ?? DEFAULT_INSTRUCTION;
