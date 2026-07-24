import { createMentalAttributes } from "../../roster/personality";
import type { PlayerProfile, PlayerSkills } from "../../roster/model";
import { createMemory } from "../../roster/rules";
import type { Team } from "../../shared/model";
import { DEFAULT_MATCH_SEED } from "../config";
import type { MatchConfig, MatchParticipant } from "../model";

/**
 * Elenco fixo usado pelos testes do motor. Existe para desacoplar a simulação do catálogo
 * editável: gerar clubes novos, mudar o gerador ou editar conteúdo não pode alterar o
 * fingerprint determinístico da partida.
 *
 * Estes são os mesmos dez jogadores do antigo elenco embutido, com as posições traduzidas
 * para a taxonomia de doze de forma a preservar as âncoras originais — por isso o "volante"
 * aparece como centerMid, e não defensiveMid: o objetivo aqui é comparabilidade histórica,
 * não realismo. O conteúdo realista vem dos geradores em content/.
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
  player({ id: "nilo-gk", name: "Caio", position: "goalkeeper", role: "defender", skills: skills({ goalkeeping: 84, defending: 74, passing: 62, vision: 67 }), mental: createMentalAttributes("disciplined", { composure: 88 }) }),
  player({ id: "nilo-cb", name: "Bento", position: "centerBack", role: "defender", skills: skills({ defending: 82, kickPower: 72, stamina: 77 }), mental: createMentalAttributes("intense", { teamwork: 80 }) }),
  player({ id: "nilo-mid", name: "Iuri", position: "centerMid", role: "playmaker", skills: skills({ passing: 84, vision: 86, control: 79, stamina: 80 }), mental: createMentalAttributes("cerebral") }),
  player({ id: "nilo-vol", name: "Théo", position: "centerMid", role: "defender", skills: skills({ defending: 78, passing: 76, stamina: 85, vision: 74, control: 72 }), mental: createMentalAttributes("disciplined", { teamwork: 84, intensity: 80 }) }),
  player({ id: "nilo-fw", name: "Nilo", position: "striker", role: "finisher", skills: skills({ acceleration: 84, sprintSpeed: 83, burst: 88, finishing: 82, control: 78 }), mental: createMentalAttributes("bold") }),
  player({ id: "maya-gk", name: "Lia", position: "goalkeeper", role: "defender", skills: skills({ goalkeeping: 86, defending: 72, passing: 68, vision: 70 }), mental: createMentalAttributes("cerebral", { creativity: 58 }) }),
  player({ id: "maya-cb", name: "Cora", position: "centerBack", role: "defender", skills: skills({ defending: 84, acceleration: 69, stamina: 78 }), mental: createMentalAttributes("disciplined") }),
  player({ id: "maya-mid", name: "Tess", position: "centerMid", role: "playmaker", skills: skills({ passing: 82, vision: 84, control: 84, acceleration: 72 }), mental: createMentalAttributes("creative") }),
  player({ id: "maya-vol", name: "Bruna", position: "centerMid", role: "defender", skills: skills({ defending: 79, passing: 78, stamina: 83, vision: 76, control: 74 }), mental: createMentalAttributes("intense", { teamwork: 82, composure: 70 }) }),
  player({ id: "maya-fw", name: "Maya", position: "striker", role: "finisher", skills: skills({ finishing: 86, control: 86, passing: 70, burst: 76 }), mental: createMentalAttributes("creative", { composure: 84, aggression: 64 }) }),
];

/** Ordem de entrada em campo por time: goleiro primeiro, depois a linha. */
export const REFERENCE_LINEUPS: Record<Team, readonly string[]> = {
  blue: ["nilo-gk", "nilo-cb", "nilo-mid", "nilo-vol", "nilo-fw"],
  coral: ["maya-gk", "maya-cb", "maya-mid", "maya-vol", "maya-fw"],
};

const SHIRT_NUMBERS: Record<string, number> = {
  "nilo-gk": 1, "nilo-cb": 4, "nilo-mid": 8, "nilo-vol": 5, "nilo-fw": 7,
  "maya-gk": 1, "maya-cb": 3, "maya-mid": 6, "maya-vol": 5, "maya-fw": 10,
};

const clone = <T>(value: T): T => structuredClone(value);

export const referenceParticipants = (): MatchParticipant[] => {
  const byId = new Map(REFERENCE_PLAYERS.map((profile) => [profile.id, profile]));
  return (["blue", "coral"] as const).flatMap((team) =>
    REFERENCE_LINEUPS[team].map((playerId, lineupIndex) => {
      const profile = clone(byId.get(playerId)!);
      return {
        team,
        lineupIndex,
        profile,
        memory: createMemory(profile),
        shirtNumber: SHIRT_NUMBERS[playerId],
      };
    }));
};

export const referenceMatchConfig = (seed: number = DEFAULT_MATCH_SEED): MatchConfig => ({
  seed,
  learningEnabled: true,
  participants: referenceParticipants(),
});
