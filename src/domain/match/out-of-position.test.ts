import { describe, expect, it } from "vitest";
import { referenceParticipants } from "./__fixtures__/reference-match";
import { thinkingInterval } from "./ai";
import { createMatchState } from "./index";
import { positionFit } from "../tactics/position-fit";
import { findSlot } from "../tactics/slots";

/**
 * O encaixe do jogador no slot (`positionFit`) sai do plano tático e chega ao motor junto com o
 * participante. Aqui se verifica que ele **custa** alguma coisa: quem joga improvisado lê o jogo
 * mais devagar e erra mais decisões, sem ficar mais lento nem mais fraco — habilidade é uma
 * coisa, familiaridade com a função é outra.
 */
describe("custo de jogar fora de posição", () => {
  it("dá encaixe pleno a quem está na posição natural", () => {
    const state = createMatchState({ seed: 1, learningEnabled: false, participants: referenceParticipants() });
    for (const player of state.players) expect(player.positionFit).toBe(1);
  });

  it("cobra leitura de jogo de quem foi escalado fora da posição", () => {
    const participants = referenceParticipants();
    // Mesmo atleta, slot que não é dele: o ponta-esquerda vai jogar de meia-armador central.
    const winger = participants.find((p) => p.team === "blue" && p.profile.position === "leftWing")!;
    const slot = findSlot("mo")!;
    winger.slotId = slot.id;
    winger.positionFit = positionFit(winger.profile, slot).rating;
    expect(winger.positionFit).toBeGreaterThan(0);
    expect(winger.positionFit).toBeLessThan(1);

    const state = createMatchState({ seed: 1, learningEnabled: false, participants });
    const improvised = state.players.find((p) => p.profile.id === winger.profile.id)!;
    expect(improvised.positionFit).toBe(winger.positionFit);

    // Uma variável só: o mesmo jogador, encaixado e improvisado.
    const settled = thinkingInterval({ ...improvised, positionFit: 1 });
    expect(thinkingInterval(improvised)).toBeGreaterThan(settled);
  });
});
