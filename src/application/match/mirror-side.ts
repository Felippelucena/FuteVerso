import type { PlayerMemory } from "../../domain/roster/model";
import type { MatchSide } from "./build-match-config";

/**
 * Um clube pode enfrentar a si mesmo — é como se testa um plano contra outro sem trocar o
 * elenco. Só que o motor identifica quem está em campo pelo id do perfil, e os dois lados não
 * podem ser os mesmos onze ids: com a bola no pé de "nilo-fw" não haveria como saber de quem
 * ela é. Então o visitante entra com **cópias**: os mesmos atletas, identidade própria nesta
 * partida.
 *
 * O que a cópia aprende não volta ao catálogo (ver `isMirrored`): seriam duas memórias
 * diferentes para o mesmo atleta e o desempate ficaria por conta da ordem de gravação.
 */
const PREFIX = "espelho:";

const mirrorId = (id: string): string => `${PREFIX}${id}`;

export const isMirrored = (id: string): boolean => id.startsWith(PREFIX);

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Espelha um lado inteiro — elenco, vínculos e plano — e dá às cópias a memória do original,
 * para que os dois lados entrem sabendo o mesmo. `memories` é preenchido no lugar, como o resto
 * do contexto da partida.
 */
export const mirrorSide = (side: MatchSide, memories: Record<string, PlayerMemory>): MatchSide => {
  for (const player of side.squad) {
    const learned = memories[player.id];
    if (learned) memories[mirrorId(player.id)] = { ...clone(learned), playerId: mirrorId(player.id) };
  }
  return {
    club: side.club,
    squad: side.squad.map((player) => ({ ...clone(player), id: mirrorId(player.id) })),
    contracts: side.contracts.map((contract) => ({
      ...contract,
      id: mirrorId(contract.id),
      playerId: mirrorId(contract.playerId),
    })),
    plan: {
      ...clone(side.plan),
      assignments: side.plan.assignments.map((assignment) => ({
        ...assignment,
        playerId: mirrorId(assignment.playerId),
      })),
      bench: side.plan.bench.map(mirrorId),
    },
  };
};
