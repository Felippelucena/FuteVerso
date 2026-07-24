import { describe, expect, it } from "vitest";
import { PLAYER_POSITIONS } from "../roster/positions";
import { FORMATIONS, isCompleteFormation } from "./formations";
import { findSlot, GOALKEEPER_SLOT_ID, TACTICAL_GRID, TACTICAL_SLOTS } from "./slots";

describe("grade tática", () => {
  it("tem 29 slots com identificadores únicos", () => {
    expect(TACTICAL_SLOTS).toHaveLength(29);
    expect(new Set(TACTICAL_SLOTS.map(({ id }) => id)).size).toBe(29);
  });

  it("mantém todos os slots dentro da grade 7x5 anunciada", () => {
    expect(TACTICAL_GRID.columns).toHaveLength(7);
    expect(TACTICAL_GRID.rows).toHaveLength(5);
    for (const slot of TACTICAL_SLOTS) {
      expect(TACTICAL_GRID.columns).toContain(slot.zone.column);
      expect(TACTICAL_GRID.rows).toContain(slot.zone.row);
    }
  });

  it("não coloca dois slots na mesma célula", () => {
    const cells = TACTICAL_SLOTS.map(({ zone }) => `${zone.column}:${zone.row}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it("reserva o gol a um único slot e só ao goleiro", () => {
    const goalSlots = TACTICAL_SLOTS.filter((slot) => slot.allowedPositions.includes("goalkeeper"));
    expect(goalSlots.map(({ id }) => id)).toEqual([GOALKEEPER_SLOT_ID]);
    expect(goalSlots[0].allowedPositions).toEqual(["goalkeeper"]);
  });

  it("só admite posições que existem e sem repetição", () => {
    for (const slot of TACTICAL_SLOTS) {
      expect(slot.allowedPositions.length).toBeGreaterThan(0);
      expect(new Set(slot.allowedPositions).size).toBe(slot.allowedPositions.length);
      for (const position of slot.allowedPositions) expect(PLAYER_POSITIONS).toContain(position);
    }
  });

  it("mantém o lado do slot coerente com a linha na grade", () => {
    for (const slot of TACTICAL_SLOTS) {
      const expected = slot.zone.row < 4 ? "left" : slot.zone.row > 4 ? "right" : "center";
      expect(slot.side).toBe(expected);
    }
  });

  it("cobre toda posição de linha em pelo menos um slot", () => {
    const covered = new Set(TACTICAL_SLOTS.flatMap((slot) => slot.allowedPositions));
    for (const position of PLAYER_POSITIONS) expect(covered).toContain(position);
  });
});

describe("formações", () => {
  it("tem onze slots existentes e distintos em cada preset", () => {
    for (const formation of FORMATIONS) {
      expect(isCompleteFormation(formation)).toBe(true);
      for (const slotId of formation.slots) expect(findSlot(slotId)).not.toBeNull();
    }
  });

  it("escala exatamente um goleiro em cada preset", () => {
    for (const formation of FORMATIONS) {
      expect(formation.slots.filter((slotId) => slotId === GOALKEEPER_SLOT_ID)).toHaveLength(1);
    }
  });
});
