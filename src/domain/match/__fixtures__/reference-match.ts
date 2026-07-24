import { createMentalAttributes } from "../../roster/personality";
import type { PlayerProfile, PlayerSkills } from "../../roster/model";
import { createMemory } from "../../roster/rules";
import { DEFAULT_INSTRUCTION } from "../../tactics/model";
import { positionFit } from "../../tactics/position-fit";
import { findSlot, type TacticalSlotId } from "../../tactics/slots";
import type { Team } from "../../shared/model";
import { DEFAULT_MATCH_SEED } from "../config";
import type { MatchConfig, MatchParticipant } from "../model";

/**
 * Elencos fixos usados pelos testes do motor. Existem para desacoplar a simulação do catálogo
 * editável: gerar clubes novos, mudar o gerador ou editar conteúdo não pode alterar o
 * fingerprint determinístico da partida.
 *
 * Duas escalações saem daqui:
 *
 * - `referenceMatchConfig` monta o 11x11, que é o formato do jogo. É o que caracterização,
 *   simulação e calibragem medem.
 * - `smallSidedMatchConfig` monta um 5x5 enxuto para os testes de comportamento (finta,
 *   contato, condução, goleiro, colisão), onde vinte e dois corpos em campo só atrapalhariam
 *   a leitura do cenário.
 */
const skills = (values: Partial<PlayerSkills>): PlayerSkills => ({
  acceleration: 65,
  sprintSpeed: 65,
  burst: 65,
  stamina: 70,
  control: 65,
  passing: 65,
  vision: 65,
  finishing: 60,
  defending: 60,
  kickPower: 65,
  goalkeeping: 20,
  ...values,
});

const player = (
  profile: Omit<PlayerProfile, "nationality" | "birthYear" | "secondaryPositions">,
): PlayerProfile => ({ ...profile, nationality: "BR", birthYear: 2000, secondaryPositions: [] });

export const REFERENCE_PLAYERS: readonly PlayerProfile[] = [
  // Nilo (blue)
  player({ id: "nilo-gk", name: "Caio", position: "goalkeeper", role: "defender", skills: skills({ goalkeeping: 84, defending: 74, passing: 62, vision: 67 }), mental: createMentalAttributes("disciplined", { composure: 88 }) }),
  player({ id: "nilo-cb", name: "Bento", position: "centerBack", role: "defender", skills: skills({ defending: 82, kickPower: 72, stamina: 77 }), mental: createMentalAttributes("intense", { teamwork: 80 }) }),
  player({ id: "nilo-cb2", name: "Rangel", position: "centerBack", role: "defender", skills: skills({ defending: 79, kickPower: 70, stamina: 75, passing: 68 }), mental: createMentalAttributes("disciplined", { aggression: 70 }) }),
  player({ id: "nilo-lb", name: "Wesley", position: "leftBack", role: "defender", skills: skills({ defending: 73, sprintSpeed: 78, acceleration: 77, stamina: 84, passing: 70 }), mental: createMentalAttributes("intense", { teamwork: 76 }) }),
  player({ id: "nilo-rb", name: "Danilo", position: "rightBack", role: "defender", skills: skills({ defending: 74, sprintSpeed: 79, acceleration: 76, stamina: 83, passing: 71 }), mental: createMentalAttributes("disciplined", { intensity: 78 }) }),
  player({ id: "nilo-dm", name: "Otávio", position: "defensiveMid", role: "defender", skills: skills({ defending: 80, passing: 75, stamina: 86, vision: 72, control: 70 }), mental: createMentalAttributes("disciplined", { teamwork: 82 }) }),
  player({ id: "nilo-mid", name: "Iuri", position: "centerMid", role: "playmaker", skills: skills({ passing: 84, vision: 86, control: 79, stamina: 80 }), mental: createMentalAttributes("cerebral") }),
  player({ id: "nilo-vol", name: "Théo", position: "centerMid", role: "defender", skills: skills({ defending: 78, passing: 76, stamina: 85, vision: 74, control: 72 }), mental: createMentalAttributes("disciplined", { teamwork: 84, intensity: 80 }) }),
  player({ id: "nilo-lw", name: "Kauê", position: "leftWing", role: "finisher", skills: skills({ acceleration: 86, sprintSpeed: 85, burst: 84, control: 76, finishing: 72 }), mental: createMentalAttributes("bold", { creativity: 82 }) }),
  player({ id: "nilo-rw", name: "Pablo", position: "rightWing", role: "finisher", skills: skills({ acceleration: 85, sprintSpeed: 84, burst: 83, control: 75, finishing: 71 }), mental: createMentalAttributes("creative", { aggression: 70 }) }),
  player({ id: "nilo-fw", name: "Nilo", position: "striker", role: "finisher", skills: skills({ acceleration: 84, sprintSpeed: 83, burst: 88, finishing: 82, control: 78 }), mental: createMentalAttributes("bold") }),

  // Maya (coral)
  player({ id: "maya-gk", name: "Lia", position: "goalkeeper", role: "defender", skills: skills({ goalkeeping: 86, defending: 72, passing: 68, vision: 70 }), mental: createMentalAttributes("cerebral", { creativity: 58 }) }),
  player({ id: "maya-cb", name: "Cora", position: "centerBack", role: "defender", skills: skills({ defending: 84, acceleration: 69, stamina: 78 }), mental: createMentalAttributes("disciplined") }),
  player({ id: "maya-cb2", name: "Vera", position: "centerBack", role: "defender", skills: skills({ defending: 80, acceleration: 71, stamina: 77, passing: 69 }), mental: createMentalAttributes("intense", { composure: 74 }) }),
  player({ id: "maya-lb", name: "Alice", position: "leftBack", role: "defender", skills: skills({ defending: 72, sprintSpeed: 80, acceleration: 79, stamina: 85, passing: 72 }), mental: createMentalAttributes("intense", { teamwork: 78 }) }),
  player({ id: "maya-rb", name: "Nina", position: "rightBack", role: "defender", skills: skills({ defending: 73, sprintSpeed: 78, acceleration: 77, stamina: 84, passing: 70 }), mental: createMentalAttributes("disciplined", { intensity: 76 }) }),
  player({ id: "maya-dm", name: "Rita", position: "defensiveMid", role: "defender", skills: skills({ defending: 81, passing: 74, stamina: 87, vision: 71, control: 71 }), mental: createMentalAttributes("disciplined", { teamwork: 84 }) }),
  player({ id: "maya-mid", name: "Tess", position: "centerMid", role: "playmaker", skills: skills({ passing: 82, vision: 84, control: 84, acceleration: 72 }), mental: createMentalAttributes("creative") }),
  player({ id: "maya-vol", name: "Bruna", position: "centerMid", role: "defender", skills: skills({ defending: 79, passing: 78, stamina: 83, vision: 76, control: 74 }), mental: createMentalAttributes("intense", { teamwork: 82, composure: 70 }) }),
  player({ id: "maya-lw", name: "Duda", position: "leftWing", role: "finisher", skills: skills({ acceleration: 85, sprintSpeed: 86, burst: 82, control: 78, finishing: 73 }), mental: createMentalAttributes("bold", { creativity: 80 }) }),
  player({ id: "maya-rw", name: "Sofia", position: "rightWing", role: "finisher", skills: skills({ acceleration: 84, sprintSpeed: 85, burst: 81, control: 77, finishing: 72 }), mental: createMentalAttributes("creative", { aggression: 68 }) }),
  player({ id: "maya-fw", name: "Maya", position: "striker", role: "finisher", skills: skills({ finishing: 86, control: 86, passing: 70, burst: 76 }), mental: createMentalAttributes("creative", { composure: 84, aggression: 64 }) }),
];

const SHIRT_NUMBERS: Record<string, number> = {
  "nilo-gk": 1, "nilo-rb": 2, "nilo-cb2": 3, "nilo-cb": 4, "nilo-dm": 5, "nilo-lb": 6,
  "nilo-rw": 7, "nilo-mid": 8, "nilo-fw": 9, "nilo-lw": 11, "nilo-vol": 15,
  "maya-gk": 1, "maya-rb": 2, "maya-cb": 3, "maya-cb2": 4, "maya-dm": 5, "maya-lb": 6,
  "maya-rw": 7, "maya-mid": 8, "maya-lw": 11, "maya-fw": 10, "maya-vol": 15,
};

type SlotAssignment = readonly [TacticalSlotId, string];

/** 4-3-3: o formato em que o jogo roda. */
const ELEVEN: Record<Team, readonly SlotAssignment[]> = {
  blue: [
    ["gol", "nilo-gk"],
    ["le", "nilo-lb"], ["zag-e", "nilo-cb"], ["zag-d", "nilo-cb2"], ["ld", "nilo-rb"],
    ["med", "nilo-dm"], ["mc-e", "nilo-vol"], ["mc-d", "nilo-mid"],
    ["pe", "nilo-lw"], ["ata", "nilo-fw"], ["pd", "nilo-rw"],
  ],
  coral: [
    ["gol", "maya-gk"],
    ["le", "maya-lb"], ["zag-e", "maya-cb"], ["zag-d", "maya-cb2"], ["ld", "maya-rb"],
    ["med", "maya-dm"], ["mc-e", "maya-vol"], ["mc-d", "maya-mid"],
    ["pe", "maya-lw"], ["ata", "maya-fw"], ["pd", "maya-rw"],
  ],
};

/** 1-1-2-1 enxuto: cenários de comportamento com o campo limpo. */
const FIVE: Record<Team, readonly SlotAssignment[]> = {
  blue: [["gol", "nilo-gk"], ["zag", "nilo-cb"], ["mc-e", "nilo-vol"], ["mc-d", "nilo-mid"], ["ata", "nilo-fw"]],
  coral: [["gol", "maya-gk"], ["zag", "maya-cb"], ["mc-e", "maya-vol"], ["mc-d", "maya-mid"], ["ata", "maya-fw"]],
};

const clone = <T>(value: T): T => structuredClone(value);

const buildParticipants = (lineups: Record<Team, readonly SlotAssignment[]>): MatchParticipant[] => {
  const byId = new Map(REFERENCE_PLAYERS.map((profile) => [profile.id, profile]));
  return (["blue", "coral"] as const).flatMap((team) =>
    lineups[team].map(([slotId, playerId], lineupIndex) => {
      const profile = clone(byId.get(playerId)!);
      const slot = findSlot(slotId)!;
      return {
        team,
        lineupIndex,
        profile,
        memory: createMemory(profile),
        shirtNumber: SHIRT_NUMBERS[playerId],
        slotId: slot.id,
        positionFit: positionFit(profile, slot).rating,
        instruction: { ...DEFAULT_INSTRUCTION },
      };
    }));
};

export const referenceParticipants = (): MatchParticipant[] => buildParticipants(ELEVEN);

/** Partida no formato do jogo: onze contra onze. */
export const referenceMatchConfig = (seed: number = DEFAULT_MATCH_SEED): MatchConfig => ({
  seed,
  learningEnabled: true,
  participants: referenceParticipants(),
});

/** Partida reduzida, para cenários de comportamento isolados. */
export const smallSidedMatchConfig = (seed: number = DEFAULT_MATCH_SEED): MatchConfig => ({
  seed,
  learningEnabled: true,
  participants: buildParticipants(FIVE),
});
