import type { PlayerPosition } from "../roster/model";
import type { FieldSide } from "../roster/positions";

export type TacticalSlotId =
  | "gol"
  | "ld" | "le" | "zag-d" | "zag-e" | "zag"
  | "ae" | "ad" | "med-e" | "med-d" | "med"
  | "me" | "md" | "mc-d" | "mc-e" | "mc"
  | "ee" | "ed" | "mo-e" | "mo-d" | "mo"
  | "pd" | "pe" | "ata-e" | "ata-d" | "ata"
  | "ce-e" | "ce-d" | "ce";

export interface TacticalSlot {
  id: TacticalSlotId;
  /** Sigla mostrada no campo tático (GOL, ZAG, VOL, MO, CE...). */
  label: string;
  /**
   * Posições que ocupam o slot sem improviso. A primeira é a preferencial: quem joga nela
   * recebe encaixe natural, as demais recebem encaixe pleno mas não ideal (ver positionFit).
   */
  allowedPositions: PlayerPosition[];
  /**
   * Coordenada na grade do editor. `column` cresce do próprio gol (0) para o ataque (11);
   * `row` cresce da esquerda (0) para a direita (8) do campo, na visão do time atacando.
   * Só sete colunas e cinco linhas são usadas — ver TACTICAL_GRID.
   */
  zone: { column: number; row: number };
  side: FieldSide;
}

export const TACTICAL_SLOTS: readonly TacticalSlot[] = [
  { id: "gol", label: "GOL", allowedPositions: ["goalkeeper"], zone: { column: 0, row: 4 }, side: "center" },

  { id: "le", label: "LE", allowedPositions: ["leftBack", "leftMid"], zone: { column: 2, row: 0 }, side: "left" },
  { id: "zag-e", label: "ZAG", allowedPositions: ["centerBack"], zone: { column: 2, row: 2 }, side: "left" },
  { id: "zag", label: "ZAG", allowedPositions: ["centerBack", "defensiveMid"], zone: { column: 2, row: 4 }, side: "center" },
  { id: "zag-d", label: "ZAG", allowedPositions: ["centerBack"], zone: { column: 2, row: 6 }, side: "right" },
  { id: "ld", label: "LD", allowedPositions: ["rightBack", "rightMid"], zone: { column: 2, row: 8 }, side: "right" },

  { id: "ae", label: "AE", allowedPositions: ["leftBack", "leftMid"], zone: { column: 4, row: 0 }, side: "left" },
  { id: "med-e", label: "VOL", allowedPositions: ["defensiveMid", "centerMid"], zone: { column: 4, row: 2 }, side: "left" },
  { id: "med", label: "VOL", allowedPositions: ["defensiveMid", "centerMid"], zone: { column: 4, row: 4 }, side: "center" },
  { id: "med-d", label: "VOL", allowedPositions: ["defensiveMid", "centerMid"], zone: { column: 4, row: 6 }, side: "right" },
  { id: "ad", label: "AD", allowedPositions: ["rightBack", "rightMid"], zone: { column: 4, row: 8 }, side: "right" },

  { id: "me", label: "ME", allowedPositions: ["leftMid", "centerMid", "leftWing"], zone: { column: 6, row: 0 }, side: "left" },
  { id: "mc-e", label: "MC", allowedPositions: ["centerMid", "defensiveMid", "attackingMid"], zone: { column: 6, row: 2 }, side: "left" },
  { id: "mc", label: "MC", allowedPositions: ["centerMid", "defensiveMid", "attackingMid"], zone: { column: 6, row: 4 }, side: "center" },
  { id: "mc-d", label: "MC", allowedPositions: ["centerMid", "defensiveMid", "attackingMid"], zone: { column: 6, row: 6 }, side: "right" },
  { id: "md", label: "MD", allowedPositions: ["rightMid", "centerMid", "rightWing"], zone: { column: 6, row: 8 }, side: "right" },

  { id: "ee", label: "EE", allowedPositions: ["leftMid", "leftWing"], zone: { column: 8, row: 0 }, side: "left" },
  { id: "mo-e", label: "MO", allowedPositions: ["attackingMid", "centerMid", "leftMid"], zone: { column: 8, row: 2 }, side: "left" },
  { id: "mo", label: "MO", allowedPositions: ["attackingMid", "centerMid", "striker"], zone: { column: 8, row: 4 }, side: "center" },
  { id: "mo-d", label: "MO", allowedPositions: ["attackingMid", "centerMid", "rightMid"], zone: { column: 8, row: 6 }, side: "right" },
  { id: "ed", label: "ED", allowedPositions: ["rightMid", "rightWing"], zone: { column: 8, row: 8 }, side: "right" },

  { id: "pe", label: "PE", allowedPositions: ["leftWing", "leftMid", "striker"], zone: { column: 10, row: 0 }, side: "left" },
  { id: "ata-e", label: "ATA", allowedPositions: ["striker", "leftWing", "attackingMid"], zone: { column: 10, row: 2 }, side: "left" },
  { id: "ata", label: "ATA", allowedPositions: ["striker", "attackingMid"], zone: { column: 10, row: 4 }, side: "center" },
  { id: "ata-d", label: "ATA", allowedPositions: ["striker", "rightWing", "attackingMid"], zone: { column: 10, row: 6 }, side: "right" },
  { id: "pd", label: "PD", allowedPositions: ["rightWing", "rightMid", "striker"], zone: { column: 10, row: 8 }, side: "right" },

  { id: "ce-e", label: "CE", allowedPositions: ["striker", "leftWing"], zone: { column: 11, row: 2 }, side: "left" },
  { id: "ce", label: "CE", allowedPositions: ["striker"], zone: { column: 11, row: 4 }, side: "center" },
  { id: "ce-d", label: "CE", allowedPositions: ["striker", "rightWing"], zone: { column: 11, row: 6 }, side: "right" },
];

/**
 * Grade 7x5 do editor. As coordenadas dos slots são esparsas (colunas 0,2,4,6,8,10,11 e
 * linhas 0,2,4,6,8) para deixar espaço a slots futuros sem renumerar os existentes; estas
 * listas dão à interface os eixos que ela realmente desenha.
 */
export const TACTICAL_GRID = {
  columns: [0, 2, 4, 6, 8, 10, 11] as const,
  rows: [0, 2, 4, 6, 8] as const,
} as const;

export const GOALKEEPER_SLOT_ID: TacticalSlotId = "gol";

const SLOTS_BY_ID = new Map<string, TacticalSlot>(TACTICAL_SLOTS.map((slot) => [slot.id, slot]));

export const findSlot = (id: string): TacticalSlot | null => SLOTS_BY_ID.get(id) ?? null;

export const isTacticalSlotId = (value: unknown): value is TacticalSlotId =>
  typeof value === "string" && SLOTS_BY_ID.has(value);

/** Slots na ordem em que entram em campo: do gol ao ataque, e da esquerda para a direita. */
export const slotOrder = (slot: TacticalSlot): number => slot.zone.column * 10 + slot.zone.row;
