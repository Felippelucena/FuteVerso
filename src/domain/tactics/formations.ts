import { TEAM_SIZE } from "./model";
import type { TacticalSlotId } from "./slots";

export interface Formation {
  id: string;
  name: string;
  /** Sempre TEAM_SIZE slots, com o gol incluído. */
  slots: TacticalSlotId[];
}

// Presets de partida. A grade aceita muito mais que isto — são atalhos para o editor, não
// um limite: o treinador pode arrastar jogadores para qualquer combinação de slots.
export const FORMATIONS: readonly Formation[] = [
  { id: "4-3-3", name: "4-3-3", slots: ["gol", "le", "zag-e", "zag-d", "ld", "med", "mc-e", "mc-d", "pe", "ata", "pd"] },
  { id: "4-4-2", name: "4-4-2", slots: ["gol", "le", "zag-e", "zag-d", "ld", "me", "mc-e", "mc-d", "md", "ata-e", "ata-d"] },
  { id: "4-2-3-1", name: "4-2-3-1", slots: ["gol", "le", "zag-e", "zag-d", "ld", "med-e", "med-d", "mo-e", "mo", "mo-d", "ce"] },
  { id: "3-5-2", name: "3-5-2", slots: ["gol", "zag-e", "zag", "zag-d", "ae", "med-e", "mc", "med-d", "ad", "ata-e", "ata-d"] },
  { id: "5-3-2", name: "5-3-2", slots: ["gol", "le", "zag-e", "zag", "zag-d", "ld", "med-e", "mc", "med-d", "ata-e", "ata-d"] },
];

export const DEFAULT_FORMATION_ID = "4-3-3";

export const findFormation = (id: string): Formation | null =>
  FORMATIONS.find((formation) => formation.id === id) ?? null;

export const defaultFormation = (): Formation => findFormation(DEFAULT_FORMATION_ID) ?? FORMATIONS[0];

// Guarda contra erro de digitação nos presets acima: um preset com 10 ou 12 slots geraria
// escalação inválida silenciosamente.
export const isCompleteFormation = (formation: Formation): boolean =>
  formation.slots.length === TEAM_SIZE && new Set(formation.slots).size === TEAM_SIZE;
