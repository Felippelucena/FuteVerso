import { clamp, distance } from "../../shared/math";
import { TACTICAL_GRID } from "../../tactics/slots";
import { DEFENSE, FIELD } from "../config";
import type {
  AssignmentDuty,
  AssignmentZone,
  AttackChannel,
  DecisionReason,
  DefensiveBlock,
  MatchState,
  PlayerAssignment,
  PlayerPosition,
  PlayerRuntime,
  TacticalPhase,
  Team,
  TeamCollectivePlan,
  TeamPosture,
  Vec2,
} from "../model";
import {
  baseCell,
  cellAnchor,
  cellAt,
  cellDistance,
  cellKey,
  goalCenter,
  shiftCell,
} from "../runtime/formation-geometry";
import { predictPlayerPosition, predictionHorizon } from "../runtime/prediction";

/**
 * Distribuição de incumbências: o nível que faltava entre a estratégia do time e a decisão do
 * jogador. Recebe o momento (posse, fase, canal, risco) e devolve, para **cada** um dos onze,
 * o que ele está encarregado de fazer e qual célula da grade tática ele ocupa agora.
 *
 * Duas invariantes sustentam tudo o que vem depois:
 *
 * 1. **Totalidade** — todo jogador do time tem um dever. Não existe "o resto", nem jogador
 *    caindo num comportamento padrão em torno da âncora.
 * 2. **Exclusividade** — duas incumbências nunca apontam para a mesma célula. É a regra de
 *    ocupação do jogo posicional, e é ela que impede dois jogadores de disputarem o mesmo
 *    palmo de grama enquanto uma faixa inteira fica vazia.
 *
 * Quem decide movimento (`supportTarget`, `defensiveTarget`) lê a incumbência em vez de
 * redescobrir o trabalho a partir da função do atleta. É por aqui que os botões do plano
 * tático entram no motor nas fases seguintes: mudando como a incumbência é escolhida, não
 * enfiando booleano novo dentro da decisão individual.
 */
export interface AssignmentContext {
  posture: TeamPosture;
  phase: TacticalPhase;
  attackChannel: AttackChannel;
  defensiveBlock: DefensiveBlock;
  risk: number;
  ballActorId: string | null;
  /** Último homem da atualização anterior; entra com vantagem para o papel não ficar trocando. */
  previousSafetyId: string | null;
}

export interface AssignmentResult {
  assignments: Record<string, PlayerAssignment>;
  /** Líder do rest defense nesta atualização, devolvido para alimentar a histerese seguinte. */
  safetyId: string | null;
}

interface DutyChoice {
  duty: AssignmentDuty;
  priority: number;
  targetPlayerId: string | null;
}

/** Quem fica com a célula que pediu quando dois jogadores querem a mesma. */
const DUTY_CLAIM: Record<AssignmentDuty, number> = {
  goalkeep: 10,
  carry: 9,
  receive: 8,
  press: 7,
  trackRunner: 6,
  restDefense: 5,
  overlap: 4,
  runInBehind: 3.5,
  width: 3,
  holdLine: 2,
  support: 1,
};

/** Quanto o dever autoriza o jogador a se afastar da célula, antes da instrução do treinador. */
const DUTY_FREEDOM: Record<AssignmentDuty, number> = {
  goalkeep: 0.3,
  carry: 1,
  receive: 1,
  press: 1,
  trackRunner: 1.1,
  restDefense: 0.6,
  overlap: 1.2,
  runInBehind: 1.2,
  width: 0.9,
  holdLine: 0.7,
  support: 1,
};

const DUTY_REASON: Record<AssignmentDuty, DecisionReason> = {
  goalkeep: "protectGoal",
  carry: "carryIntoSpace",
  receive: "attackReception",
  runInBehind: "runInBehind",
  support: "thirdManSupport",
  width: "giveWidth",
  overlap: "overlapRun",
  restDefense: "restDefense",
  press: "pressBall",
  trackRunner: "markThreat",
  holdLine: "holdZone",
};

const SUPPORT_FREEDOM = { hold: 0.25, balanced: 0.5, attack: 0.8 } as const;

/** Quem sobe pela lateral quando o time ataca por um corredor: o papel clássico do overlap. */
const OVERLAP_POSITIONS: readonly PlayerPosition[] = ["rightBack", "leftBack"];

const LAST_COLUMN = TACTICAL_GRID.columns[TACTICAL_GRID.columns.length - 1];
const FIRST_ROW = TACTICAL_GRID.rows[0];
const LAST_ROW = TACTICAL_GRID.rows[TACTICAL_GRID.rows.length - 1];
const CENTER_ROW = TACTICAL_GRID.rows[(TACTICAL_GRID.rows.length - 1) / 2];

const ALL_CELLS: readonly AssignmentZone[] = TACTICAL_GRID.columns.flatMap((column) =>
  TACTICAL_GRID.rows.map((row) => ({ column, row })));

const attackingProgress = (team: Team, x: number): number =>
  team === "blue" ? x / FIELD.width : (FIELD.width - x) / FIELD.width;

const channelY = (channel: AttackChannel): number => channel === "left"
  ? FIELD.height * 0.22
  : channel === "right"
    ? FIELD.height * 0.78
    : FIELD.height * 0.5;

const channelAffinity = (position: { y: number }, channel: AttackChannel): number =>
  1 - clamp(Math.abs(position.y - channelY(channel)) / (FIELD.height * 0.42), 0, 1);

const byId = (first: PlayerRuntime, second: PlayerRuntime): number =>
  first.profile.id.localeCompare(second.profile.id);

// ---------------------------------------------------------------------------------------------
// Escolhas singulares que sobrevivem da versão anterior do plano coletivo. Continuam sendo
// decisões do time, mas agora entregam um dever numerado em vez de um id solto.
// ---------------------------------------------------------------------------------------------

const choosePresser = (state: MatchState, team: Team, players: PlayerRuntime[]): PlayerRuntime | null => {
  const ownGoalX = team === "blue" ? 0 : FIELD.width;
  return [...players].sort((first, second) => {
    const score = (player: PlayerRuntime): number => {
      const goalkeeperPenalty = player.profile.position === "goalkeeper"
        && Math.abs(state.ball.position.x - ownGoalX) > FIELD.width * 0.14 ? FIELD.width * 0.2 : 0;
      const mentality = (player.profile.mental.aggression + player.profile.mental.intensity + player.profile.mental.anticipation) / 300;
      const future = predictPlayerPosition(player, predictionHorizon(player, 0.85) * 0.55);
      return distance(future, state.ball.position) + goalkeeperPenalty - mentality * FIELD.width * 0.045;
    };
    return score(first) - score(second);
  })[0] ?? null;
};

/**
 * Segundo engajador: sai da linha para dividir quando a bola do adversário entra no nosso terço
 * defensivo e o portador não tem pressão real (o primeiro pressionador está longe).
 */
const chooseSecondPresser = (
  state: MatchState,
  team: Team,
  candidates: PlayerRuntime[],
  presser: PlayerRuntime | null,
  carrier: PlayerRuntime | null,
): PlayerRuntime | null => {
  if (!carrier || carrier.team === team) return null;
  if (attackingProgress(team, state.ball.position.x) >= DEFENSE.dangerZoneProgress) return null;
  const presserGap = presser ? distance(presser.position, state.ball.position) : Number.POSITIVE_INFINITY;
  if (presserGap <= DEFENSE.secondPresserUnpressuredGap * FIELD.width) return null;
  const carrierFuture = predictPlayerPosition(carrier, predictionHorizon(carrier, 0.7) * 0.4);
  const eligible = candidates.filter((player) => player.profile.role === "defender"
    && distance(player.position, carrierFuture) < DEFENSE.secondPresserEngageRange * FIELD.width);
  return [...eligible].sort((first, second) =>
    distance(first.position, carrierFuture) - distance(second.position, carrierFuture) || byId(first, second))[0] ?? null;
};

/**
 * Em posse e nas fases de progressão/ataque, um lateral do lado do canal é liberado a subir como
 * peça de triangulação. Só um por vez, e nunca alguém do rest defense — que a esta altura já
 * saiu da lista de candidatos.
 */
const chooseOverlapFullBack = (
  candidates: PlayerRuntime[],
  context: AssignmentContext,
): PlayerRuntime | null => {
  if (context.risk < DEFENSE.overlapMinRisk) return null;
  const { phase } = context;
  if (phase !== "progression" && phase !== "finalThird" && phase !== "counterAttack") return null;
  const corridor = channelY(context.attackChannel);
  const eligible = candidates.filter((player) => OVERLAP_POSITIONS.includes(player.profile.position)
    && player.sprintEnergy > 0.4
    && Math.abs(player.position.y - corridor) < FIELD.height * 0.5);
  return [...eligible].sort((first, second) =>
    Math.abs(first.position.y - corridor) - Math.abs(second.position.y - corridor) || byId(first, second))[0] ?? null;
};

/** Quão perto do gol adversário este jogador deve viver neste momento. Decide quem corre. */
const forwardness = (player: PlayerRuntime, context: AssignmentContext): number => {
  const fromSlot = baseCell(player).column / LAST_COLUMN;
  const fromInstruction = player.instruction.support === "attack" ? 0.25
    : player.instruction.support === "hold" ? -0.25
      : 0;
  const fromRole = player.profile.role === "finisher" ? 0.12 : player.profile.role === "playmaker" ? 0.04 : 0;
  const fromChannel = channelAffinity(player.position, context.attackChannel) * 0.1;
  const athletic = (player.profile.skills.sprintSpeed + player.profile.mental.anticipation) / 2000;
  return fromSlot + fromInstruction + fromRole + fromChannel + athletic + context.risk * 0.08;
};

/** Quem serve de último homem: defende bem, lê o jogo e já está do lado certo da bola. */
const safetyScore = (player: PlayerRuntime, team: Team, context: AssignmentContext): number => {
  const goalSide = 1 - attackingProgress(team, player.position.x);
  const central = 1 - clamp(Math.abs(player.position.y - FIELD.height / 2) / (FIELD.height / 2), 0, 1);
  const fromInstruction = player.instruction.support === "hold" ? 8 : player.instruction.support === "attack" ? -8 : 0;
  return player.profile.skills.defending * 0.42 + player.profile.mental.decisionMaking * 0.2
    + player.profile.mental.anticipation * 0.18 + player.profile.mental.teamwork * 0.12
    + goalSide * 5 + central * 3 + fromInstruction - forwardness(player, context) * 6;
};

/** Adversários por perigo — o mais perigoso primeiro. */
const rankThreats = (state: MatchState, team: Team, opponents: PlayerRuntime[]): PlayerRuntime[] => {
  const ownGoal = goalCenter(team, true);
  const threat = (opponent: PlayerRuntime): number => distance(opponent.position, ownGoal) * 0.54
    + distance(opponent.position, state.ball.position) * 0.34
    + Math.abs(opponent.position.y - FIELD.height / 2) * 0.12;
  return [...opponents]
    .filter((opponent) => opponent.profile.position !== "goalkeeper")
    .sort((first, second) => threat(first) - threat(second) || byId(first, second));
};

// ---------------------------------------------------------------------------------------------
// Deveres por momento
// ---------------------------------------------------------------------------------------------

const assignInPossession = (
  state: MatchState,
  team: Team,
  context: AssignmentContext,
  outfield: PlayerRuntime[],
  duties: Map<string, DutyChoice>,
): string | null => {
  const remaining: PlayerRuntime[] = [];
  for (const player of outfield) {
    if (player.profile.id === context.ballActorId) {
      const controlling = state.ball.controllerId === player.profile.id || state.ball.dribbleOwnerId === player.profile.id;
      duties.set(player.profile.id, { duty: controlling ? "carry" : "receive", priority: 0, targetPlayerId: null });
      continue;
    }
    remaining.push(player);
  }

  // Rest defense: que fatia do time fica atrás da bola. Quanto mais risco, menos gente. É uma
  // proporção e não um número fixo porque o motor aceita qualquer formato: três homens de
  // retaguarda num 11x11 é um bloco, num 5x5 é o time inteiro parado.
  const restShare = context.risk > 0.7 ? 0.22 : context.risk < 0.35 ? 0.42 : 0.33;
  const restCount = clamp(Math.round(remaining.length * restShare), 1, Math.max(1, remaining.length - 2));
  const ranked = [...remaining].sort((first, second) =>
    safetyScore(second, team, context) - safetyScore(first, team, context) || byId(first, second));
  const best = ranked[0] ?? null;
  // Histerese: o último homem anterior só perde o posto para alguém claramente melhor. Trocar
  // o rest defense a cada atualização abriria o time exatamente no momento da transição.
  const previous = context.previousSafetyId
    ? ranked.find((player) => player.profile.id === context.previousSafetyId) ?? null
    : null;
  const leader = previous && best
    && safetyScore(best, team, context) < safetyScore(previous, team, context) * 1.12
    ? previous
    : best;
  const rest = leader
    ? [leader, ...ranked.filter((player) => player.profile.id !== leader.profile.id)].slice(0, restCount)
    : ranked.slice(0, restCount);
  rest.forEach((player, index) => {
    duties.set(player.profile.id, { duty: "restDefense", priority: index, targetPlayerId: null });
  });

  const free = remaining.filter((player) => !duties.has(player.profile.id));
  const overlap = chooseOverlapFullBack(free, context);
  if (overlap) duties.set(overlap.profile.id, { duty: "overlap", priority: 0, targetPlayerId: null });

  const attackers = free
    .filter((player) => !duties.has(player.profile.id))
    .sort((first, second) => forwardness(second, context) - forwardness(first, context) || byId(first, second));
  // Corredores: quem ataca as costas da última linha. A fase decide que fatia do ataque corre —
  // proporção, de novo, para o mesmo motor servir a qualquer formato.
  const runnerShare = context.phase === "counterAttack" || context.phase === "finalThird" ? 0.5
    : context.phase === "progression" ? 0.34
      : 0.2;
  const runnerCount = clamp(Math.round(attackers.length * runnerShare), 1, attackers.length);
  attackers.slice(0, runnerCount).forEach((player, index) => {
    duties.set(player.profile.id, { duty: "runInBehind", priority: index, targetPlayerId: null });
  });

  // Quem sobra: os das faixas de fora seguram a largura, os de dentro oferecem linha de passe.
  attackers.slice(runnerCount).forEach((player, index) => {
    const lane = baseCell(player).row;
    const holdsWidth = lane === FIRST_ROW || lane === LAST_ROW;
    duties.set(player.profile.id, {
      duty: holdsWidth ? "width" : "support",
      priority: index,
      targetPlayerId: null,
    });
  });

  return leader?.profile.id ?? null;
};

const assignOutOfPossession = (
  state: MatchState,
  team: Team,
  context: AssignmentContext,
  players: PlayerRuntime[],
  outfield: PlayerRuntime[],
  opponents: PlayerRuntime[],
  duties: Map<string, DutyChoice>,
): void => {
  const carrier = state.players.find((player) => player.profile.id === context.ballActorId) ?? null;
  const carrierId = carrier && carrier.team !== team ? carrier.profile.id : null;

  const presser = choosePresser(state, team, players);
  if (presser) duties.set(presser.profile.id, { duty: "press", priority: 0, targetPlayerId: carrierId });
  const second = chooseSecondPresser(
    state,
    team,
    outfield.filter((player) => !duties.has(player.profile.id)),
    presser,
    carrier,
  );
  if (second) duties.set(second.profile.id, { duty: "press", priority: 1, targetPlayerId: carrierId });

  // Marcação individual só para quem o treinador mandou marcar homem. O padrão é zona: o
  // jogador não persegue um número pelo campo, ele responde por quem entra na sua célula.
  const threats = rankThreats(state, team, opponents);
  const claimed = new Set<string>();
  const free = outfield.filter((player) => !duties.has(player.profile.id));
  const manMarkers = free.filter((player) => player.instruction.marking === "man");
  for (const player of manMarkers) {
    const target = threats
      .filter((opponent) => !claimed.has(opponent.profile.id))
      .sort((first, second) => distance(player.position, first.position) - distance(player.position, second.position))[0] ?? null;
    if (target) claimed.add(target.profile.id);
    duties.set(player.profile.id, {
      duty: "trackRunner",
      priority: target ? threats.indexOf(target) : threats.length,
      targetPlayerId: target?.profile.id ?? null,
    });
  }

  // Todo o resto sustenta a linha, na ordem do próprio gol para a frente: prioridade 0 é o
  // último homem da zona.
  free
    .filter((player) => !duties.has(player.profile.id))
    .sort((first, second) => baseCell(first).column - baseCell(second).column || byId(first, second))
    .forEach((player, index) => {
      duties.set(player.profile.id, { duty: "holdLine", priority: index, targetPlayerId: null });
    });
};

// ---------------------------------------------------------------------------------------------
// Células: deslocamento coletivo, ajuste por dever e resolução de ocupação
// ---------------------------------------------------------------------------------------------

/** Deslocamento do bloco inteiro em colunas da grade: sobe pressionando, recua protegendo. */
const blockShift = (context: AssignmentContext): number => {
  if (context.posture === "inPossession") {
    return context.phase === "buildUp" ? 0
      : context.phase === "progression" ? 1
        : 2;
  }
  const fromPhase = context.phase === "highPress" || context.phase === "counterPress" ? 1
    : context.phase === "lowBlock" || context.phase === "recovery" ? -1
      : 0;
  const fromBlock = context.defensiveBlock === "high" ? 1 : context.defensiveBlock === "low" ? -1 : 0;
  return clamp(fromPhase + fromBlock, -2, 2);
};

/** Deslizamento lateral do bloco: para o canal de ataque com a bola, para a bola sem ela. */
const laneShift = (state: MatchState, context: AssignmentContext): number => {
  if (context.posture === "inPossession") {
    return context.attackChannel === "left" ? -1 : context.attackChannel === "right" ? 1 : 0;
  }
  const lane = clamp(state.ball.position.y / FIELD.height, 0, 1);
  return Math.round((lane - 0.5) * 2);
};

const desiredCell = (
  state: MatchState,
  team: Team,
  player: PlayerRuntime,
  choice: DutyChoice,
  collectiveShift: { columns: number; rows: number },
): AssignmentZone => {
  const base = baseCell(player);
  if (choice.duty === "goalkeep") return base;
  // Quem vai à bola ocupa a célula da bola; quem marca homem ocupa a do marcado.
  if (choice.duty === "carry" || choice.duty === "receive" || choice.duty === "press") {
    return cellAt(state.ball.position, team);
  }
  if (choice.duty === "trackRunner") {
    const mark = state.players.find((candidate) => candidate.profile.id === choice.targetPlayerId);
    if (mark) return cellAt(mark.position, team);
  }
  const shifted = shiftCell(base, collectiveShift.columns, collectiveShift.rows);
  if (choice.duty === "runInBehind" || choice.duty === "overlap") return shiftCell(shifted, 1, 0);
  if (choice.duty === "restDefense") return shiftCell(shifted, -1, 0);
  // Quem segura a largura vai para a faixa de fora do seu lado, não para a que o bloco deslizou.
  if (choice.duty === "width") return { column: shifted.column, row: base.row <= CENTER_ROW ? FIRST_ROW : LAST_ROW };
  return shifted;
};

const firstFreeCell = (desired: AssignmentZone, taken: Set<string>): AssignmentZone => {
  if (!taken.has(cellKey(desired))) return desired;
  return ALL_CELLS
    .filter((cell) => !taken.has(cellKey(cell)))
    .sort((first, second) => cellDistance(desired, first) - cellDistance(desired, second)
      || Math.abs(first.column - desired.column) - Math.abs(second.column - desired.column)
      || first.column - second.column
      || first.row - second.row)[0] ?? desired;
};

export const buildAssignments = (
  state: MatchState,
  team: Team,
  context: AssignmentContext,
): AssignmentResult => {
  const players = state.players.filter((player) => player.team === team);
  const outfield = players.filter((player) => player.profile.position !== "goalkeeper");
  const opponents = state.players.filter((player) => player.team !== team);
  const duties = new Map<string, DutyChoice>();

  for (const keeper of players.filter((player) => player.profile.position === "goalkeeper")) {
    duties.set(keeper.profile.id, { duty: "goalkeep", priority: 0, targetPlayerId: null });
  }

  const safetyId = context.posture === "inPossession"
    ? assignInPossession(state, team, context, outfield, duties)
    : (assignOutOfPossession(state, team, context, players, outfield, opponents, duties), null);

  const collectiveShift = { columns: blockShift(context), rows: laneShift(state, context) };
  const wanted = players.map((player) => {
    const choice = duties.get(player.profile.id)
      // Rede de segurança: se alguma trilha nova esquecer um jogador, ele sustenta a zona dele
      // em vez de virar um corpo sem função. A invariante de totalidade é testada à parte.
      ?? { duty: "holdLine" as AssignmentDuty, priority: 99, targetPlayerId: null };
    return { player, choice, cell: desiredCell(state, team, player, choice, collectiveShift) };
  });

  const taken = new Set<string>();
  const assignments: Record<string, PlayerAssignment> = {};
  const ordered = [...wanted].sort((first, second) =>
    DUTY_CLAIM[second.choice.duty] - DUTY_CLAIM[first.choice.duty]
    || first.choice.priority - second.choice.priority
    || second.player.positionFit - first.player.positionFit
    || byId(first.player, second.player));

  for (const { player, choice, cell } of ordered) {
    const zone = firstFreeCell(cell, taken);
    taken.add(cellKey(zone));
    assignments[player.profile.id] = {
      duty: choice.duty,
      priority: choice.priority,
      zone,
      targetPlayerId: choice.targetPlayerId,
      freedom: clamp(SUPPORT_FREEDOM[player.instruction.support] * DUTY_FREEDOM[choice.duty], 0, 1),
      rationale: DUTY_REASON[choice.duty],
    };
  }

  // Segunda passada: agora que cada zona é definitiva, quem defende em zona responde por quem
  // estiver dentro dela. É o que torna a marcação zonal capaz de encostar em alguém, sem
  // ninguém atravessando o campo atrás de um número.
  if (context.posture === "outOfPossession") {
    const claimed = new Set(Object.values(assignments)
      .map((assignment) => assignment.targetPlayerId)
      .filter((id): id is string => id !== null));
    for (const { player, choice } of ordered) {
      if (choice.duty !== "holdLine") continue;
      const assignment = assignments[player.profile.id];
      const anchor = cellAnchor(assignment.zone, team);
      const inZone = opponents
        .filter((opponent) => opponent.profile.position !== "goalkeeper" && !claimed.has(opponent.profile.id))
        .filter((opponent) => distance(opponent.position, anchor) < DEFENSE.zoneRadius * FIELD.width)
        .sort((first, second) => distance(first.position, anchor) - distance(second.position, anchor) || byId(first, second));
      const target = inZone[0] ?? null;
      if (target) {
        claimed.add(target.profile.id);
        assignment.targetPlayerId = target.profile.id;
      }
    }
  }

  return { assignments, safetyId };
};

// ---------------------------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------------------------

export const assignmentOf = (plan: TeamCollectivePlan | null | undefined, playerId: string): PlayerAssignment | null =>
  plan?.assignments[playerId] ?? null;

/** Todos os encarregados de um dever, do titular do papel (prioridade 0) para os demais. */
export const dutyHolders = (plan: TeamCollectivePlan | null | undefined, duty: AssignmentDuty): string[] =>
  Object.entries(plan?.assignments ?? {})
    .filter(([, assignment]) => assignment.duty === duty)
    .sort(([firstId, first], [secondId, second]) => first.priority - second.priority || firstId.localeCompare(secondId))
    .map(([id]) => id);

/** Quem manda no dever: o primeiro pressionador, o último homem, o corredor de referência. */
export const dutyLeader = (plan: TeamCollectivePlan | null | undefined, duty: AssignmentDuty): string | null =>
  dutyHolders(plan, duty)[0] ?? null;

/**
 * Âncora da célula em que o jogador foi encarregado de viver agora. Sem incumbência — cenário de
 * teste montado à mão, primeiro tick antes do plano — cai na âncora fixa da formação.
 */
export const assignedAnchor = (assignment: PlayerAssignment | null, player: PlayerRuntime): Vec2 =>
  assignment ? cellAnchor(assignment.zone, player.team) : player.homeAnchor;
