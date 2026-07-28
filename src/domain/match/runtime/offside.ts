import { OFFSIDE } from "../config";
import type { MatchState, PlayerRuntime, Team } from "../model";
import { attackingProgress } from "./pitch";

/**
 * Lei 11 (impedimento), a parte que é geometria e não estado. Tudo aqui é **puro**: lê posições,
 * não muta nada e não saca RNG — a aplicação (armar a vigilância, apitar a infração, reiniciar)
 * vive nos sistemas. Manter a leitura separada é o que deixa a regra testável ponto a ponto.
 *
 * A infração tem dois instantes distintos, e confundi-los é o erro clássico:
 *
 * - **Julgamento:** no momento em que um companheiro **toca** a bola (aqui, um passe). É neste
 *   instante que se congela quem está em posição de impedimento.
 * - **Punição:** só depois, quando um desses jogadores **se envolve na jogada** (encosta na
 *   bola). Estar em posição de impedimento nunca é, por si, infração.
 */

/**
 * A linha do impedimento: o **penúltimo** adversário rumo ao próprio gol (contando o goleiro).
 * Normalmente é o último zagueiro, já que o goleiro costuma ser o último de todos. Empatar com
 * essa linha é posição legal, então quem consome exige estar claramente à frente dela.
 */
export const offsideLineProgress = (state: MatchState, team: Team): number => {
  const progresses = state.players
    .filter((player) => player.team !== team)
    .map((player) => attackingProgress(team, player.position.x))
    .sort((first, second) => second - first);
  return progresses[1] ?? 1;
};

/**
 * Um jogador está em posição de impedimento se, no campo de ataque, está à frente da bola **e**
 * da linha do penúltimo adversário. A tolerância absorve o "empate é legal": exige estar à
 * frente por uma margem, não apenas por um décimo de unidade de arredondamento.
 */
const inOffsidePosition = (
  team: Team,
  player: PlayerRuntime,
  lineProgress: number,
  ballProgress: number,
): boolean => {
  const progress = attackingProgress(team, player.position.x);
  return progress > 0.5 + OFFSIDE.toleranceProgress
    && progress > ballProgress + OFFSIDE.toleranceProgress
    && progress > lineProgress + OFFSIDE.toleranceProgress;
};

/**
 * Quem, no time que toca a bola, está em posição de impedimento no instante do passe. O próprio
 * cobrador nunca entra (ele tinha a bola), nem o goleiro (posição sem relevância prática).
 */
export const offsideOffendersAtPass = (
  state: MatchState,
  team: Team,
  passerId: string,
): { offenders: string[]; lineProgress: number } => {
  const lineProgress = offsideLineProgress(state, team);
  const ballProgress = attackingProgress(team, state.ball.position.x);
  const offenders = state.players
    .filter((player) => player.team === team
      && player.profile.id !== passerId
      && player.profile.position !== "goalkeeper"
      && inOffsidePosition(team, player, lineProgress, ballProgress))
    .map((player) => player.profile.id);
  return { offenders, lineProgress };
};
