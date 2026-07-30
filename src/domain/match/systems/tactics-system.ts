import { FIELD, MENTALITY, POSSESSION, TACTICS } from "../config";
import { clamp, distance } from "../../shared/math";
import { mentalityBias, type TeamDirectives } from "../../tactics/model";
import type {
  AttackChannel,
  AttackZone,
  BuildUpStyle,
  CountableTeamStat,
  DefensiveBlock,
  MatchState,
  PlayerRuntime,
  PressTrigger,
  TacticalPhase,
  Team,
  TeamCollectivePlan,
  TeamShape,
  TeamTacticalState,
  Vec2,
} from "../model";
import { perceive } from "../runtime/ball-situation";
import { activeBallPlayerId } from "../runtime/control";
import { insidePenaltyArea } from "../runtime/formation-geometry";
import { attackingProgress, channelY } from "../runtime/pitch";
import { predictPlayerPosition, predictedSpaceAt, predictionHorizon } from "../runtime/prediction";
import { buildAssignments, placementFor } from "./assignment-system";

export const TACTICAL_PHASES: TacticalPhase[] = [
  "buildUp", "progression", "finalThird", "counterAttack",
  "highPress", "midBlock", "lowBlock", "counterPress", "recovery",
];

export const createPhaseSeconds = (): Record<TacticalPhase, number> => Object.fromEntries(
  TACTICAL_PHASES.map((phase) => [phase, 0]),
) as Record<TacticalPhase, number>;

export const createTacticalState = (directives: TeamDirectives): TeamTacticalState => ({
  directives,
  phase: "midBlock",
  phaseStartedAt: 0,
  candidatePhase: "midBlock",
  candidatePhaseStartedAt: 0,
  shape: { width: 0, depth: 0, compactness: 0, lineHeight: 0 },
  // A carência começa vencida: a primeira visita a cada zona conta desde o apito inicial.
  zoneVisits: {
    finalThird: { inside: false, lastEntryAt: -POSSESSION.finalThirdEntryCooldown },
    box: { inside: false, lastEntryAt: -POSSESSION.boxEntryCooldown },
  },
  collectivePlan: null,
  safetyPlayerId: null,
});

const collectivePosture = (state: MatchState, team: Team): "inPossession" | "outOfPossession" => {
  const actor = state.players.find((player) => player.profile.id === activeBallPlayerId(state));
  return actor ? (actor.team === team ? "inPossession" : "outOfPossession") : state.possessionTeam === team ? "inPossession" : "outOfPossession";
};

const measureShape = (state: MatchState, team: Team): TeamShape => {
  const players = state.players.filter((player) => player.team === team && player.profile.position !== "goalkeeper");
  if (players.length === 0) return { width: 0, depth: 0, compactness: 0, lineHeight: 0 };
  const xs = players.map((player) => player.position.x);
  const ys = players.map((player) => player.position.y);
  const centroid = {
    x: xs.reduce((sum, value) => sum + value, 0) / players.length,
    y: ys.reduce((sum, value) => sum + value, 0) / players.length,
  };
  return {
    width: Math.max(...ys) - Math.min(...ys),
    depth: Math.max(...xs) - Math.min(...xs),
    compactness: players.reduce((sum, player) => sum + distance(player.position, centroid), 0) / players.length,
    lineHeight: attackingProgress(team, centroid.x) * 100,
  };
};

const detectPhase = (state: MatchState, team: Team, shape: TeamShape): TacticalPhase => {
  const progress = attackingProgress(team, state.ball.position.x);
  const sinceControlChange = state.elapsed - state.controlChangedAt;
  if (state.possessionTeam === team) {
    const wonFromOpponent = state.previousControlledTeam !== null && state.previousControlledTeam !== team;
    if (wonFromOpponent && sinceControlChange < TACTICS.counterAttackWindow) return "counterAttack";
    if (progress < TACTICS.buildUpEnd) return "buildUp";
    if (progress >= TACTICS.finalThirdStart) return "finalThird";
    return "progression";
  }
  const justLost = state.previousControlledTeam === team && state.lastControlledTeam !== team;
  if (justLost && sinceControlChange < TACTICS.counterPressWindow) return "counterPress";
  if (justLost && sinceControlChange < TACTICS.recoveryWindow && shape.depth > FIELD.width * 0.28) return "recovery";
  if (progress >= 0.64) return "highPress";
  if (progress < 0.34) return "lowBlock";
  return "midBlock";
};

const average = (players: PlayerRuntime[], value: (player: PlayerRuntime) => number): number =>
  players.reduce((sum, player) => sum + value(player), 0) / Math.max(1, players.length);

/**
 * Por qual corredor o time ataca. O canal em vigor entra na disputa com a vantagem de já ser o
 * canal (`TACTICS.channelHold`): trocar de lado desloca o bloco inteiro, e um time que troca a cada
 * dois segundos nunca chega a lado nenhum.
 */
const selectAttackChannel = (
  state: MatchState,
  team: Team,
  players: PlayerRuntime[],
  opponents: PlayerRuntime[],
  current: AttackChannel | null,
): AttackChannel => {
  const direction = team === "blue" ? 1 : -1;
  const horizon = average(players, (player) => predictionHorizon(player, 0.35));
  const channels: AttackChannel[] = ["left", "center", "right"];
  return channels.sort((first, second) => {
    const score = (channel: AttackChannel): number => {
      const point = {
        x: clamp(state.ball.position.x + direction * FIELD.width * 0.16, FIELD.width * 0.08, FIELD.width * 0.92),
        y: channelY(channel),
      };
      const space = predictedSpaceAt(point, opponents, horizon);
      const support = Math.max(...players.map((player) => {
        const predicted = predictPlayerPosition(player, horizon);
        return player.profile.skills.sprintSpeed / 100 - distance(predicted, point) / FIELD.width;
      }));
      const centralProgression = channel === "center" ? 0.08 : 0;
      const holding = channel === current ? TACTICS.channelHold : 0;
      return space / (FIELD.width * 0.12) + support * 0.5 + centralProgression + holding;
    };
    return score(second) - score(first);
  })[0];
};

const chooseBuildUpStyle = (players: PlayerRuntime[]): BuildUpStyle => {
  const association = average(players, (player) => (
    player.profile.skills.passing + player.profile.skills.vision + player.profile.mental.teamwork
  ) / 3);
  const verticality = average(players, (player) => (
    player.profile.skills.sprintSpeed + player.profile.skills.burst + player.profile.mental.aggression
  ) / 3);
  if (association > verticality + 5) return "short";
  if (verticality > association + 5) return "direct";
  return "balanced";
};

const chooseDefensiveBlock = (state: MatchState, team: Team, players: PlayerRuntime[]): DefensiveBlock => {
  const scoreDifference = state.stats[team].goals - state.stats[team === "blue" ? "coral" : "blue"].goals;
  const remaining = (state.rules.matchDuration - state.elapsed) / state.rules.matchDuration;
  if (scoreDifference > 0 && remaining < TACTICS.protectLeadShare) return "low";
  if (scoreDifference < 0 && remaining < TACTICS.chaseGameShare) return "high";
  const intensity = average(players, (player) => player.profile.mental.intensity * 0.55 + player.profile.mental.aggression * 0.45);
  return intensity > 77 ? "high" : intensity < 58 ? "low" : "mid";
};

const proposePressTrigger = (state: MatchState, team: Team): PressTrigger => {
  // Bola em aberto é bola solta, mesmo que alguém a tenha jogado ali de propósito. Antes o
  // gatilho exigia que não houvesse condução nem passe em curso — e então a bola adiantada num
  // pique, que é a melhor chance de dividida do jogo, nunca disparava pressão nenhuma.
  if (state.ballSituation.phase === "contested") return "looseBall";
  if (state.tactics[team].phase === "counterPress") return "counterPress";
  const edgeDistance = Math.min(state.ball.position.y, FIELD.height - state.ball.position.y);
  return edgeDistance < FIELD.height * 0.18 ? "touchline" : "compact";
};

/**
 * A situação propõe o gatilho; o plano diz se ele vale. Gatilho desabilitado não cai para o
 * seguinte — a situação simplesmente não dispara a nossa pressão, e ninguém sai da linha.
 */
const choosePressTrigger = (state: MatchState, team: Team, enabled: readonly PressTrigger[]): PressTrigger | null => {
  const proposed = proposePressTrigger(state, team);
  return enabled.includes(proposed) ? proposed : null;
};

/**
 * Estratégia do time neste instante. Fase, canal, risco e bloco são decisões do coletivo; quem
 * faz o quê sai daqui para `buildAssignments`, que devolve a incumbência de cada um dos onze.
 */

const createCollectivePlan = (state: MatchState, team: Team): TeamCollectivePlan => {
  const tactical = state.tactics[team];
  const { directives } = tactical;
  const players = state.players.filter((player) => player.team === team);
  const outfield = players.filter((player) => player.profile.position !== "goalkeeper");
  const opponents = state.players.filter((player) => player.team !== team);
  const actorId = activeBallPlayerId(state);
  const posture = collectivePosture(state, team);
  // O canal em vigor sai do plano anterior: não precisa de estado novo, e é a mesma fonte que o
  // `previousSafetyId` logo abaixo usa para a histerese dele.
  const attackChannel = selectAttackChannel(state, team, outfield, opponents,
    tactical.collectivePlan?.attackChannel ?? null);
  // Regra uniforme dos estilos: `auto` é o que o motor decide sozinho, qualquer outro valor é
  // ordem do treinador. Nenhum caso especial de permeio.
  const defensiveBlock = directives.defensiveBlock === "auto"
    ? chooseDefensiveBlock(state, team, players)
    : directives.defensiveBlock;
  const pressTrigger = choosePressTrigger(state, team, directives.pressTriggers);
  const scoreDifference = state.stats[team].goals - state.stats[team === "blue" ? "coral" : "blue"].goals;
  const urgency = clamp((state.elapsed - state.rules.matchDuration * 0.65) / (state.rules.matchDuration * 0.35), 0, 1);
  const personalityRisk = average(players, (player) => player.profile.mental.creativity * 0.45 + player.profile.mental.aggression * 0.35 + player.profile.mental.composure * 0.2) / 100;
  // Eixo `risk`: entra aqui, e só aqui. Rest defense, sobreposição do lateral e apetite de passe
  // já leem este número — enviesá-lo na origem move os três de uma vez e sem contradição.
  const risk = clamp(
    personalityRisk
    + (scoreDifference < 0 ? urgency * 0.3 : scoreDifference > 0 ? -urgency * 0.2 : 0)
    + mentalityBias(directives.mentality.risk) * MENTALITY.risk,
    0.2,
    0.95,
  );

  const { assignments, safetyId, placement } = buildAssignments(state, team, {
    posture,
    phase: tactical.phase,
    attackChannel,
    defensiveBlock,
    pressTrigger,
    risk,
    ballActorId: actorId,
    previousSafetyId: tactical.safetyPlayerId,
  });
  // O último homem só é reescolhido com a bola no pé: perder a posse por um instante não pode
  // apagar quem estava segurando a retaguarda.
  if (posture === "inPossession") tactical.safetyPlayerId = safetyId;

  return {
    startedAt: state.elapsed,
    expiresAt: state.elapsed + TACTICS.collectivePlanSeconds * (0.82 + average(players, (player) => player.profile.mental.teamwork) / 360),
    phase: tactical.phase,
    posture,
    ballActorId: actorId,
    buildUpStyle: directives.buildUpStyle === "auto" ? chooseBuildUpStyle(players) : directives.buildUpStyle,
    attackChannel,
    defensiveBlock,
    risk,
    pressTrigger,
    placement,
    assignments,
  };
};

const collectivePlanNeedsRefresh = (state: MatchState, team: Team): boolean => {
  const tactical = state.tactics[team];
  const plan = tactical.collectivePlan;
  if (!plan || state.elapsed >= plan.expiresAt) return true;
  const posture = collectivePosture(state, team);
  return plan.phase !== tactical.phase || plan.posture !== posture || plan.ballActorId !== activeBallPlayerId(state);
};

/**
 * As zonas de ataque cuja visita se conta. `entered` e `left` são propositalmente diferentes: a
 * histerese impede que a bola oscilando na fronteira some uma entrada por quadro, e a carência
 * impede que a mesma investida conte duas vezes.
 */
interface AttackZoneRule {
  readonly id: AttackZone;
  readonly stat: CountableTeamStat;
  readonly cooldown: number;
  readonly entered: (team: Team, ball: Vec2) => boolean;
  readonly left: (team: Team, ball: Vec2) => boolean;
}

const ATTACK_ZONES: readonly AttackZoneRule[] = [
  {
    id: "finalThird",
    stat: "finalThirdEntries",
    cooldown: POSSESSION.finalThirdEntryCooldown,
    entered: (team, ball) => attackingProgress(team, ball.x) >= POSSESSION.finalThirdEnter,
    left: (team, ball) => attackingProgress(team, ball.x) <= POSSESSION.finalThirdRearm,
  },
  {
    id: "box",
    stat: "boxEntries",
    cooldown: POSSESSION.boxEntryCooldown,
    entered: (team, ball) => insidePenaltyArea(team, ball, false),
    left: (team, ball) => attackingProgress(team, ball.x) <= POSSESSION.boxRearm,
  },
];

/**
 * Conta a visita de um time a uma zona do campo de ataque — a visita, não o tempo dentro dela.
 * Só conta com a posse confirmada: bola que o adversário toca para dentro da própria área não é
 * ataque de ninguém.
 */
const countZoneVisit = (state: MatchState, team: Team, zone: AttackZoneRule): void => {
  const visit = state.tactics[team].zoneVisits[zone.id];
  const ball = state.ball.position;
  const withPossession = state.possessionTeam === team;
  if (!withPossession || zone.left(team, ball)) visit.inside = false;
  if (!withPossession || !zone.entered(team, ball) || visit.inside) return;
  if (state.elapsed - visit.lastEntryAt < zone.cooldown) return;
  state.stats[team][zone.stat] += 1;
  visit.inside = true;
  visit.lastEntryAt = state.elapsed;
};

/**
 * O passo de percepção do coletivo: refaz o quadro (`perceive`) e o contexto que sai dele —
 * postura, fase, plano e colocação. Quem manda na cadência é o motor
 * (`COGNITION.perceptionSeconds`), e o `dt` é o tempo desde a leitura anterior, para as integrais
 * de forma não dependerem dela.
 */
export const updateTacticalContext = (state: MatchState, dt: number): void => {
  perceive(state);
  for (const team of ["blue", "coral"] as const) {
    const tactical = state.tactics[team];
    const shape = measureShape(state, team);
    const desiredPhase = detectPhase(state, team, shape);
    if (desiredPhase !== tactical.candidatePhase) {
      tactical.candidatePhase = desiredPhase;
      tactical.candidatePhaseStartedAt = state.elapsed;
    }
    if (desiredPhase !== tactical.phase) {
      const transitionPhase = desiredPhase === "counterAttack" || desiredPhase === "counterPress";
      const candidateStable = state.elapsed - tactical.candidatePhaseStartedAt >= POSSESSION.phaseDebounceSeconds;
      const currentDwelled = state.elapsed - tactical.phaseStartedAt >= POSSESSION.minimumPhaseSeconds;
      if (transitionPhase || (candidateStable && currentDwelled)) {
        tactical.phase = desiredPhase;
        tactical.phaseStartedAt = state.elapsed;
      }
    } else {
      tactical.candidatePhase = desiredPhase;
      tactical.candidatePhaseStartedAt = state.elapsed;
    }
    tactical.shape = shape;
    if (collectivePlanNeedsRefresh(state, team)) tactical.collectivePlan = createCollectivePlan(state, team);
    else if (tactical.collectivePlan) {
      // A colocação do bloco é contínua e não pode esperar o próximo plano: a bola atravessa o
      // campo em menos tempo do que o cache de deveres dura. Quem faz o quê muda devagar; onde
      // o time está, não.
      tactical.collectivePlan.placement = placementFor(state, team, {
        posture: tactical.collectivePlan.posture,
        phase: tactical.phase,
        attackChannel: tactical.collectivePlan.attackChannel,
        defensiveBlock: tactical.collectivePlan.defensiveBlock,
        pressTrigger: tactical.collectivePlan.pressTrigger,
        risk: tactical.collectivePlan.risk,
        ballActorId: tactical.collectivePlan.ballActorId,
        previousSafetyId: tactical.safetyPlayerId,
      });
    }
    for (const zone of ATTACK_ZONES) countZoneVisit(state, team, zone);
    if (dt <= 0) continue;
    state.stats[team].phaseSeconds[tactical.phase] += dt;
    state.stats[team].widthIntegral += shape.width * dt;
    state.stats[team].depthIntegral += shape.depth * dt;
    state.stats[team].compactnessIntegral += shape.compactness * dt;
    state.stats[team].spatialSeconds += dt;
  }
};
