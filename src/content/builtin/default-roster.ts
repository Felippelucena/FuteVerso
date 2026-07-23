import type { Lineup, PlayerProfile, PlayerSkills } from "../../domain/roster/model";
import { createMentalAttributes } from "../../domain/roster/personality";
import type { Team } from "../../domain/shared/model";

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

export const DEFAULT_PLAYERS: PlayerProfile[] = [
  { id: "nilo-gk", name: "Caio", number: 1, position: "goalkeeper", role: "defender", skills: skills({ goalkeeping: 84, defending: 74, passing: 62, vision: 67 }), mental: createMentalAttributes("disciplined", { composure: 88 }) },
  { id: "nilo-cb", name: "Bento", number: 4, position: "centerBack", role: "defender", skills: skills({ defending: 82, kickPower: 72, stamina: 77 }), mental: createMentalAttributes("intense", { teamwork: 80 }) },
  { id: "nilo-mid", name: "Iuri", number: 8, position: "midfielder", role: "playmaker", skills: skills({ passing: 84, vision: 86, control: 79, stamina: 80 }), mental: createMentalAttributes("cerebral") },
  { id: "nilo-vol", name: "Théo", number: 5, position: "midfielder", role: "defender", skills: skills({ defending: 78, passing: 76, stamina: 85, vision: 74, control: 72 }), mental: createMentalAttributes("disciplined", { teamwork: 84, intensity: 80 }) },
  { id: "nilo-fw", name: "Nilo", number: 7, position: "forward", role: "finisher", skills: skills({ acceleration: 84, sprintSpeed: 83, burst: 88, finishing: 82, control: 78 }), mental: createMentalAttributes("bold") },
  { id: "maya-gk", name: "Lia", number: 1, position: "goalkeeper", role: "defender", skills: skills({ goalkeeping: 86, defending: 72, passing: 68, vision: 70 }), mental: createMentalAttributes("cerebral", { creativity: 58 }) },
  { id: "maya-cb", name: "Cora", number: 3, position: "centerBack", role: "defender", skills: skills({ defending: 84, acceleration: 69, stamina: 78 }), mental: createMentalAttributes("disciplined") },
  { id: "maya-mid", name: "Tess", number: 6, position: "midfielder", role: "playmaker", skills: skills({ passing: 82, vision: 84, control: 84, acceleration: 72 }), mental: createMentalAttributes("creative") },
  { id: "maya-vol", name: "Bruna", number: 5, position: "midfielder", role: "defender", skills: skills({ defending: 79, passing: 78, stamina: 83, vision: 76, control: 74 }), mental: createMentalAttributes("intense", { teamwork: 82, composure: 70 }) },
  { id: "maya-fw", name: "Maya", number: 10, position: "forward", role: "finisher", skills: skills({ finishing: 86, control: 86, passing: 70, burst: 76 }), mental: createMentalAttributes("creative", { composure: 84, aggression: 64 }) },
];

export const DEFAULT_LINEUPS: Record<Team, Lineup> = {
  blue: { goalkeeperId: "nilo-gk", fieldPlayerIds: ["nilo-cb", "nilo-mid", "nilo-vol", "nilo-fw"] },
  coral: { goalkeeperId: "maya-gk", fieldPlayerIds: ["maya-cb", "maya-mid", "maya-vol", "maya-fw"] },
};
