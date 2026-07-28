import { MATCH_HALVES, HALF_DURATION, STOPPAGE } from "./config";

/**
 * O regulamento sob o qual esta partida corre.
 *
 * Estava tudo em constante de módulo: não dava para ter uma partida de 45 minutos e um amistoso de
 * 30 no mesmo processo, nem um modo sem impedimento, nem um cenário de teste curto sem mexer no
 * global. Agora viaja no `MatchConfig` e vive no `MatchState`, onde todo sistema já chega.
 *
 * ## Relógio comprimido
 *
 * A partida do jogo não dura noventa minutos e não vai durar: a 82 µs por tick, uma temporada de
 * 380 partidas de 90 minutos custa nove horas de CPU, contra pouco mais de uma hora numa de vinte.
 * O teto é de vinte minutos, e a decisão está registrada em docs/architecture.md.
 *
 * `compression` é o fator dessa escolha — a duração desta partida sobre os 90 minutos de futebol.
 * **Tudo que é "por partida" deriva dele**, do mesmo jeito que `GOAL_TO_GOAL_SPRINT` faz o custo
 * de estamina não depender do tamanho do campo. Sem esse fator com nome, a compressão existia
 * assim mesmo, só que implícita: a estamina estava calibrada para terminar em ~55% depois de dez
 * minutos, ou seja, dez minutos já custavam uma partida inteira de desgaste.
 *
 * O que a compressão faz com os números vale saber: percentuais (posse, precisão de passe, taxa
 * de defesa) são invariantes à duração e seguem realistas; CONTAGENS (gols, finalizações, km) não
 * são, e é por isso que a calibragem do motor mira o placar e não o minuto.
 */

/** Noventa minutos, em segundos: o denominador da compressão. */
export const REAL_MATCH_DURATION = 90 * 60;

/** Teto de duração — ver "Relógio comprimido" acima. Não é limitação técnica, é decisão medida. */
export const MAXIMUM_MATCH_DURATION = 20 * 60;

/**
 * A compressão em que as calibragens "por partida" foram medidas (dez minutos). Quem é calibrado
 * por partida — o desgaste longo, hoje — se corrige por `REFERENCE_COMPRESSION / rules.compression`
 * e passa a valer em qualquer relógio. Mora aqui, junto da compressão, e não no config de cada
 * sistema: duplicar o denominador é como a calibragem se solta da duração sem ninguém ver.
 */
export const REFERENCE_COMPRESSION = (10 * 60) / REAL_MATCH_DURATION;

export interface StoppageRules {
  accrualFactor: number;
  maxAddedTime: number;
  graceCeiling: number;
}

export interface MatchRules {
  halves: number;
  halfDuration: number;
  /** `halves × halfDuration`. */
  matchDuration: number;
  /** `matchDuration ÷ 90 min`. Tudo que é "por partida" deriva daqui. */
  compression: number;
  stoppage: StoppageRules;
  /** Lei 11 desligada é um modo de jogo, não um bug: pelada, futsal, base. */
  offsideEnabled: boolean;
}

export interface MatchRulesOptions {
  halves?: number;
  halfDuration?: number;
  stoppage?: Partial<StoppageRules>;
  offsideEnabled?: boolean;
}

export const createMatchRules = (options: MatchRulesOptions = {}): MatchRules => {
  const halves = Math.max(1, Math.round(options.halves ?? MATCH_HALVES));
  const halfDuration = Math.max(1, options.halfDuration ?? HALF_DURATION);
  const matchDuration = Math.min(halves * halfDuration, MAXIMUM_MATCH_DURATION);
  return {
    halves,
    halfDuration: matchDuration / halves,
    matchDuration,
    compression: matchDuration / REAL_MATCH_DURATION,
    stoppage: { ...STOPPAGE, ...options.stoppage },
    offsideEnabled: options.offsideEnabled ?? true,
  };
};

/** O regulamento padrão do jogo. */
export const DEFAULT_MATCH_RULES = createMatchRules();
