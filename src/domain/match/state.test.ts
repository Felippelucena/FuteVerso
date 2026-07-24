import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { formationAnchor } from "./ai";
import { FIELD } from "./config";
import { createMatchState } from "./index";

const createTestMatch = (seed?: number) => createMatchState(referenceMatchConfig(seed));

describe("estado inicial e escalações", () => {
  // O campo é redimensionado sempre que o formato muda (4x4 → 5x5 → 11x11), então fixar as
  // medidas aqui só produziria um teste desatualizado a cada mudança. O que precisa valer em
  // qualquer escala são as relações entre as partes.
  it("mantém campo e gol proporcionais em qualquer escala", () => {
    const goalOpening = FIELD.goalBottom - FIELD.goalTop;

    // Proporção de um gramado de futebol de campo: mais largo que alto, sem chegar a um corredor.
    expect(FIELD.width / FIELD.height).toBeGreaterThan(1.3);
    expect(FIELD.width / FIELD.height).toBeLessThan(2);

    // O gol cabe na linha de fundo e é uma fração pequena dela; centralizado nos dois lados.
    expect(goalOpening).toBeGreaterThan(FIELD.height * 0.1);
    expect(goalOpening).toBeLessThan(FIELD.height * 0.35);
    expect(FIELD.goalTop).toBeCloseTo(FIELD.height - FIELD.goalBottom, 5);

    // A grande área envolve o gol e cabe em menos de metade do campo.
    expect(FIELD.penaltyWidth).toBeGreaterThan(goalOpening);
    expect(FIELD.penaltyWidth).toBeLessThan(FIELD.height);
    expect(FIELD.penaltyDepth).toBeGreaterThan(FIELD.goalAreaDepth);
    expect(FIELD.penaltyDepth).toBeLessThan(FIELD.width / 2);

    // Jogador e bola cabem no gol; a bola é menor que o jogador.
    expect(FIELD.goalDepth).toBeGreaterThan(0);
    expect(FIELD.ballRadius).toBeLessThan(FIELD.playerRadius);
    expect(FIELD.playerRadius * 2).toBeLessThan(goalOpening);
  });

  it("cria dez titulares com um goleiro por time", () => {
    const state = createTestMatch();
    expect(state.players).toHaveLength(10);
    for (const team of ["blue", "coral"] as const) {
      expect(state.players.filter((player) => player.team === team && player.profile.position === "goalkeeper")).toHaveLength(1);
      expect(state.players.filter((player) => player.team === team && player.profile.position !== "goalkeeper")).toHaveLength(4);
    }
  });

  it("veste cada titular com a camisa vinda do participante", () => {
    const config = referenceMatchConfig();
    const state = createMatchState(config);
    for (const participant of config.participants) {
      const runtime = state.players.find((player) => player.profile.id === participant.profile.id)!;
      expect(runtime.shirtNumber).toBe(participant.shirtNumber);
    }
  });

  it("faz posição e função alterarem a âncora", () => {
    const state = createTestMatch();
    const defender = state.players.find((player) => player.profile.position === "centerBack")!;
    const teammates = state.players.filter((player) => player.team === defender.team);
    const original = formationAnchor(defender, teammates);
    defender.profile.role = "finisher";
    expect(formationAnchor(defender, teammates).x).not.toBe(original.x);
  });
});
