import type { CountryCode } from "../shared/model";
import type { TeamTacticalPlan } from "../tactics/model";

export interface ClubColors {
  /** Cor dominante do uniforme, em hexadecimal (#rrggbb). */
  primary: string;
  secondary: string;
  /** Cor do número e do nome sobre a cor dominante. */
  text: string;
}

export interface Club {
  id: string;
  name: string;
  /** Sigla de três letras usada em placar e tabela (NIL, MAY). */
  shortName: string;
  nickname: string;
  nationality: CountryCode;
  city: string;
  colors: ClubColors;
  founded: number;
  /** 1 a 100. Ordena os clubes e alimenta a geração de elenco. */
  reputation: number;
  /**
   * Plano padrão do clube, editado na terceira aba do editor. O jogo rápido copia este
   * plano para a partida; a cópia é editada sem tocar no clube.
   */
  defaultPlan: TeamTacticalPlan;
}
