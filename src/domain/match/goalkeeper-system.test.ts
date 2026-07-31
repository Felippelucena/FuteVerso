import { describe, expect, it } from "vitest";
import { distance } from "../shared/math";
import { smallSidedMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { FIELD, FIXED_STEP, GOALKEEPING } from "./config";
import { stepMatch } from "./engine";
import type { GoalkeeperAttempt, MatchState, PlayerRuntime, Vec2 } from "./model";
import { createMatchState } from "./state";
import { updateBall } from "./systems/ball-system";
import { updatePossession } from "./systems/possession-system";
import { goalkeeperReachRadius, updateGoalkeeperAnticipation } from "./systems/goalkeeper-system";

const createState = (seed = 55) => {
  const state = createMatchState(smallSidedMatchConfig(seed));
  startOpenPlay(state);
  state.events = [];
  return state;
};

const goalkeeper = (state: MatchState) => state.players.find((player) => player.team === "blue" && player.profile.position === "goalkeeper")!;

const makeElite = (keeper: PlayerRuntime) => {
  keeper.profile.skills.goalkeeping = 100;
  keeper.profile.skills.control = 100;
  keeper.profile.mental.anticipation = 100;
  keeper.profile.mental.decisionMaking = 100;
  keeper.profile.mental.composure = 100;
};

/** Puts the keeper in flight with the ball already inside his reach, ready to collide. */
const armLaunchedAttempt = (
  state: MatchState,
  keeper: PlayerRuntime,
  speed: number,
  height: number,
  options: { yOffset?: number; source?: "shot" | "aerial"; vertical?: number; desperate?: boolean } = {},
) => {
  const { yOffset = 0, source = "shot", vertical = 0, desperate = false } = options;
  keeper.position = { x: 10, y: FIELD.height / 2 };
  const direction: Vec2 = yOffset === 0 ? { x: 1, y: 0 } : { x: 0, y: Math.sign(yOffset) };
  const attempt: GoalkeeperAttempt = {
    source, sourceId: 1, action: source === "aerial" ? "aerialClaim" : vertical > 0 ? "verticalJump" : "lowDive",
    startedAt: 0, reactionReadyAt: 0, expiresAt: 3,
    origin: { ...keeper.position }, approachTarget: { ...keeper.position },
    launchedAt: 0, launchDirection: direction, launchSpeed: 0, launchVertical: vertical,
    flightTime: vertical > 0 ? 2 * vertical / GOALKEEPING.jumpGravity : GOALKEEPING.groundedDiveTime,
    reachRadius: goalkeeperReachRadius(keeper), desperate,
    outcome: null, contactQuality: null, resolvedAt: null,
  };
  keeper.goalkeeperAttempt = attempt;
  keeper.velocity = { x: 0, y: 0 };
  state.activeShot = source === "shot" ? {
    id: 1, shooterId: "maya-fw", team: "coral", startedAt: 0, technique: "power",
    origin: { x: 14, y: keeper.position.y + yOffset }, expectedGoals: 0,
    target: { x: 0, y: keeper.position.y + yOffset }, targetHeight: height,
    expectedArrivalAt: 0.2, expectedSpeed: speed,
    goalPoint: { position: { x: 0, y: keeper.position.y + yOffset }, height }, onTarget: true, goalkeeperTouched: false,
  } : null;
  state.ball.position = { x: 14, y: keeper.position.y + yOffset };
  state.ball.velocity = { x: -speed, y: 0 };
  state.ball.height = height;
  state.ball.verticalVelocity = 0;
  state.ball.controllerId = null;
  state.ball.lastAction = source === "shot" ? "shot" : "pass";
  state.ball.lastTouch = "coral";
  state.ball.lastTouchPlayerId = "maya-fw";
  state.elapsed = 0.08;
  return attempt;
};

/** Fires a shot at the blue goal from `range`, leaving the real engine to drive the keeper. */
const fireShotAtGoal = (state: MatchState, aimY: number, speed: number, height: number, range = 34) => {
  const keeper = goalkeeper(state);
  keeper.position = { x: 8, y: FIELD.height / 2 };
  keeper.velocity = { x: 0, y: 0 };
  // Ninguem no caminho: o cenario mede o goleiro, nao o zagueiro que corta a bola antes dele.
  for (const player of state.players) {
    if (player === keeper) continue;
    player.position = { x: FIELD.width - 6, y: 6 };
    player.kickCooldown = 9;
  }
  state.ball.position = { x: range, y: FIELD.height / 2 };
  state.ball.height = height;
  state.ball.verticalVelocity = 0;
  state.ball.controllerId = null;
  state.ball.lastAction = "shot";
  state.ball.lastTouch = "coral";
  state.ball.lastTouchPlayerId = "maya-fw";
  const flight = (range - 2) / speed;
  state.ball.velocity = { x: -speed, y: (aimY - FIELD.height / 2) / flight };
  state.activeShot = {
    id: 1, shooterId: "maya-fw", team: "coral", startedAt: state.elapsed, technique: "power",
    origin: { x: range, y: FIELD.height / 2 }, expectedGoals: 0,
    target: { x: 0, y: aimY }, targetHeight: height,
    expectedArrivalAt: state.elapsed + flight, expectedSpeed: speed,
    goalPoint: { position: { x: 0, y: aimY }, height }, onTarget: true, goalkeeperTouched: false,
  };
  return keeper;
};

interface SaveTrace {
  groundedFrames: number;
  groundedTravel: number;
  /** Quanto o corpo percorreu no ar, do impulso ao pouso — o mergulho que se vê na tela. */
  diveTravel: number;
  /** Quanto os pés saíram do lugar antes de decolar, em linha reta (não o caminho andado). */
  setDisplacement: number;
  launchDirection: Vec2 | null;
  launchedAtFrame: number | null;
  desperate: boolean;
  outcome: string | null;
}

/** Runs the real engine and records how the keeper's save unfolded. */
const traceSave = (state: MatchState, keeper: PlayerRuntime, frames: number, onFrame?: (frame: number) => void): SaveTrace => {
  const trace: SaveTrace = {
    groundedFrames: 0, groundedTravel: 0, diveTravel: 0, setDisplacement: 0, launchDirection: null,
    launchedAtFrame: null, desperate: false, outcome: null,
  };
  let previous = { ...keeper.position };
  // Só o PRIMEIRO lance interessa: depois dele o goleiro já está caçando a sobra, e nem essa
  // corrida é ajuste de pés nem o voo dela é o mergulho que se quer medir.
  let flightEndsAt: number | null = null;
  for (let frame = 0; frame < frames; frame += 1) {
    onFrame?.(frame);
    stepMatch(state, FIXED_STEP);
    const attempt = keeper.goalkeeperAttempt;
    const travelled = distance(keeper.position, previous);
    previous = { ...keeper.position };
    if (!attempt) continue;
    if (!trace.outcome && attempt.outcome) trace.outcome = attempt.outcome;
    // O corpo segue voando depois do toque, e é o voo inteiro que se vê na tela.
    if (flightEndsAt !== null) {
      if (state.elapsed < flightEndsAt) trace.diveTravel += travelled;
      continue;
    }
    if (trace.outcome) continue;
    if (attempt.launchedAt === null) {
      trace.groundedFrames += 1;
      trace.groundedTravel += travelled;
    } else {
      trace.launchedAtFrame = frame;
      trace.launchDirection = attempt.launchDirection ? { ...attempt.launchDirection } : null;
      trace.desperate = attempt.desperate;
      trace.setDisplacement = distance(attempt.origin, keeper.position);
      flightEndsAt = attempt.launchedAt + attempt.flightTime;
      trace.diveTravel += travelled;
    }
  }
  return trace;
};

describe("alcance fisico do goleiro", () => {
  it("alcanca apenas o proprio corpo mais um raio de braco", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    expect(goalkeeperReachRadius(keeper)).toBeCloseTo(keeper.radius * 2, 5);
    // Um goleiro parado no meio nao pode cobrir o gol inteiro so com alcance: com o gol nas
    // medidas oficiais e os corpos desenhados maiores que gente de verdade, o que se exige e
    // que sobre pelo menos um terco da boca para ele ter de ir buscar com o corpo.
    expect(goalkeeperReachRadius(keeper) * 2).toBeLessThan((FIELD.goalBottom - FIELD.goalTop) * 0.66);
  });
});

describe("decisao de saltar", () => {
  it("nao salta antes de terminar o tempo de reacao", () => {
    const state = createState();
    const keeper = fireShotAtGoal(state, FIELD.height / 2 + 8, 60, 1.2);
    makeElite(keeper);

    updateGoalkeeperAnticipation(state, FIXED_STEP);

    expect(keeper.goalkeeperAttempt).not.toBeNull();
    expect(keeper.goalkeeperAttempt?.launchedAt).toBeNull();
  });

  it("ajusta a posicao no chao antes de se comprometer com o salto", () => {
    const state = createState();
    // Chute lento e de longe: sobra tempo para a corridinha antes do salto.
    const keeper = fireShotAtGoal(state, FIELD.height / 2 + 9, 40, 1.1, 52);
    makeElite(keeper);

    const trace = traceSave(state, keeper, 240);

    expect(trace.groundedFrames).toBeGreaterThan(10);
    expect(trace.groundedTravel).toBeGreaterThan(0.5);
    expect(trace.launchedAtFrame).not.toBeNull();
    expect(trace.launchedAtFrame!).toBeGreaterThan(trace.groundedFrames - 1);
  });

  it("mergulha o corpo inteiro em vez de esticar ate a bola", () => {
    const state = createState();
    // Chute no canto com tempo de sobra: e o caso em que o goleiro ANDAVA ate a bola e chegava
    // la em pe. O salto tem de valer mais que o passo, senao ele nao existe na tela.
    const keeper = fireShotAtGoal(state, FIELD.height / 2 + 9, 40, 1.1, 52);
    makeElite(keeper);

    const trace = traceSave(state, keeper, 240);

    expect(trace.launchedAtFrame).not.toBeNull();
    // O corpo voa mais longe do que o braço alcança — abaixo disso o "mergulho" seria um estica.
    expect(trace.diveTravel).toBeGreaterThan(goalkeeperReachRadius(keeper));
    // E os pés se ajustaram no lugar: um passo, não uma corrida lateral até a bola.
    expect(trace.setDisplacement).toBeLessThan(GOALKEEPING.setStep + keeper.radius);
    expect(trace.diveTravel).toBeGreaterThan(trace.setDisplacement);
  });

  it("pula certo e ainda assim deixa a bola passar por dentro do alcance", () => {
    const state = createState(9);
    const keeper = goalkeeper(state);
    // Goleiro fraco, bola forte roçando a ponta do alcance: presenca nao e defesa.
    keeper.profile.skills.goalkeeping = 1;
    keeper.profile.skills.control = 1;
    keeper.profile.mental.anticipation = 1;
    keeper.profile.mental.decisionMaking = 1;
    keeper.profile.mental.composure = 1;
    armLaunchedAttempt(state, keeper, 108, 1.2, { yOffset: goalkeeperReachRadius(keeper) * 0.99 });

    updateBall(state, 0.05);

    expect(keeper.goalkeeperAttempt?.outcome).toBe("miss");
    expect(state.ball.lastTouchPlayerId).not.toBe(keeper.profile.id);
    expect(state.stats.blue.saves).toBe(0);
    expect(state.stats.blue.glancingTouches).toBe(0);
  });

  it("congela a direcao no salto e nao a corrige depois", () => {
    const state = createState();
    const keeper = fireShotAtGoal(state, FIELD.height / 2 + 10, 58, 1.3);
    makeElite(keeper);

    // Depois que ele decolar, a bola inverte a rota. O corpo nao acompanha.
    let flipped = false;
    const trace = traceSave(state, keeper, 240, () => {
      const attempt = keeper.goalkeeperAttempt;
      if (!flipped && attempt?.launchedAt !== null && attempt?.launchDirection) {
        state.ball.velocity = { x: state.ball.velocity.x, y: -state.ball.velocity.y };
        flipped = true;
      }
    });

    expect(trace.launchDirection).not.toBeNull();
    expect(flipped).toBe(true);
    const finalDirection = keeper.goalkeeperAttempt?.launchDirection;
    if (finalDirection) expect(finalDirection).toEqual(trace.launchDirection);
  });

  it("mergulha em desespero e nao alcanca um chute impossivel", () => {
    const state = createState();
    // Chute rasteiro no canto, disparado de perto: nao ha tempo de corpo para chegar la. Com o
    // gol nas medidas de um campo de verdade, o chute impossivel e o que sai no canto oposto ao
    // pe em que o goleiro esta — um canto qualquer, saindo do meio, ele alcanca.
    const keeper = fireShotAtGoal(state, FIELD.goalTop + 1.5, 104, 0.4, 20);
    keeper.position.y = FIELD.goalBottom - 1.5;
    makeElite(keeper);

    const trace = traceSave(state, keeper, 120);

    expect(trace.launchedAtFrame).not.toBeNull();
    expect(trace.outcome).not.toBe("catch");
    expect(state.stats.blue.saves).toBe(0);
  });
});

describe("resolucao do contato", () => {
  it("encaixa uma bola central dentro do alcance", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    armLaunchedAttempt(state, keeper, 42, 1.4);

    updateBall(state, 0.08);

    expect(state.ball.controllerId).toBe(keeper.profile.id);
    expect(keeper.goalkeeperAttempt?.outcome).toBe("catch");
    expect(state.stats.blue.catches).toBe(1);
    expect(state.stats.blue.saves).toBe(1);
    expect(state.events.at(-1)).toMatchObject({ type: "save-made", outcome: "catch", shotId: 1 });
  });

  it("rebate um chute forte e desperta a disputa da segunda bola", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    armLaunchedAttempt(state, keeper, 108, 1.4);

    updateBall(state, 0.05);

    expect(keeper.goalkeeperAttempt?.outcome).toBe("parry");
    expect(state.ball.controllerId).toBeNull();
    expect(state.stats.blue.parries).toBe(1);
    expect(state.cognitiveEvents.some((event) => event.type === "ballTrajectoryChanged" && event.shotId === 1)).toBe(true);
  });

  it("encaixa um cruzamento alto e resolve o passe como interceptado", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    armLaunchedAttempt(state, keeper, 38, 2.1, { source: "aerial" });
    state.pendingPass = {
      id: 1, passerId: "maya-fw", receiverId: "maya-mf", team: "coral", startedAt: 0,
      trajectory: "air", range: "long", targeting: "space", purpose: "cross", selectionReason: "progressivePass",
      target: { ...state.ball.position }, landingPoint: { ...state.ball.position }, expectedArrivalAt: 0.2,
      receiverEta: 0.3, opponentEta: 0.2, expectedHeight: 2.1, expectedSpeed: 38,
    };

    updateBall(state, 0.08);

    expect(state.ball.controllerId).toBe(keeper.profile.id);
    expect(state.pendingPass).toBeNull();
    expect(state.stats.blue.highBallClaims).toBe(1);
    expect(state.stats.blue.saves).toBe(0);
  });

  it("soca um cruzamento disputado sem adquirir posse", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    const attempt = armLaunchedAttempt(state, keeper, 76, 2.7, { source: "aerial" });
    attempt.action = "punch";
    state.pendingPass = {
      id: 1, passerId: "maya-fw", receiverId: "maya-mf", team: "coral", startedAt: 0,
      trajectory: "air", range: "long", targeting: "space", purpose: "cross", selectionReason: "progressivePass",
      target: { ...state.ball.position }, landingPoint: { ...state.ball.position }, expectedArrivalAt: 0.2,
      receiverEta: 0.3, opponentEta: 0.2, expectedHeight: 2.7, expectedSpeed: 76,
    };

    updateBall(state, 0.08);

    expect(state.ball.controllerId).toBeNull();
    expect(keeper.goalkeeperAttempt?.outcome).toBe("parry");
    expect(state.stats.blue.punches).toBe(1);
    expect(state.cognitiveEvents.some((event) => event.type === "ballTrajectoryChanged" && event.passId === 1)).toBe(true);
  });

  it("produz raspao na borda do alcance sem virar defesa", () => {
    const state = createState(9);
    const keeper = goalkeeper(state);
    keeper.profile.skills.goalkeeping = 1;
    keeper.profile.skills.control = 1;
    keeper.profile.mental.anticipation = 1;
    keeper.profile.mental.decisionMaking = 1;
    keeper.profile.mental.composure = 1;
    const keeperReach = goalkeeperReachRadius(keeper);
    // Dentro do alcance, mas longe do centro: a mão chega e nao segura. Na PONTA do alcance ele
    // ja nem toca — isso e o teste do lance que passa por dentro, logo abaixo.
    armLaunchedAttempt(state, keeper, 108, 1.2, { yOffset: keeperReach * 0.7 });

    updateBall(state, 0.05);

    expect(keeper.goalkeeperAttempt?.outcome).toBe("glance");
    expect(state.stats.blue.glancingTouches).toBe(1);
    expect(state.stats.blue.saves).toBe(0);
    expect(state.activeShot?.goalkeeperTouched).toBe(true);
  });

  it("nao toca a bola fora do alcance do corpo", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    armLaunchedAttempt(state, keeper, 55, 1.2, { yOffset: goalkeeperReachRadius(keeper) + 2.5 });

    updateBall(state, 0.05);

    expect(keeper.goalkeeperAttempt?.outcome).toBeNull();
    expect(state.stats.blue.saves).toBe(0);
  });

  it("nao alcanca uma bola acima do salto nem usa as maos fora da area", () => {
    const high = createState();
    const highKeeper = goalkeeper(high);
    makeElite(highKeeper);
    // Sem impulso vertical, o alcance para no standingReach.
    armLaunchedAttempt(high, highKeeper, 55, GOALKEEPING.standingReach + 1.4);
    updateBall(high, 0.05);
    expect(highKeeper.goalkeeperAttempt?.outcome).toBeNull();
    expect(high.stats.blue.saves).toBe(0);

    const outside = createState();
    const outsideKeeper = goalkeeper(outside);
    makeElite(outsideKeeper);
    armLaunchedAttempt(outside, outsideKeeper, 55, 1.2);
    outsideKeeper.position.x = FIELD.penaltyDepth + 8;
    outside.ball.position.x = outsideKeeper.position.x + 4;
    updateBall(outside, 0.05);
    expect(outside.stats.blue.saves).toBe(0);
  });

  it("alcanca a bola alta quando o salto foi carregado com impulso vertical", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    const vertical = 4.2;
    const apex = vertical * vertical / (2 * GOALKEEPING.jumpGravity);
    const height = GOALKEEPING.standingReach + apex * 0.8;
    armLaunchedAttempt(state, keeper, 44, height, { vertical });
    // No apice do salto o corpo ja subiu o suficiente para cobrir essa altura.
    state.elapsed = vertical / GOALKEEPING.jumpGravity;

    updateBall(state, 0.05);

    expect(keeper.goalkeeperAttempt?.outcome).not.toBeNull();
    expect(keeper.goalkeeperAttempt?.outcome).not.toBe("miss");
  });
});

describe("ciclo de vida da tentativa", () => {
  it("nao inicia uma segunda tentativa enquanto se recupera", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    armLaunchedAttempt(state, keeper, 60, 1.2);
    keeper.goalkeeperAttempt!.outcome = "parry";
    keeper.goalkeeperAttempt!.resolvedAt = state.elapsed;
    keeper.goalkeeperRecoveryUntil = state.elapsed + 0.8;
    const original = keeper.goalkeeperAttempt;

    updateGoalkeeperAnticipation(state);

    expect(keeper.goalkeeperAttempt).toBe(original);
  });
});

describe("geometria do mergulho", () => {
  it("dimensiona o mergulho para alcancar o canto e se compromete a tempo", () => {
    const state = createState();
    // Chute a meia altura no canto (dentro da trave): exige mergulho de verdade, mas alcancavel.
    const keeper = fireShotAtGoal(state, FIELD.goalBottom - 1.5, 46, 1.1, 38);
    makeElite(keeper);

    let launchSpeedAtTakeoff = 0;
    const trace = traceSave(state, keeper, 200, () => {
      const attempt = keeper.goalkeeperAttempt;
      if (launchSpeedAtTakeoff === 0 && attempt?.launchedAt != null) launchSpeedAtTakeoff = attempt.launchSpeed;
    });

    expect(trace.launchedAtFrame).not.toBeNull();
    // Ele chega ao ponto sem precisar do lance de desespero, e o corpo se projeta (impulso > 0).
    expect(trace.desperate).toBe(false);
    expect(launchSpeedAtTakeoff).toBeGreaterThan(0);
    expect(trace.outcome).not.toBeNull();
    expect(trace.outcome).not.toBe("miss");
  });
});

describe("bola solta na area", () => {
  it("sai para recolher uma bola solta perigosa mesmo sem ser chute a gol", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    keeper.position = { x: 10, y: FIELD.height / 2 };
    state.activeShot = null;
    state.pendingPass = null;
    // Bola lenta parada na area, longe do alcance de braco: precisa sair.
    state.ball.controllerId = null;
    state.ball.position = { x: 16, y: FIELD.height / 2 + 6 };
    state.ball.velocity = { x: -2, y: 1 };
    state.ball.height = 0;
    state.ball.verticalVelocity = 0;
    // Um adversario ameaca a bola, mas mais longe que o goleiro.
    const attacker = state.players.find((player) => player.team === "coral" && player.profile.position !== "goalkeeper")!;
    attacker.position = { x: 28, y: FIELD.height / 2 + 9 };

    updateGoalkeeperAnticipation(state);
    expect(keeper.goalkeeperAttempt?.source).toBe("loose");
  });

  it("ignora bola solta inofensiva sem adversario por perto", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    keeper.position = { x: 10, y: FIELD.height / 2 };
    state.activeShot = null;
    state.pendingPass = null;
    state.ball.controllerId = null;
    state.ball.position = { x: 16, y: FIELD.height / 2 + 6 };
    state.ball.velocity = { x: -2, y: 1 };
    state.ball.height = 0;
    // Afasta todos os adversarios: ninguem ameaca, o goleiro segura a linha.
    for (const player of state.players.filter((entry) => entry.team === "coral")) {
      player.position = { x: FIELD.width - 20, y: FIELD.height / 2 };
    }

    updateGoalkeeperAnticipation(state);
    expect(keeper.goalkeeperAttempt).toBeNull();
  });
});

describe("posicao de guarda", () => {
  /** Distancia do ponto ao segmento gol→bola: zero significa "na bissetriz do angulo bola–postes". */
  const gapToBisector = (point: Vec2, goal: Vec2, ball: Vec2): number => {
    const segment = { x: ball.x - goal.x, y: ball.y - goal.y };
    const squared = segment.x * segment.x + segment.y * segment.y;
    const amount = squared < 0.001 ? 0
      : Math.max(0, Math.min(1, ((point.x - goal.x) * segment.x + (point.y - goal.y) * segment.y) / squared));
    return Math.hypot(point.x - (goal.x + segment.x * amount), point.y - (goal.y + segment.y * amount));
  };

  it("fica entre a bola e o gol em vez de sair atras dela", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    // Bola parada aberta dentro da area, com o campo limpo: o cenario em que o goleiro virava o
    // pressionador natural (era o mais perto) e saia do gol atras dela, tomando gol pelas costas.
    for (const player of state.players) {
      if (player === keeper) continue;
      player.position = { x: FIELD.width - 6, y: FIELD.height / 2 };
      player.kickCooldown = 9;
    }
    state.activeShot = null;
    state.pendingPass = null;
    state.ball.controllerId = null;
    state.ball.dribbleOwnerId = null;
    state.ball.position = { x: 26, y: FIELD.goalBottom + 10 };
    state.ball.velocity = { x: 0, y: 0 };
    state.ball.height = 0;

    const goal = { x: 0, y: FIELD.height / 2 };
    // Um segundo e meio para ele deixar a ancora da formacao e assumir a posicao; o que se mede
    // e o regime, nao a caminhada ate ele.
    for (let frame = 0; frame < 180; frame += 1) stepMatch(state, FIXED_STEP);
    let worstAdvance = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      stepMatch(state, FIXED_STEP);
      worstAdvance = Math.max(worstAdvance, distance(keeper.position, goal) / distance(state.ball.position, goal));
    }

    // Nunca avancou para perto da bola: a profundidade e uma fracao do caminho, sempre.
    expect(worstAdvance).toBeLessThan(0.4);
    // E parou na bissetriz, nao no meio do gol nem em cima da bola.
    expect(gapToBisector(keeper.position, goal, state.ball.position)).toBeLessThan(keeper.radius);
  });
});

describe("bola aerea na area", () => {
  it("reivindica bola alta que nao e cruzamento, mesmo saindo atras do adversario", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    keeper.position = { x: 10, y: FIELD.height / 2 };
    keeper.velocity = { x: 0, y: 0 };
    state.activeShot = null;
    // Sobra no ar caindo na area, sem passe pendente e sem rotulo de cruzamento: um afastamento,
    // um lancamento, um desvio. A mao vence o pe, entao a bola e dele.
    state.pendingPass = null;
    state.ball.controllerId = null;
    state.ball.dribbleOwnerId = null;
    state.ball.position = { x: 20, y: FIELD.height / 2 + 1 };
    state.ball.velocity = { x: -3, y: 0 };
    state.ball.height = 2.5;
    state.ball.verticalVelocity = 1;
    state.ball.lastTouch = "coral";
    // Adversario MAIS PERTO da bola que o goleiro: com o pe ele chegaria antes; com a mao, nao.
    const attacker = state.players.find((player) => player.team === "coral" && player.profile.position !== "goalkeeper")!;
    attacker.position = { x: 26, y: FIELD.height / 2 + 3 };

    updateGoalkeeperAnticipation(state);

    expect(keeper.goalkeeperAttempt?.source).toBe("aerial");
  });
});

describe("posse segura nas maos", () => {
  it("agarra, entra em posse segura e fica imune a desarme", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    armLaunchedAttempt(state, keeper, 40, 1.3);

    updateBall(state, 0.06);
    expect(keeper.goalkeeperAttempt?.outcome).toBe("catch");
    expect(state.ball.controllerId).toBe(keeper.profile.id);
    expect(keeper.goalkeeperHoldUntil).toBeGreaterThan(state.elapsed);

    // Um adversario colado tenta o desarme repetidas vezes e nunca tira a bola das maos.
    const attacker = state.players.find((player) => player.team === "coral" && player.profile.position !== "goalkeeper")!;
    attacker.profile.skills.defending = 100;
    attacker.position = { x: keeper.position.x + 3, y: keeper.position.y };
    attacker.reactionTimer = 0;
    for (let i = 0; i < 30; i += 1) updatePossession(state, FIXED_STEP);
    expect(state.ball.controllerId).toBe(keeper.profile.id);
  });

  it("nao e empurrado para dentro da propria meta com a bola nas maos", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    keeper.position = { x: 4.2, y: FIELD.height / 2 };
    keeper.facing = { x: -1, y: 0 };
    state.ball.controllerId = keeper.profile.id;
    state.ball.position = { ...keeper.position };
    state.ball.velocity = { x: 0, y: 0 };
    state.ball.height = 0;
    state.ball.lastTouch = "blue";
    state.ball.lastTouchPlayerId = keeper.profile.id;
    keeper.goalkeeperHoldUntil = state.elapsed + 2.4;
    // Dois pressionadores em cima. Antes isto empurrava o goleiro por cima da linha em ~1,4s.
    for (const [index, chaser] of state.players
      .filter((player) => player.team === "coral" && player.profile.position !== "goalkeeper")
      .slice(0, 2)
      .entries()) {
      chaser.position = { x: 12 + index, y: FIELD.height / 2 + index };
    }
    const startX = keeper.position.x;

    for (let frame = 0; frame < 240; frame += 1) stepMatch(state, FIXED_STEP);

    expect(state.stats.coral.goals).toBe(0);
    expect(keeper.position.x).toBeGreaterThan(startX - keeper.radius);
  });

  it("sai da linha e distribui dentro da janela da Regra 12", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    keeper.position = { x: 5, y: FIELD.height / 2 };
    state.ball.controllerId = keeper.profile.id;
    state.ball.position = { ...keeper.position };
    state.ball.velocity = { x: 0, y: 0 };
    state.ball.controlStartedAt = state.elapsed;
    state.ball.lastTouch = "blue";
    state.ball.lastTouchPlayerId = keeper.profile.id;
    keeper.goalkeeperHoldUntil = state.elapsed + GOALKEEPING.maximumHoldSeconds;
    const presser = state.players.find((player) => player.team === "coral" && player.profile.position !== "goalkeeper")!;
    presser.position = { x: 9, y: FIELD.height / 2 };
    const startX = keeper.position.x;

    let releasedAt: number | null = null;
    for (let frame = 0; frame < GOALKEEPING.maximumHoldSeconds * 120 && releasedAt === null; frame += 1) {
      stepMatch(state, FIXED_STEP);
      if (state.ball.controllerId === null) releasedAt = state.elapsed;
    }

    // Soltou dentro da janela, depois do tempo de acomodar a bola, e nunca para o marcador.
    expect(releasedAt).not.toBeNull();
    expect(releasedAt!).toBeGreaterThan(GOALKEEPING.minimumHoldSeconds);
    // E soltou porque ACHOU uma saída, não porque a janela estourou. Sem este teto o teste passava com
    // o goleiro segurando a bola até o fim — foi assim que ele deixou passar um `releaseStandard` que
    // ficara na escala antiga quando a nota do passe virou probabilidade de gol, e o goleiro parou de
    // distribuir por completo sem que a suíte reclamasse.
    expect(releasedAt!).toBeLessThan(GOALKEEPING.maximumHoldSeconds * 0.6);
    expect(state.ball.lastTouchPlayerId).toBe(keeper.profile.id);
    // E saiu de perto da própria linha em vez de distribuir de dentro do gol.
    expect(keeper.position.x).toBeGreaterThan(startX + keeper.radius);
  });
});

describe("alerta apos o rebote", () => {
  it("entra em alerta depois de espalmar a bola", () => {
    const state = createState();
    const keeper = goalkeeper(state);
    makeElite(keeper);
    armLaunchedAttempt(state, keeper, 108, 1.4);

    updateBall(state, 0.05);

    expect(keeper.goalkeeperAttempt?.outcome).toBe("parry");
    expect(keeper.goalkeeperAlertUntil).toBeGreaterThan(state.elapsed);
  });
});
