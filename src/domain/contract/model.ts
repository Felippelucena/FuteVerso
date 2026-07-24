/**
 * Vínculo entre jogador e clube. É a única fonte da verdade sobre elenco: nem o jogador
 * guarda o clube, nem o clube guarda a lista de jogadores. Transferência, empréstimo,
 * salário e fim de contrato são atributos do vínculo, e é por isso que ele existe separado.
 */
export type ContractStatus = "active" | "expired" | "loan";

export interface Contract {
  id: string;
  playerId: string;
  clubId: string;
  /** Camisa no clube: pertence ao vínculo, porque muda quando o jogador se transfere. */
  shirtNumber: number;
  startYear: number;
  endYear: number;
  /** Salário por temporada, em unidade abstrata. Só ganha sentido na carreira. */
  wage: number;
  status: ContractStatus;
  /** Em empréstimo, o clube dono dos direitos enquanto o jogador atua em `clubId`. */
  parentClubId?: string;
}

/** Vínculos que colocam o jogador em campo pelo clube. */
export const PLAYING_STATUSES: readonly ContractStatus[] = ["active", "loan"];
