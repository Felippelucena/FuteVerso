import { DUEL, FIELD, PHYSICS, REFEREE } from "../config";
import { clamp, distance } from "../../shared/math";
import type { Engagement, MatchState, PlayerRuntime } from "../model";
import { clearDribbleOwner, keeperHoldingBall } from "../runtime/control";
import { emitCognitiveEvent } from "../runtime/cognitive-events";
import { duelEdge } from "../runtime/duel";
import { activeChallengers, recklessChallenger } from "../runtime/engagement";
import { emitMatchEvent } from "../runtime/events";
import { resolveShot } from "../runtime/shot";

const holderOf = (state: MatchState): PlayerRuntime | null =>
  state.players.find((player) => player.profile.id === state.ball.controllerId) ?? null;

/**
 * Ciclo de vida da disputa pela bola. Nasce quando alguém alcança o portador, vive enquanto
 * houver corpo em cima dele, e morre quando a bola sai do pé — e é o caminho normal de bola solta,
 * não este sistema, que decide quem fica com ela. Por isso não há aqui nenhum desfecho escrito à
 * mão: o roubo limpo, a cutucada e o "aguentou" são o mesmo mecanismo visto em três instantes.
 *
 * As forças em si vivem em `runtime/engagement` e são aplicadas onde a bola é integrada
 * (`attachControlledBall`), para a bola nunca ser reposicionada — só acelerada.
 */
export const updateEngagement = (state: MatchState, dt: number): void => {
  const holder = holderOf(state);
  let previous = state.engagement;
  // A bola saiu de quem estava sendo disputado — seja para ninguém, seja direto para um
  // adversário. Ler só o caso "ficou sem dono" deixava o desarme sem crédito justamente quando
  // ele é mais limpo: o desafiante toma a bola no mesmo quadro em que ela escapa.
  if (previous && (!holder || holder.profile.id !== previous.holderId)) {
    if (previous.pried) creditTackle(state, previous.challengerIds);
    state.engagement = null;
    previous = null;
  }
  if (!holder) return;
  // Goleiro com a bola nas mãos é intocável: ninguém desarma uma posse segura na área.
  const challengers = keeperHoldingBall(state, holder) ? [] : activeChallengers(state, holder);
  if (challengers.length === 0) {
    state.engagement = null;
    return;
  }
  if (!previous || previous.holderId !== holder.profile.id) {
    // Disputa nova: conta a tentativa uma vez, por time, e não a cada quadro de contato.
    for (const team of new Set(challengers.map((challenger) => challenger.team))) {
      state.stats[team].tacklesAttempted += 1;
    }
    state.engagement = {
      holderId: holder.profile.id,
      challengerIds: challengers.map((challenger) => challenger.profile.id),
      startedAt: state.elapsed,
      advantage: 0,
      pried: false,
      recklessById: null,
      victimId: null,
    };
  } else {
    previous.challengerIds = challengers.map((challenger) => challenger.profile.id);
    previous.advantage = distance(state.ball.position, holder.position);
    if (resolveRecklessEntry(state, previous, holder, challengers)) return;
    // Bola já quase fora do pé: o portador está desequilibrado e não a retoma no mesmo instante.
    // Sem isto ele reclamaria a própria bola perdida no quadro seguinte — o desarme nunca sairia.
    // É também o que distingue desarme de passe: quem entrega a bola sob pressão nunca chega aqui.
    if (previous.advantage > PHYSICS.kickDistance) {
      previous.pried = true;
      holder.kickCooldown = Math.max(holder.kickCooldown, DUEL.beatenKickCooldown);
      holder.reactionTimer = Math.max(holder.reactionTimer, DUEL.beatenReaction);
    }
  }
  state.contestedSeconds += dt;
};

/**
 * Lei 12 + Lei 5. A entrada imprudente derruba quem tem a bola — não se "quase" atropela alguém.
 * A vantagem é a exceção: um portador forte o bastante aguenta o tranco e segue jogando, e aí o
 * árbitro engole o apito. A comparação é a mesma `duelStrength` de todo duelo do motor.
 *
 * A falta é decidida aqui, e não esperando a bola se separar sozinha por física: exigir que a
 * trombada produza os quase três metros de separação transformaria uma regra simples num problema
 * de calibragem — e um zagueiro que atropela o atacante tira a bola dele, ponto.
 */
const resolveRecklessEntry = (
  state: MatchState,
  engagement: Engagement,
  holder: PlayerRuntime,
  challengers: PlayerRuntime[],
): boolean => {
  const offender = recklessChallenger(state, holder, challengers);
  if (!offender) return false;
  holder.reactionTimer = Math.max(holder.reactionTimer, DUEL.chargeReaction);
  if (duelEdge(holder, offender) > DUEL.rideChallengeEdge) return false; // aguentou: vantagem
  engagement.recklessById = offender.profile.id;
  engagement.victimId = holder.profile.id;
  whistleFoul(state, engagement);
  return true;
};

/**
 * Falta apitada: congela a jogada como o impedimento faz, e o tiro livre sai em `advanceFoul`.
 */
const whistleFoul = (state: MatchState, engagement: Engagement): void => {
  const guilty = state.players.find((player) => player.profile.id === engagement.recklessById);
  const victim = state.players.find((player) => player.profile.id === engagement.victimId);
  if (!guilty || !victim) return;
  state.engagement = null;
  state.foulCall = {
    team: guilty.team,
    offenderId: guilty.profile.id,
    victimId: victim.profile.id,
    spot: {
      x: clamp(victim.position.x, 4, FIELD.width - 4),
      y: clamp(victim.position.y, 4, FIELD.height - 4),
    },
    calledAt: state.elapsed,
    resolveAt: state.elapsed + REFEREE.whistleBeatSeconds,
  };
  state.stats[guilty.team].fouls += 1;
  state.ball.velocity = { x: 0, y: 0 };
  state.ball.verticalVelocity = 0;
  state.ball.height = 0;
  state.ball.controllerId = null;
  clearDribbleOwner(state);
  if (state.pendingPass) emitCognitiveEvent(state, "passResolved", null, { passId: state.pendingPass.id, outcome: "out" });
  state.pendingPass = null;
  resolveShot(state, "dead");
  emitMatchEvent(state, { type: "foul-called", team: guilty.team, playerId: guilty.profile.id });
};

/**
 * A bola saiu do pé com gente em cima: o desarme foi tentado e a posse virou. Não distingue
 * "roubo" de "cutucada" — quem estiver melhor colocado pega a sobra, como no jogo.
 */
const creditTackle = (state: MatchState, challengerIds: string[]): void => {
  const teams = new Set(state.players
    .filter((player) => challengerIds.includes(player.profile.id))
    .map((player) => player.team));
  for (const team of teams) state.stats[team].tacklesWon += 1;
};
