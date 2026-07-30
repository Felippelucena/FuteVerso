import { clamp, distance } from "../../shared/math";
import { mentalityBias, type TacticalMentality } from "../../tactics/model";
import { TACTICAL_GRID } from "../../tactics/slots";
import { DECISION, DEFENSE, FIELD, MENTALITY, OFFSIDE } from "../config";
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
  PressTrigger,
  TacticalPhase,
  Team,
  TeamCollectivePlan,
  TeamPosture,
  TeamShapePlacement,
} from "../model";
import {
  baseCell,
  cellAt,
  cellDistance,
  cellKey,
  GOALKEEPER_COLUMN,
  LINE_HEIGHT_RANGE,
  SHAPE_SPAN,
  shiftCell,
} from "../runtime/formation-geometry";
import { chasersFor } from "../runtime/ball-situation";
import { rankThreats } from "../runtime/marking";
import { attackingProgress, centrality, channelAffinity, channelY } from "../runtime/pitch";
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
  /** Gatilho em vigor. Nulo é o time que não sai para a bola: ninguém recebe o dever `press`. */
  pressTrigger: PressTrigger | null;
  risk: number;
  ballActorId: string | null;
  /** Último homem da atualização anterior; entra com vantagem para o papel não ficar trocando. */
  previousSafetyId: string | null;
}

/** Eixo de mentalidade deste time. A fonte é o estado tático — não há cópia em outro lugar. */
const mentalityOf = (state: MatchState, team: Team): TacticalMentality => state.tactics[team].directives.mentality;

export interface AssignmentResult {
  assignments: Record<string, PlayerAssignment>;
  /** Líder do rest defense nesta atualização, devolvido para alimentar a histerese seguinte. */
  safetyId: string | null;
  /** Onde a forma do time ficou: altura da linha mais recuada e largura aberta. */
  placement: TeamShapePlacement;
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
  recycle: 4.5,
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
  recycle: 1,
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
  recycle: "wallPass",
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

/**
 * Células disponíveis para jogadores de linha na resolução de ocupação. A coluna do goleiro fica
 * de fora: quem for empurrado para lá acabaria em cima da própria linha do gol.
 */
const ALL_CELLS: readonly AssignmentZone[] = TACTICAL_GRID.columns
  .filter((column) => column !== GOALKEEPER_COLUMN)
  .flatMap((column) => TACTICAL_GRID.rows.map((row) => ({ column, row })));

const byId = (first: PlayerRuntime, second: PlayerRuntime): number =>
  first.profile.id.localeCompare(second.profile.id);

// ---------------------------------------------------------------------------------------------
// Escolhas singulares que sobrevivem da versão anterior do plano coletivo. Continuam sendo
// decisões do time, mas agora entregam um dever numerado em vez de um id solto.
// ---------------------------------------------------------------------------------------------

/**
 * Quem vai na bola. É a mesma fila da disputa que a decisão individual lê a cada quadro
 * (`chasersFor`), e não uma segunda escolha em paralelo — o dever só congela por dois segundos o
 * que a corrida responde continuamente.
 */
const choosePresser = (state: MatchState, team: Team): PlayerRuntime | null => {
  const [id] = chasersFor(state, team, 1);
  return id ? state.players.find((player) => player.profile.id === id) ?? null : null;
};

/**
 * Segundo engajador: sai da linha para dividir quando a bola do adversário entra no nosso terço
 * defensivo e o portador não tem pressão real (o primeiro pressionador está longe).
 *
 * O eixo `pressing` entra aqui, e só aqui: ele move o teto do "nosso terço". Time disposto a
 * pressionar longe do próprio gol manda o segundo homem já no meio-campo; time recuado só o
 * solta na entrada da área.
 */
const chooseSecondPresser = (
  state: MatchState,
  team: Team,
  candidates: PlayerRuntime[],
  presser: PlayerRuntime | null,
  carrier: PlayerRuntime | null,
): PlayerRuntime | null => {
  if (!carrier || carrier.team === team) return null;
  const dangerZone = DEFENSE.dangerZoneProgress
    + mentalityBias(mentalityOf(state, team).pressing) * MENTALITY.pressDangerZone;
  if (attackingProgress(team, state.ball.position.x) >= dangerZone) return null;
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
  const central = centrality(player.position);
  const fromInstruction = player.instruction.support === "hold" ? 8 : player.instruction.support === "attack" ? -8 : 0;
  return player.profile.skills.defending * 0.42 + player.profile.mental.decisionMaking * 0.2
    + player.profile.mental.anticipation * 0.18 + player.profile.mental.teamwork * 0.12
    + goalSide * 5 + central * 3 + fromInstruction - forwardness(player, context) * 6;
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

  // A tabela: quem acabou de entregar a bola se oferece para a devolução, enquanto a janela da
  // parede estiver aberta. O bônus já existia na nota do passe (`DECISION.pass.wallPass`) e não
  // tinha corpo nenhum para receber — quem passava virava apoio comum e voltava para o bolsão
  // dele, à frente da bola. É a mesma janela e o mesmo parceiro que `choosePass` premia.
  const partner = state.lastAssist && state.lastAssist.team === team
    && state.elapsed - state.lastAssist.time < DECISION.pass.wallPassWindow
    ? remaining.find((player) => player.profile.id === state.lastAssist?.playerId)
    : undefined;
  if (partner) duties.set(partner.profile.id, { duty: "recycle", priority: 0, targetPlayerId: null });

  // Rest defense: que fatia do time fica atrás da bola. Quanto mais risco, menos gente. É uma
  // proporção e não um número fixo porque o motor aceita qualquer formato: três homens de
  // retaguarda num 11x11 é um bloco, num 5x5 é o time inteiro parado.
  const available = remaining.filter((player) => !duties.has(player.profile.id));
  const restShare = context.risk > 0.7 ? 0.22 : context.risk < 0.35 ? 0.42 : 0.33;
  const restCount = clamp(Math.round(available.length * restShare), 1, Math.max(1, available.length - 2));
  const ranked = [...available].sort((first, second) =>
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
  outfield: PlayerRuntime[],
  opponents: PlayerRuntime[],
  duties: Map<string, DutyChoice>,
): void => {
  const carrier = state.players.find((player) => player.profile.id === context.ballActorId) ?? null;
  const carrierId = carrier && carrier.team !== team ? carrier.profile.id : null;

  // Sem gatilho em vigor ninguém sai para a bola: o time inteiro sustenta a zona e espera. É o
  // que "gatilho desabilitado" quer dizer, e é o que dá sentido à lista vazia do plano.
  const presser = context.pressTrigger ? choosePresser(state, team) : null;
  if (presser) duties.set(presser.profile.id, { duty: "press", priority: 0, targetPlayerId: carrierId });
  const second = context.pressTrigger
    ? chooseSecondPresser(
      state,
      team,
      outfield.filter((player) => !duties.has(player.profile.id)),
      presser,
      carrier,
    )
    : null;
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

/**
 * Altura da linha de campo mais recuada — o que sobe e desce o time inteiro. Sai da posição da
 * bola, com uma folga que depende do momento: com a bola a última linha acompanha de perto, para
 * o time não se partir em dois; sem ela a folga é o próprio bloco, que alto cola na bola e baixo
 * cai para a área.
 *
 * É esta função que faz os dois times ocuparem a **mesma** região do campo — quem ataca sobe
 * atrás da bola, quem defende recua na frente dela, e as linhas se interpenetram. Enquanto a
 * profundidade era uma tabela fixa por coluna, cada time morava na sua metade.
 */
const isHighBlock = (context: AssignmentContext): boolean => context.defensiveBlock === "high"
  || context.phase === "highPress" || context.phase === "counterPress";

const isLowBlock = (context: AssignmentContext): boolean => context.defensiveBlock === "low"
  || context.phase === "lowBlock";

/**
 * Quanto o time encurta a distância entre as linhas. Com a bola o time se estica para criar
 * espaço; sem ela encolhe, e encolhe muito quando defende a própria área — dez jogadores num
 * bloco baixo cabem na profundidade da grande área, não em trinta e cinco metros de campo.
 */
const shapeDepthFor = (context: AssignmentContext): number => context.posture === "inPossession"
  ? context.phase === "buildUp" ? 1.15 : context.phase === "counterAttack" ? 1.1 : 1
  : isLowBlock(context) ? 0.42
    : isHighBlock(context) ? 0.95
      : context.phase === "recovery" ? 0.7
        : 0.8;

/**
 * Onde a forma se coloca no campo, devolvida como a profundidade da linha mais recuada.
 *
 * A referência muda com o momento, e é isso que faz o time defender de verdade:
 *
 * - **com a bola**, a referência é a retaguarda — a última linha fica uma folga atrás da bola,
 *   e a forma se estende para a frente até o ataque;
 * - **sem a bola**, a referência é a frente — a primeira linha de pressão fica junto da bola
 *   (ou à frente dela, se o bloco for alto), e a forma se estende para trás, entre a bola e o
 *   próprio gol. Ancorar pela retaguarda deixava o time inteiro à frente da bola quando ela
 *   entrava na área, com menos de dois homens para defender.
 */
const lineHeightFor = (state: MatchState, team: Team, context: AssignmentContext, depth: number): number => {
  const ballDepth = attackingProgress(team, state.ball.position.x) * 100;
  // Eixo `defensiveLine`: o único ponto em que a ordem do treinador sobe ou desce a forma. Entra
  // no fim, sobre as duas posturas, para "linha alta" significar o mesmo com e sem a bola.
  const coach = mentalityBias(mentalityOf(state, team).defensiveLine) * MENTALITY.lineHeight;
  if (context.posture === "inPossession") {
    const behind = context.phase === "buildUp" ? 6 : context.phase === "counterAttack" ? 18 : 12;
    return clamp(ballDepth - behind + coach, LINE_HEIGHT_RANGE.lowest, LINE_HEIGHT_RANGE.highest);
  }
  const ahead = isHighBlock(context) ? 16 : isLowBlock(context) ? 3 : 8;
  const front = ballDepth + ahead;
  return clamp(front - SHAPE_SPAN * depth + coach, LINE_HEIGHT_RANGE.lowest, LINE_HEIGHT_RANGE.highest);
};

/**
 * Largura que a formação abre. Com a bola o time procura os corredores de fora para esticar o
 * adversário; sem a bola fecha, porque bloco compacto é o que impede o passe por dentro. Sair
 * de aberto para fechado e voltar é o que dá ao jogo o respiro de comprimir e espalhar.
 */
/**
 * Até onde a forma pode chegar à frente. Para quem **ataca**, o limite é a penúltima linha
 * adversária — a mesma referência do impedimento. O motor não apita a infração; ele impede que
 * a incumbência coloque alguém lá, que é o efeito tático que interessa: o atacante joga **na**
 * última linha, não atrás dela, e as duas equipes se encaixam uma na outra em vez de uma viver
 * nas costas da outra esperando a bola longa.
 *
 * Quem defende não tem limite: recuar é sempre permitido.
 */
const forwardLimitFor = (state: MatchState, team: Team, context: AssignmentContext): number => {
  if (context.posture !== "inPossession") return 94;
  const opponents = state.players
    .filter((player) => player.team !== team)
    .map((player) => attackingProgress(team, player.position.x) * 100)
    .sort((first, second) => second - first);
  // O segundo mais recuado do adversário (contando o goleiro) é a linha do impedimento.
  const offsideLine = opponents[1] ?? 94;
  // Nunca atrás da bola: quem está à frente dela com a bola no pé não está impedido.
  const ballDepth = attackingProgress(team, state.ball.position.x) * 100;
  // "Equilibrado": os corredores podem espiar além da última linha por esta margem, apostando na
  // diagonal nas costas da defesa. Agora quem apita o impedimento é a Lei 11 de verdade
  // (runtime/offside), no instante do passe — o teto só deixa de proibir a posição ilegal.
  return clamp(Math.max(offsideLine, ballDepth) + OFFSIDE.runMarginProgress * 100, 32, 94);
};

const teamWidthFor = (state: MatchState, team: Team, context: AssignmentContext): number => {
  const base = context.posture === "inPossession"
    ? context.phase === "finalThird" ? 0.78 : context.phase === "buildUp" ? 0.72 : 0.7
    : isLowBlock(context) ? 0.38 : isHighBlock(context) ? 0.5 : 0.44;
  // Eixo `width`: o único ponto em que o treinador abre ou fecha o time.
  return clamp(base + mentalityBias(mentalityOf(state, team).width) * MENTALITY.teamWidth, 0.24, 0.96);
};

/**
 * Quanto o bloco desliza de lado, em fração da altura do campo: para o canal de ataque com a
 * bola, para o lado da bola sem ela. Metade do caminho até o eixo do corredor — deslizar o
 * bloco inteiro até lá deixaria o flanco oposto vazio, que é justamente o defeito que o passo
 * discreto de linha produzia.
 */
const LANE_SLIDE = 0.14;

const laneShift = (state: MatchState, context: AssignmentContext): number => {
  if (context.posture === "inPossession") {
    return context.attackChannel === "left" ? -LANE_SLIDE : context.attackChannel === "right" ? LANE_SLIDE : 0;
  }
  const lane = clamp(state.ball.position.y / FIELD.height, 0, 1);
  return (lane - 0.5) * 2 * LANE_SLIDE;
};

const desiredCell = (
  state: MatchState,
  team: Team,
  player: PlayerRuntime,
  choice: DutyChoice,
  placement: TeamShapePlacement,
  attackingCells: AssignmentZone[],
): AssignmentZone => {
  const base = baseCell(player);
  if (choice.duty === "goalkeep") return base;
  // Quem vai à bola ocupa a célula da bola; quem marca homem ocupa a do marcado.
  if (choice.duty === "carry" || choice.duty === "receive" || choice.duty === "press") {
    return cellAt(state.ball.position, team, placement);
  }
  if (choice.duty === "trackRunner") {
    const mark = state.players.find((candidate) => candidate.profile.id === choice.targetPlayerId);
    if (mark) return cellAt(mark.position, team, placement);
  }
  // A coluna já não carrega a subida do bloco — isso é a altura de linha. O que sobra aqui é o
  // desenho: quem ataca a profundidade vive uma linha à frente, quem protege uma atrás.
  // O deslize lateral do bloco mora na colocação (`placement.lateralShift`), contínuo. Aqui só
  // resta o desenho: quem ataca a profundidade vive uma linha à frente, quem protege uma atrás.
  const shifted = base;
  if (choice.duty === "runInBehind" || choice.duty === "overlap") return shiftCell(shifted, 1, 0);
  if (choice.duty === "restDefense") {
    // Recuar uma linha, mas nunca até a coluna do goleiro: ali a profundidade é a linha do gol.
    const dropped = shiftCell(shifted, -1, 0);
    return dropped.column === GOALKEEPER_COLUMN ? shifted : dropped;
  }
  // Quem segura a largura vai para a faixa de fora do seu lado, não para a que o bloco deslizou.
  if (choice.duty === "width") return { column: shifted.column, row: base.row <= CENTER_ROW ? FIRST_ROW : LAST_ROW };
  // Apoio: se um vizinho da frente saiu para atacar as costas da linha, sobe uma linha para
  // ocupar o espaço que abriu entre as linhas, em vez de manter a própria célula. É o
  // companheiro entrando no buraco que a corrida acabou de criar.
  if (choice.duty === "support") {
    const neighbourRuns = attackingCells.some((cell) =>
      cell.column > shifted.column && cellDistance(shifted, cell) <= 3);
    if (neighbourRuns) return shiftCell(shifted, 1, 0);
  }
  return shifted;
};

/**
 * Quanto o jogador estica para fora da forma. O ponta que vê o meia entrando por dentro abre na
 * linha lateral: leva o marcador junto e mantém aberto o espaço que o companheiro vai atacar.
 * É a reação ao vizinho que o desenho da formação sozinho não produz.
 */
const lateralPullFor = (player: PlayerRuntime, choice: DutyChoice, attackingRows: Set<number>): number => {
  if (choice.duty === "overlap") return 0.6;
  if (choice.duty !== "width") return 0;
  const row = baseCell(player).row;
  const neighbourAttacks = [...attackingRows].some((other) => other !== row && Math.abs(other - row) <= 2);
  return neighbourAttacks ? 1 : 0.35;
};

/**
 * A célula que o jogador de fato recebe, quando a que ele queria já é de outro. `previous` é a que
 * ele ocupava no plano anterior, e entra como **histerése**: entre as livres igualmente próximas do
 * que ele queria, a que ele já estava ocupando.
 *
 * Sem ela o desempate era ordem fixa da grade, e o primeiro critério (`Math.abs(column - desired
 * .column)`) preferia preservar a COLUNA — isto é, preferia deslocar o jogador de FAIXA, ~11 m para
 * o lado. Como a ordem de reivindicação muda junto com os deveres (`DUTY_CLAIM`, prioridade), o
 * deslocamento saía diferente a cada plano e o jogador era jogado de um lado para o outro: medido,
 * **10,1 trocas de faixa por jogador por minuto**. Ninguém ocupa uma faixa que é dele por seis
 * segundos, e era isso que deixava o time jogando 34 m de largura com os alvos pedindo 46.
 */
const firstFreeCell = (
  desired: AssignmentZone,
  taken: Set<string>,
  previous: AssignmentZone | null,
): AssignmentZone => {
  if (!taken.has(cellKey(desired))) return desired;
  return ALL_CELLS
    .filter((cell) => !taken.has(cellKey(cell)))
    .sort((first, second) => cellDistance(desired, first) - cellDistance(desired, second)
      || (previous ? cellDistance(previous, first) - cellDistance(previous, second) : 0)
      || Math.abs(first.column - desired.column) - Math.abs(second.column - desired.column)
      || first.column - second.column
      || first.row - second.row)[0] ?? desired;
};

/**
 * Onde a forma do time está neste instante. Sai do plano coletivo de propósito: **quem faz o
 * quê** muda devagar e pode ficar em cache por alguns segundos, mas **onde o time está** é
 * contínuo e tem que acompanhar a bola a cada tick. Enquanto a colocação viajava dentro do
 * plano em cache, o bloco levava segundos para recuar e a bola entrava na área com o time
 * inteiro ainda à frente dela.
 */
export const placementFor = (state: MatchState, team: Team, context: AssignmentContext): TeamShapePlacement => {
  const depth = shapeDepthFor(context);
  return {
    lineHeight: lineHeightFor(state, team, context, depth),
    width: teamWidthFor(state, team, context),
    depth,
    lateralShift: laneShift(state, context),
    forwardLimit: forwardLimitFor(state, team, context),
  };
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
    : (assignOutOfPossession(state, team, context, outfield, opponents, duties), null);

  const placement = placementFor(state, team, context);
  const chosen = players.map((player) => ({
    player,
    // Rede de segurança: se alguma trilha nova esquecer um jogador, ele sustenta a zona dele em
    // vez de virar um corpo sem função. A invariante de totalidade é testada à parte.
    choice: duties.get(player.profile.id)
      ?? { duty: "holdLine" as AssignmentDuty, priority: 99, targetPlayerId: null },
  }));
  const attackers = chosen.filter(({ choice }) => choice.duty === "runInBehind" || choice.duty === "overlap");
  // De onde saiu quem foi atacar: é a referência de quem apoia (sobe para o espaço aberto) e de
  // quem segura a amplitude (estica para levar o marcador embora dali).
  const attackingCells = attackers.map(({ player }) => baseCell(player));
  const attackingRows = new Set(attackers.map(({ player }) => baseCell(player).row));
  const wanted = chosen.map(({ player, choice }) => ({
    player,
    choice,
    cell: desiredCell(state, team, player, choice, placement, attackingCells),
    lateralPull: lateralPullFor(player, choice, attackingRows),
  }));

  const taken = new Set<string>();
  const assignments: Record<string, PlayerAssignment> = {};
  const ordered = [...wanted].sort((first, second) =>
    DUTY_CLAIM[second.choice.duty] - DUTY_CLAIM[first.choice.duty]
    || first.choice.priority - second.choice.priority
    || second.player.positionFit - first.player.positionFit
    || byId(first.player, second.player));

  // As células do plano anterior: a memória de onde cada um estava, para o deslocamento por
  // exclusividade não remanejar o time a cada atualização. Mesma fonte que o `previousSafetyId`.
  const previousZones = state.tactics[team].collectivePlan?.assignments;
  for (const { player, choice, cell, lateralPull } of ordered) {
    const zone = firstFreeCell(cell, taken, previousZones?.[player.profile.id]?.zone ?? null);
    taken.add(cellKey(zone));
    assignments[player.profile.id] = {
      duty: choice.duty,
      priority: choice.priority,
      zone,
      targetPlayerId: choice.targetPlayerId,
      freedom: clamp(SUPPORT_FREEDOM[player.instruction.support] * DUTY_FREEDOM[choice.duty], 0, 1),
      lateralPull,
      rationale: DUTY_REASON[choice.duty],
    };
  }

  return { assignments, safetyId, placement };
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
