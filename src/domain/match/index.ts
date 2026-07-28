export { stepMatch } from "./engine";
export { applyTeamAdjustment, createMatchState, extractPlayerMemories } from "./state";
export type { MatchConfig, MatchEvent, MatchParticipant, MatchState, TeamAdjustment } from "./model";

/**
 * Leituras que a apresentação faz do estado para desenhá-lo e narrá-lo. Ficam aqui porque a tela
 * não tem por que saber em que sistema o motor guarda cada regra — enquanto ela importava
 * `systems/goalkeeper-system` e `runtime/offside` direto, qualquer reorganização interna do motor
 * quebrava o desenho. Ver `boundaries.test.ts`.
 */
export { goalkeeperJumpHeight, goalkeeperQuality } from "./systems/goalkeeper-system";
export { progressToX } from "./runtime/pitch";
