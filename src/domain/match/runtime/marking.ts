import { clamp, distance } from "../../shared/math";
import { DEFENSE, FIELD } from "../config";
import type { MatchState, PlayerRuntime, Team, TeamCollectivePlan } from "../model";
import { activeBallPlayerId } from "./control";
import { goalCenter } from "./formation-geometry";

/**
 * Por quem cada defensor responde **agora**.
 *
 * A pergunta é resolvida a cada pensamento, e não a cada dois segundos junto com o plano
 * coletivo: nesse tempo um atacante corre trinta metros, e o defensor ficava respondendo por um
 * homem que já não estava mais ali. E é medida do corpo do defensor, não da âncora ideal da
 * célula dele — quem está deslocado marca quem está perto de si, não quem está perto de onde
 * ele deveria estar.
 *
 * A firmeza é a outra metade: longe da bola manda a zona, e o defensor sustenta a posição; com a
 * bola chegando, a marcação vira individual. Uma regra só, regulada pela distância — é o que
 * "zona com pega firme" quer dizer.
 */
export interface MarkingAssignment {
  mark: PlayerRuntime;
  /** 0 = sustenta a célula e só observa o vizinho; 1 = cola no homem. */
  tightness: number;
}

/**
 * Adversários por perigo — o mais perigoso primeiro. Perto do nosso gol, perto da bola, no meio.
 *
 * Quem está com a bola fica de fora, junto do goleiro: ele é objeto do dever `press`, e marcar é
 * responder pelas SAÍDAS dele. Como o peso da distância à bola é o maior da conta e o portador tem
 * distância zero, ele era sempre a ameaça nº 1 — e levava um zagueiro colado, com firmeza máxima,
 * em cima de quem o pressionador já estava. Dois homens na mesma bola é buraco atrás, e é
 * exatamente o que `CONTEST.pressSlots` recusa a gastar.
 */
export const rankThreats = (state: MatchState, team: Team, opponents: PlayerRuntime[]): PlayerRuntime[] => {
  const ownGoal = goalCenter(team, true);
  const actorId = activeBallPlayerId(state);
  const threat = (opponent: PlayerRuntime): number => distance(opponent.position, ownGoal) * 0.54
    + distance(opponent.position, state.ball.position) * 0.34
    + Math.abs(opponent.position.y - FIELD.height / 2) * 0.12;
  return [...opponents]
    .filter((opponent) => opponent.profile.position !== "goalkeeper" && opponent.profile.id !== actorId)
    .sort((first, second) => threat(first) - threat(second)
      || first.profile.id.localeCompare(second.profile.id));
};

const tightnessFor = (state: MatchState, mark: PlayerRuntime, marksMan: boolean): number => {
  if (marksMan) return 1;
  const ballGap = distance(mark.position, state.ball.position);
  const closeness = clamp(1 - ballGap / (FIELD.width * DEFENSE.tightenRange), 0, 1);
  // A raiz mantém a marcação firme em toda a faixa de perigo e só a afrouxa quando a bola está
  // de fato longe. Linear, o defensor ficava a meio caminho do homem justamente entre as
  // linhas, que é onde o passe entre elas acontece.
  return clamp(Math.sqrt(closeness), DEFENSE.zoneTightness, 1);
};

/**
 * Distribui os marcados entre quem sustenta a linha. Os mais perigosos escolhem primeiro, e cada
 * um leva o defensor livre mais próximo dentro do alcance — assim o homem que ameaça o gol nunca
 * fica sem ninguém porque um companheiro menos perigoso levou o zagueiro embora.
 */
export const resolveMarking = (
  state: MatchState,
  team: Team,
  plan: TeamCollectivePlan | null | undefined,
): Map<string, MarkingAssignment> => {
  const marking = new Map<string, MarkingAssignment>();
  if (!plan) return marking;
  const defenders = state.players.filter((player) => player.team === team
    && player.profile.position !== "goalkeeper"
    && (plan.assignments[player.profile.id]?.duty === "holdLine"
      || plan.assignments[player.profile.id]?.duty === "trackRunner"));
  if (defenders.length === 0) return marking;
  const opponents = state.players.filter((player) => player.team !== team);
  const reach = FIELD.width * DEFENSE.zoneRadius;
  const free = new Set(defenders.map((defender) => defender.profile.id));
  for (const threat of rankThreats(state, team, opponents)) {
    const closest = defenders
      .filter((defender) => free.has(defender.profile.id))
      .map((defender) => ({ defender, gap: distance(defender.position, threat.position) }))
      .filter(({ defender, gap }) => gap <= reach
        // Marcação individual pedida pelo treinador não tem alcance: ela persegue o homem.
        || plan.assignments[defender.profile.id]?.duty === "trackRunner")
      .sort((first, second) => first.gap - second.gap
        || first.defender.profile.id.localeCompare(second.defender.profile.id))[0];
    if (!closest) continue;
    free.delete(closest.defender.profile.id);
    const marksMan = plan.assignments[closest.defender.profile.id]?.duty === "trackRunner";
    marking.set(closest.defender.profile.id, {
      mark: threat,
      tightness: tightnessFor(state, threat, marksMan),
    });
    if (free.size === 0) break;
  }
  return marking;
};
