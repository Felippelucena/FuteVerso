import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { formationAnchor } from "./ai";
import { FIELD } from "./config";
import { createMatchState } from "./index";
import { TEAM_SIZE } from "../tactics/model";
import { findSlot } from "../tactics/slots";

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

  it("cria onze titulares com um goleiro por time", () => {
    const state = createTestMatch();
    expect(state.players).toHaveLength(TEAM_SIZE * 2);
    for (const team of ["blue", "coral"] as const) {
      expect(state.players.filter((player) => player.team === team && player.profile.position === "goalkeeper")).toHaveLength(1);
      expect(state.players.filter((player) => player.team === team && player.profile.position !== "goalkeeper")).toHaveLength(TEAM_SIZE - 1);
    }
  });

  it("ancora cada jogador na célula do slot em que foi escalado", () => {
    const state = createMatchState(referenceMatchConfig());
    for (const player of state.players) {
      const slot = findSlot(player.slotId)!;
      // Time azul ataca para a direita; o coral joga espelhado. A âncora tem que ficar do lado
      // certo do campo e na faixa lateral da linha do slot.
      const ownHalf = player.team === "blue" ? player.homeAnchor.x : FIELD.width - player.homeAnchor.x;
      expect(ownHalf).toBeGreaterThan(0);
      expect(ownHalf).toBeLessThan(FIELD.width * 0.62);
      const expectedLane = 0.25 + 0.5 * (slot.zone.row / 8);
      expect(player.homeAnchor.y).toBeCloseTo(FIELD.height * expectedLane, 5);
    }
  });

  it("ordena as âncoras do próprio gol para o ataque conforme a coluna do slot", () => {
    const state = createMatchState(referenceMatchConfig());
    const blue = state.players.filter((player) => player.team === "blue");
    const goalkeeper = blue.find((player) => player.profile.position === "goalkeeper")!;
    const striker = blue.find((player) => player.profile.position === "striker")!;

    expect(goalkeeper.homeAnchor.x).toBeLessThan(striker.homeAnchor.x);
    expect(findSlot(goalkeeper.slotId)!.zone.column).toBeLessThan(findSlot(striker.slotId)!.zone.column);
  });

  it("veste cada titular com a camisa vinda do participante", () => {
    const config = referenceMatchConfig();
    const state = createMatchState(config);
    for (const participant of config.participants) {
      const runtime = state.players.find((player) => player.profile.id === participant.profile.id)!;
      expect(runtime.shirtNumber).toBe(participant.shirtNumber);
    }
  });

  it("faz a função do jogador deslocar a âncora dentro do slot", () => {
    const state = createTestMatch();
    const defender = state.players.find((player) => player.profile.position === "centerBack")!;
    const original = formationAnchor(defender);
    defender.profile.role = "finisher";
    expect(formationAnchor(defender).x).not.toBe(original.x);
  });

  it("mantém o goleiro na linha do gol, sem deslocamento por função", () => {
    const state = createTestMatch();
    for (const team of ["blue", "coral"] as const) {
      const goalkeeper = state.players.find((player) => player.team === team && player.profile.position === "goalkeeper")!;
      const distanceToOwnGoal = team === "blue" ? goalkeeper.homeAnchor.x : FIELD.width - goalkeeper.homeAnchor.x;
      expect(distanceToOwnGoal).toBeCloseTo(FIELD.width * 0.06, 5);
      expect(goalkeeper.homeAnchor.y).toBeCloseTo(FIELD.height / 2, 5);
    }
  });
});
