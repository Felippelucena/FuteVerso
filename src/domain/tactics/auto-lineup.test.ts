import { describe, expect, it } from "vitest";
import { REFERENCE_PLAYERS } from "../match/__fixtures__/reference-match";
import { applyFormation, autoPickPlan } from "./auto-lineup";
import { findFormation, matchFormation } from "./formations";
import { TEAM_SIZE } from "./model";

const squad = () => REFERENCE_PLAYERS.filter((player) => player.id.startsWith("nilo-"))
  .map((player) => structuredClone(player));

describe("mudar o desenho do time", () => {
  it("preserva os mesmos onze e o banco ao trocar de formação", () => {
    const players = squad();
    const original = autoPickPlan(players, findFormation("4-3-3")!);
    const trocado = applyFormation(original, findFormation("3-5-2")!, players);

    const antes = original.assignments.map(({ playerId }) => playerId).sort();
    const depois = trocado.assignments.map(({ playerId }) => playerId).sort();
    expect(depois).toEqual(antes);
    expect(trocado.bench).toEqual(original.bench);
    expect(trocado.assignments).toHaveLength(TEAM_SIZE);
    // Os slots, esses sim, são os do preset novo.
    expect(trocado.assignments.map(({ slotId }) => slotId).sort())
      .toEqual([...findFormation("3-5-2")!.slots].sort());
  });

  it("reconhece o preset pelo conjunto de slots, e só por ele", () => {
    const preset = findFormation("4-4-2")!;
    expect(matchFormation(preset.slots)?.id).toBe("4-4-2");
    // A ordem não importa: o que define o desenho é quais slots estão ocupados.
    expect(matchFormation([...preset.slots].reverse())?.id).toBe("4-4-2");
    // Um slot trocado deixa de ser preset — é formação personalizada.
    expect(matchFormation([...preset.slots.slice(1), "mo"])).toBeNull();
  });
});
