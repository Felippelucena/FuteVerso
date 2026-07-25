import { FIELD, RESTART, STAMINA } from "../config";
import { add, clamp, distance, normalize, scale, subtract } from "../../shared/math";
import type { MatchState, PlayerRuntime, RestartKind, RestartState, Team, TeamShapePlacement, Vec2 } from "../model";
import { clearDribbleOwner, clearGoalkeeperAttempts, registerControlledTeam } from "./control";
import { emitCognitiveEvent } from "./cognitive-events";
import { emitMatchEvent } from "./events";
import { attackDirection, baseCell, cellAnchor, formationAnchor, insidePenaltyArea, kickoffBallPosition, kickoffPosition, kickoffTaker, NEUTRAL_LINE_HEIGHT } from "./formation-geometry";
import { goalkeeperGuardPost } from "./goalkeeper-geometry";
import { attackingProgress } from "./offside";

/**
 * Bola parada com CAMINHADA, não teleporte. A jogada morre, a bola é posta no ponto, o cobrador
 * caminha até ela e só então o jogo volta. Três fases, todas em `state.restart`:
 *
 * 1. **Parada** (`!ballInPlay`, sem dono): a bola fica no ponto (fixada em `updateBall`), ninguém a
 *    disputa (`restartForbidsTouch`) e todos caminham para o desenho do reinício (`restartLayoutTarget`,
 *    a "fonte de incumbência" da bola parada, com prioridade sobre a cognição normal em `decideAll`).
 * 2. **Cobrador de posse** (`!ballInPlay`, dono = cobrador): `advanceRestart` entrega a posse quando o
 *    cobrador chega ao ponto E passou o tempo mínimo de preparo. A Regra 8 obriga o primeiro toque a
 *    ser um passe (`isRestartTaker`), como na saída de bola.
 * 3. **Em jogo** (`ballInPlay`): o cobrador chutou (`registerRestartKick`); ele não pode retocar até
 *    outro jogador tocar (`updateRestartRestriction` mata o estado nesse instante).
 *
 * `runtime/kickoff` guarda só a agenda de tempos; toda a mecânica do reinício vive aqui, para os
 * sistemas de detecção (ball) e de relógio (lifecycle) não importarem um ao outro (Regra 9).
 */

const fieldRestartMargin = (): number =>
  Math.max(RESTART.fieldMarginFloor, FIELD.goalAreaDepth * RESTART.fieldMarginFactor);

// ---------------------------------------------------------------------------------------------
// Zona de exclusão: o espaço que o adversário deixa livre até a bola entrar em jogo
// ---------------------------------------------------------------------------------------------

/**
 * Uma regra só para as Leis 8, 13, 15, 16 e 17. Cada reinício exige do ADVERSÁRIO uma distância
 * do ponto da cobrança (9,15 m no tiro livre, no escanteio e na saída; 2 m no lateral) e, quando
 * a cobrança é da defesa dentro da própria área (tiro de meta e tiro livre ali), a grande área
 * inteira. Não há predicado separado de "está irregular": *estar irregular é ser movido pela
 * projeção*, o que impede o desenho e o gate de discordarem.
 *
 * Consumida em dois lugares, e só neles: o alvo de caminhada do adversário (`restartLayoutTarget`)
 * e o gate da cobrança (`advanceRestart`) — o mesmo par "eles recuam / o árbitro segura o jogo"
 * do futebol de verdade, com `maxSetupSeconds` como trava.
 */
const exclusionRadius = (kind: RestartKind): number =>
  kind === "throwIn" ? RESTART.throwInOpponentDistance
    : kind === "goalKick" ? 0
      : RESTART.opponentDistance;

/** Lei 16 (tiro de meta) e Lei 13 (tiro livre da defesa dentro da própria área). */
const forbidsOwnBox = (restart: RestartState): boolean =>
  restart.kind === "goalKick"
  || (restart.kind === "freeKick" && insidePenaltyArea(restart.team, restart.spot, true));

const pushedOutOfRadius = (point: Vec2, spot: Vec2, radius: number): Vec2 => {
  const gap = distance(point, spot);
  if (radius <= 0 || gap >= radius) return point;
  const away = gap < 0.001 ? { x: 0, y: 1 } : normalize(subtract(point, spot));
  return add(spot, scale(away, radius));
};

/**
 * Cobrança dentro da própria área: as duas exigências viram uma só no eixo da profundidade — o
 * adversário recua para fora da área e, se o ponto da cobrança ainda estiver perto, mais um tanto.
 * Resolver no mesmo eixo é o que garante que a projeção satisfaça as duas de uma vez (empurrar em
 * volta do ponto e depois para fora da área poderia devolvê-lo à área, e o gate travaria).
 */
const pushedBeyondBox = (point: Vec2, restart: RestartState, radius: number): Vec2 => {
  // A Lei manda sair da ÁREA, não recuar atrás de uma linha imaginária: quem está pela ponta, já
  // fora dela pela lateral, e longe da bola, está regular onde está.
  const irregular = insidePenaltyArea(restart.team, point, true)
    || (radius > 0 && distance(point, restart.spot) < radius);
  if (!irregular) return point;
  const direction = attackDirection(restart.team);
  const ownGoalX = direction > 0 ? 0 : FIELD.width;
  const lateralGap = Math.abs(point.y - restart.spot.y);
  const radialDepth = lateralGap < radius ? Math.sqrt(radius * radius - lateralGap * lateralGap) : 0;
  const spotDepth = Math.abs(restart.spot.x - ownGoalX);
  const minimumDepth = Math.max(
    FIELD.penaltyDepth + RESTART.boxClearanceMargin,
    radialDepth > 0 ? spotDepth + radialDepth : 0,
  );
  const depth = Math.abs(point.x - ownGoalX);
  if (depth >= minimumDepth) return point;
  return { x: ownGoalX + direction * minimumDepth, y: point.y };
};

/** O ponto legal mais próximo para um adversário nesta cobrança. */
export const clearedOfRestart = (restart: RestartState, point: Vec2): Vec2 => {
  const radius = exclusionRadius(restart.kind);
  return forbidsOwnBox(restart)
    ? pushedBeyondBox(point, restart, radius)
    : pushedOutOfRadius(point, restart.spot, radius);
};

/** Todos os adversários já deixaram a zona livre? É o que a cobrança espera antes de sair. */
const opponentsCleared = (state: MatchState, restart: RestartState): boolean =>
  state.players.every((player) => player.team === restart.team
    || distance(clearedOfRestart(restart, player.position), player.position) < 0.01);

/** Quem cobra o reinício: goleiro no tiro de meta, cobrador da saída no kickoff, mais próximo nos demais. */
const chooseTaker = (state: MatchState, team: Team, kind: RestartKind, exitPosition: Vec2): PlayerRuntime | null => {
  if (kind === "kickoff") return kickoffTaker(state.players, team);
  if (kind === "goalKick") {
    return state.players.find((player) => player.team === team && player.profile.position === "goalkeeper") ?? null;
  }
  return [...state.players]
    .filter((player) => player.team === team && player.profile.position !== "goalkeeper")
    .sort((a, b) =>
      distance(a.position, exitPosition) - distance(b.position, exitPosition)
      || a.profile.id.localeCompare(b.profile.id))[0] ?? null;
};

/**
 * Onde a bola descansa (`spot`) e para onde o cobrador olha (`facing`). `facing` aponta sempre para
 * DENTRO do campo (a direção da cobrança). A posição do cobrador não vem daqui: é sempre um passo
 * atrás da bola (ver `restartGeometry`), o que já o deixa na linha/fora dela no lateral e junto da
 * bola no escanteio, sem regra especial.
 */
const restartSpot = (kind: RestartKind, exitPosition: Vec2, team: Team): { spot: Vec2; facing: Vec2 } => {
  const dir = attackDirection(team);
  const margin = fieldRestartMargin();
  if (kind === "kickoff") return { spot: kickoffBallPosition(), facing: { x: dir, y: 0 } };
  if (kind === "goalKick") {
    // Lei 16: a bola sai de qualquer ponto da PEQUENA área (a marca do pênalti é da Lei 14, e é
    // de lá que ela saía antes — fora da pequena). Vale o canto do lado por onde ela saiu, como
    // no jogo de verdade, encostado para dentro para a bola INTEIRA ficar dentro da marcação.
    const depth = FIELD.goalAreaDepth - FIELD.ballRadius;
    const side = exitPosition.y < FIELD.height / 2 ? -1 : 1;
    return {
      spot: {
        x: dir > 0 ? depth : FIELD.width - depth,
        y: FIELD.height / 2 + side * (FIELD.goalAreaWidth / 2 - FIELD.ballRadius),
      },
      facing: { x: dir, y: 0 },
    };
  }
  if (kind === "throwIn") {
    // Bola um passo para DENTRO da linha lateral (não sobre ela, senão o chute a jogaria para fora).
    const top = exitPosition.y < FIELD.height / 2;
    const x = clamp(exitPosition.x, margin, FIELD.width - margin);
    const inset = RESTART.throwInBallInset;
    return { spot: { x, y: top ? inset : FIELD.height - inset }, facing: normalize({ x: dir * 0.35, y: top ? 1 : -1 }) };
  }
  if (kind === "corner") {
    // Bola uns passos para dentro da quina (senão sairia direto pela lateral), na diagonal do gol.
    const fromLeft = exitPosition.x < FIELD.width / 2;
    const top = exitPosition.y < FIELD.height / 2;
    const inset = RESTART.cornerBallInset;
    return {
      spot: { x: fromLeft ? inset : FIELD.width - inset, y: top ? inset : FIELD.height - inset },
      facing: normalize({ x: fromLeft ? 1 : -1, y: top ? 1 : -1 }),
    };
  }
  // freeKick: no ponto da infração, virado para o ataque do time.
  return {
    spot: { x: clamp(exitPosition.x, margin, FIELD.width - margin), y: clamp(exitPosition.y, margin, FIELD.height - margin) },
    facing: { x: dir, y: 0 },
  };
};

/**
 * Geometria completa do reinício. O cobrador para SEMPRE um passo atrás da bola, na direção
 * contrária à cobrança (`spot − facing·offset`) — a mesma regra para os seis tipos. Como `facing`
 * aponta para dentro do campo, esse passo atrás o coloca na linha (ou logo fora) no lateral e junto
 * do arco no escanteio, sempre a ~um passo da bola: perto o bastante para `advanceRestart` acusar a
 * chegada, sem o cobrador precisar caminhar até um ponto solto fora do campo.
 */
const restartGeometry = (kind: RestartKind, exitPosition: Vec2, team: Team): { spot: Vec2; facing: Vec2; takerStand: Vec2 } => {
  const { spot, facing } = restartSpot(kind, exitPosition, team);
  return { spot, facing, takerStand: subtract(spot, scale(facing, RESTART.takerStandOffset)) };
};

/**
 * Inicia uma bola parada: põe a bola no ponto (parada), escolhe o cobrador e arma o estado. NÃO
 * mexe na posição dos jogadores — eles caminham até o desenho por conta própria. Chamado pela
 * detecção de saída de bola (ball-system) e pelos reinícios do lifecycle (intervalo, impedimento).
 */
export const beginRestart = (state: MatchState, kind: RestartKind, team: Team, exitPosition: Vec2): void => {
  const taker = chooseTaker(state, team, kind, exitPosition);
  const { spot, facing, takerStand } = restartGeometry(kind, exitPosition, team);
  const ball = state.ball;
  ball.position = { ...spot };
  ball.velocity = { x: 0, y: 0 };
  ball.height = 0;
  ball.verticalVelocity = 0;
  ball.controllerId = null;
  clearDribbleOwner(state);
  ball.controlStartedAt = 0;
  ball.lastTouch = null;
  ball.lastTouchPlayerId = null;
  ball.lastAction = null;
  ball.lastShotOnTarget = false;
  state.ballControlTeam = null;
  state.possessionTeam = null;
  state.possessionCandidateTeam = null;
  state.possessionCandidateSince = state.elapsed;
  if (state.pendingPass) emitCognitiveEvent(state, "passResolved", null, { passId: state.pendingPass.id, outcome: "out" });
  state.pendingPass = null;
  state.activeShot = null;
  clearGoalkeeperAttempts(state);
  state.feintEvasion = null;
  // Bola parada dá fôlego à volátil; a longa (fôlego de partida) não recupera. Só na saída de bola,
  // como antes — nos demais reinícios a própria caminhada já devolve a volátil.
  if (kind === "kickoff") {
    for (const player of state.players) {
      player.sprintEnergy = Math.min(1, player.sprintEnergy + STAMINA.volatileDeadBallRecovery);
    }
  }
  state.restart = taker
    ? { kind, team, takerId: taker.profile.id, spot, takerStand, facing, startedAt: state.elapsed, ballInPlay: false }
    : null;
  state.offsideWatch = null;
  // Lateral, escanteio e tiro de meta não têm impedimento na cobrança; o tiro livre e a saída, sim.
  state.offsideExemptRestart = kind === "throwIn" || kind === "corner" || kind === "goalKick";
  state.nextCognitionAt = state.elapsed;
  // A saída de bola não emite `restart-awarded` (o evento é dos reinícios com a bola saindo de campo).
  if (kind !== "kickoff") emitMatchEvent(state, { type: "restart-awarded", team, restartKind: kind });
};

/** Reinício do impedimento: tiro livre indireto para o time que defende, no ponto da infração. */
export const restartFreeKick = (state: MatchState, defendingTeam: Team, spot: Vec2): void => {
  beginRestart(state, "freeKick", defendingTeam, spot);
};

/**
 * Entrega a posse ao cobrador: mesma configuração final da cobrança instantânea antiga (bola no
 * pé, posse forçada), mas só depois da caminhada. `ballInPlay` segue falso — ele vira verdadeiro
 * quando o cobrador de fato chuta (`registerRestartKick`), o que mantém a Regra 8 do primeiro toque.
 */
const promoteRestartToLive = (state: MatchState): void => {
  const restart = state.restart;
  if (!restart) return;
  const taker = state.players.find((player) => player.profile.id === restart.takerId);
  if (!taker) {
    state.restart = null;
    return;
  }
  taker.facing = { ...restart.facing };
  taker.kickCooldown = 0;
  const ball = state.ball;
  // A bola fica no ponto (não no pé): o cobrador pode estar fora do campo, e a golpeia dali.
  ball.position = { ...restart.spot };
  ball.velocity = { x: 0, y: 0 };
  ball.height = 0;
  ball.verticalVelocity = 0;
  ball.controllerId = taker.profile.id;
  clearDribbleOwner(state);
  ball.controlStartedAt = state.elapsed;
  ball.lastTouch = restart.team;
  ball.lastTouchPlayerId = taker.profile.id;
  ball.lastAction = null;
  ball.lastShotOnTarget = false;
  registerControlledTeam(state, restart.team, true);
};

/**
 * A cada tick da bola parada: enquanto o cobrador caminha, entrega a posse quando ele chega ao
 * ponto E o preparo mínimo passou; se demorar demais (cobrador cercado), força a colocação e
 * cobra assim mesmo — a trava que garante que a jogada nunca trava.
 */
/** Saída de bola: os dois times já ocupam cada um o seu campo? ("um time para cada lado".) */
const teamsInOwnHalves = (state: MatchState): boolean => state.players.every((player) => {
  if (player.profile.position === "goalkeeper") return true;
  return attackDirection(player.team) > 0
    ? player.position.x <= FIELD.width / 2 + player.radius
    : player.position.x >= FIELD.width / 2 - player.radius;
});

export const advanceRestart = (state: MatchState, dt: number): void => {
  const restart = state.restart;
  if (!restart || restart.ballInPlay) return;
  state.contestedSeconds += dt;
  // Cobrador já com a posse, esperando o toque: nada a avançar (o passe sai pela cognição).
  if (state.ball.controllerId !== null) return;
  const taker = state.players.find((player) => player.profile.id === restart.takerId);
  if (!taker) {
    promoteRestartToLive(state);
    return;
  }
  const stand = restart.takerStand;
  const arrived = distance(taker.position, stand) <= RESTART.arrivalRadius;
  const minElapsed = state.elapsed >= restart.startedAt + RESTART.minSetupSeconds;
  const timedOut = state.elapsed >= restart.startedAt + RESTART.maxSetupSeconds;
  // O árbitro segura a cobrança até o adversário respeitar a distância (Leis 8, 13, 15, 16 e 17).
  // Na saída de bola vale ainda a outra metade da Lei 8, que é dos DOIS times: cada um no seu
  // campo — o reposicionamento após o gol/intervalo tem que concluir.
  const positioned = opponentsCleared(state, restart)
    && (restart.kind !== "kickoff" || teamsInOwnHalves(state));
  if (timedOut) {
    taker.position = { ...stand };
    taker.velocity = { x: 0, y: 0 };
  }
  if ((arrived && minElapsed && positioned) || timedOut) promoteRestartToLive(state);
};

/**
 * O alvo de caminhada de cada jogador na bola parada — a "fonte de incumbência" que sobrepõe a
 * cognição normal. Aproximado e posicional: reaproveita a geometria da formação, sem coreografia.
 */
export const restartLayoutTarget = (player: PlayerRuntime, state: MatchState): Vec2 => {
  const restart = state.restart!;
  if (player.profile.id === restart.takerId) return restart.takerStand;
  // O goleiro que não cobra não tem desenho de reinício: ele tem posição de goleiro, e ela já se
  // refere à bola parada no ponto — poste próximo no escanteio, ângulo no tiro livre. Era daqui
  // que vinha o goleiro plantado numa âncora de formação enquanto o time se recolocava.
  if (player.profile.position === "goalkeeper") return goalkeeperGuardPost(player, restart.spot);
  const layout = restartLayoutShape(player, restart);
  return player.team === restart.team ? layout : clearedOfRestart(restart, layout);
};

const restartLayoutShape = (player: PlayerRuntime, restart: RestartState): Vec2 => {
  switch (restart.kind) {
    case "kickoff":
      return kickoffPosition(player, restart.team);
    case "goalKick":
      return goalKickTarget(player, restart);
    case "corner":
      return cornerTarget(player, restart.team);
    case "throwIn":
      return throwInTarget(player, restart);
    default:
      return formationAnchor(player);
  }
};

/**
 * Tiro de meta: quem cobra ARMA A SAÍDA — a zaga abre junto da área (desde 2019 o companheiro
 * pode receber dentro dela) e o meio se oferece; quem defende sobe para pressionar a borda. Antes
 * os dois times recebiam a mesma colocação no meio-campo, e o goleiro cobrava sem nenhuma opção
 * curta: só lhe restava lançar para dentro de um aglomerado, onde perdia a bola.
 */
const goalKickTarget = (player: PlayerRuntime, restart: RestartState): Vec2 => {
  const kicking = player.team === restart.team;
  const placement: TeamShapePlacement = kicking
    ? { lineHeight: RESTART.goalKickBuildUpLineHeight, width: RESTART.goalKickBuildUpWidth, depth: 1, forwardLimit: 94 }
    : {
      lineHeight: RESTART.goalKickPressLineHeight,
      width: RESTART.goalKickWidth,
      depth: 1,
      forwardLimit: RESTART.goalKickPressForwardLimit,
    };
  return cellAnchor(baseCell(player), player.team, placement);
};

/**
 * Escanteio: o bloco dos DOIS times se concentra na área ofensiva (junto do gol atacado). O time
 * que cobra sobe para a área (linha alta); o que defende comprime no próprio gol — ambos estreitos
 * para adensar o miolo da área, em vez de esparramar pela largura.
 */
const cornerTarget = (player: PlayerRuntime, restartTeam: Team): Vec2 => {
  const attacking = player.team === restartTeam;
  const placement: TeamShapePlacement = attacking
    ? { lineHeight: 58, width: 0.5, depth: 1, forwardLimit: RESTART.cornerAttackForwardLimit }
    : { lineHeight: RESTART.cornerDefendLineHeight, width: 0.5, depth: 1, forwardLimit: 94 };
  return cellAnchor(baseCell(player), player.team, placement);
};

/**
 * Lateral com contexto: quanto mais avançada a cobrança (perto do gol adversário do time que
 * cobra), mais **ofensivo** — o time que cobra sobe para a área; **construtivo** no próprio campo,
 * mantém a forma mais atrás. Cada um ainda é puxado de leve para a faixa lateral da bola.
 */
const throwInTarget = (player: PlayerRuntime, restart: RestartState): Vec2 => {
  const progress = attackingProgress(restart.team, restart.spot.x);
  const attacking = player.team === restart.team;
  const lineHeight = attacking
    ? NEUTRAL_LINE_HEIGHT + progress * 22
    : NEUTRAL_LINE_HEIGHT - (1 - progress) * 6;
  const placement: TeamShapePlacement = { lineHeight, width: 0.72, depth: 1, forwardLimit: 94 };
  const anchor = cellAnchor(baseCell(player), player.team, placement);
  return { x: anchor.x, y: anchor.y + (restart.spot.y - anchor.y) * 0.25 };
};

// --- Regra 8 generalizada: as restrições do primeiro toque, agora sobre `state.restart`. ---

/** Verdadeiro enquanto a bola está parada no ponto esperando a cobrança (ninguém a disputa). */
export const awaitingRestartTouch = (state: MatchState): boolean =>
  state.restart !== null && !state.restart.ballInPlay;

/** Verdadeiro quando este jogador é o cobrador e ainda não colocou a bola em jogo. */
export const isRestartTaker = (state: MatchState, playerId: string): boolean =>
  awaitingRestartTouch(state) && state.restart?.takerId === playerId;

/**
 * A Regra 8 proíbe este jogador de disputar a bola agora? Antes da cobrança, TODOS (a bola está
 * parada e o cobrador a recebe por entrega, não por disputa); depois da cobrança, só o cobrador,
 * até outro jogador tocar.
 */
export const restartForbidsTouch = (state: MatchState, playerId: string): boolean => {
  const restart = state.restart;
  if (!restart) return false;
  return restart.ballInPlay ? playerId === restart.takerId : true;
};

/** O cobrador chutou: a bola entrou em jogo, mas ele segue impedido de tocá-la de novo. */
export const registerRestartKick = (state: MatchState, playerId: string): void => {
  if (state.restart && !state.restart.ballInPlay && state.restart.takerId === playerId) {
    state.restart.ballInPlay = true;
  }
};

/**
 * A restrição do cobrador cai no instante em que outro jogador toca a bola. Ler o último toque
 * mantém a regra num lugar só: qualquer caminho que encoste na bola já registra quem tocou.
 */
export const updateRestartRestriction = (state: MatchState): void => {
  const restart = state.restart;
  if (!restart || !restart.ballInPlay) return;
  const lastTouch = state.ball.lastTouchPlayerId;
  if (lastTouch !== null && lastTouch !== restart.takerId) state.restart = null;
};
