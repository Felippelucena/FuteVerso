// Vocabulário tático compartilhado entre o plano editável e o motor. Fica aqui, e não em
// domain/match/model.ts, porque o plano é quem define as opções; o motor as consome e
// reexporta para não mudar sua superfície pública.

export type AttackChannel = "left" | "center" | "right";
export type BuildUpStyle = "short" | "balanced" | "direct";
export type DefensiveBlock = "high" | "mid" | "low";
export type PressTrigger = "looseBall" | "counterPress" | "touchline" | "compact";

export const BUILD_UP_STYLES: readonly BuildUpStyle[] = ["short", "balanced", "direct"];
export const DEFENSIVE_BLOCKS: readonly DefensiveBlock[] = ["high", "mid", "low"];
export const PRESS_TRIGGERS: readonly PressTrigger[] = ["looseBall", "counterPress", "touchline", "compact"];

/**
 * **O que um jogador está encarregado de fazer agora.** É a entrega do nível coletivo para o
 * individual: quem decide movimento e ação lê o dever, em vez de redescobrir o trabalho a partir de
 * booleanos avulsos.
 *
 * Mora aqui, e não em `domain/match/model`, pela mesma razão que `BuildUpStyle`: é vocabulário que o
 * **plano** e o **motor** precisam falar igual. O motor o reexporta para manter sua superfície pública
 * intacta. Enquanto ele vivia só do lado do motor, a função escolhida pelo treinador não tinha como
 * nomear o trabalho que ela quer — e função sem dever é rótulo.
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
   * A tabela: quem se oferece ATRÁS da linha da bola para ela voltar e sair de novo. Era o buraco da
   * forma — todo apoio vivia à frente do portador (de +7 a +35 m) e a única opção atrás era o rest
   * defense, a 19-25 m e com alvo próprio. Entre um e outro não havia ninguém encarregado de se
   * oferecer, e por isso a triangulação não tinha como acontecer.
   */
  | "recycle"
  // Sem a bola, com o time fora de posse.
  | "press"
  | "trackRunner"
  | "holdLine"
  | "goalkeep";
