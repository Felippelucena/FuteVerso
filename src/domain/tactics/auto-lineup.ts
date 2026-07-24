import type { PlayerProfile } from "../roster/model";
import { playerOverall } from "../roster/rating";
import { defaultFormation, type Formation } from "./formations";
import type { TeamTacticalPlan } from "./model";
import { createEmptyPlan } from "./rules";
import { positionFit } from "./position-fit";
import { findSlot, type TacticalSlot } from "./slots";

/**
 * Peso do encaixe na escolha automática. É o quadrado do `rating` porque a penalidade que o
 * motor aplica (12% para um improviso leve) é fraca demais para decidir escalação: sem isso,
 * um meia bom o bastante tira o zagueiro reserva da vaga e o time entra sem zaga. Elevar ao
 * quadrado mantém o titular natural à frente sem impedir que um jogador muito superior
 * ocupe uma vaga vizinha.
 */
const selectionWeight = (rating: number): number => rating * rating;

const isImprovised = (player: PlayerProfile, slot: TacticalSlot): boolean => {
  const level = positionFit(player, slot).level;
  return level === "awkward" || level === "makeshift";
};

const slotValue = (player: PlayerProfile, slot: TacticalSlot): number => {
  const fit = positionFit(player, slot);
  return fit.level === "blocked" ? -1 : playerOverall(player) * selectionWeight(fit.rating);
};

/**
 * Escalação automática: percorre os slots do preset e entrega cada um ao melhor jogador
 * ainda disponível, medindo nota geral corrigida pelo encaixe. Os slots são atendidos do
 * mais escasso para o menos — o gol antes de tudo, depois quem tem menos candidatos —
 * porque atender na ordem do campo gastaria o único goleiro num slot de linha.
 */
export const autoPickPlan = (
  players: PlayerProfile[],
  formation: Formation = defaultFormation(),
  base: TeamTacticalPlan = createEmptyPlan(),
): TeamTacticalPlan => {
  const slots = formation.slots
    .map(findSlot)
    .filter((slot): slot is TacticalSlot => slot !== null);
  const available = [...players];

  // Escassez conta só quem joga o slot sem improvisar. Contar todo mundo que não é goleiro
  // daria o mesmo número para todas as vagas de linha e a ordem viraria a do preset.
  const scarcity = new Map<string, number>(slots.map((slot) => [
    slot.id,
    available.filter((player) => positionFit(player, slot).level !== "blocked" && !isImprovised(player, slot)).length,
  ]));
  const ordered = [...slots].sort((first, second) => (scarcity.get(first.id) ?? 0) - (scarcity.get(second.id) ?? 0));

  const assignments: TeamTacticalPlan["assignments"] = [];
  for (const slot of ordered) {
    let bestIndex = -1;
    let bestValue = -1;
    for (let index = 0; index < available.length; index += 1) {
      const value = slotValue(available[index], slot);
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    if (bestIndex < 0 || bestValue < 0) continue;
    assignments.push({ slotId: slot.id, playerId: available[bestIndex].id });
    available.splice(bestIndex, 1);
  }

  const bench = available
    .sort((first, second) => playerOverall(second) - playerOverall(first))
    .map((player) => player.id);

  return { ...base, formationId: formation.id, assignments, bench };
};
