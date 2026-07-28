// Deterministic match rules. Keep these values independent from presentation settings.

/**
 * O gramado tem as medidas oficiais de um campo internacional (IFAB/FIFA), convertidas por um
 * único fator. O gramado fica dentro da faixa que a Regra 1 permite para partida internacional
 * (100–110 m de comprimento por 64–75 m de largura); as marcações são as fixas do regulamento:
 * pequena área de 18,32 × 5,5 m, grande área de 40,32 × 16,5 m, marca do pênalti a 11 m e
 * círculo central de 9,15 m de raio.
 *
 * Derivar tudo de `meters` é o que garante que o desenho na tela tenha as proporções de um
 * campo de verdade. Antes cada medida tinha sua própria escala inventada e o resultado não
 * fechava: o gol saía com a largura da pequena área e o círculo central cabia dentro dela.
 *
 * A única medida que foge do oficial é a boca do gol, mais larga que os 7,32 m: os corpos em
 * campo são desenhados bem maiores que uma pessoa real, então um gol na medida exata seria
 * coberto quase inteiro pelo goleiro parado. É knob de jogabilidade, não erro de escala.
 *
 * O eixo vertical (altura da bola, alcance do goleiro) NÃO usa esta escala — ele tem a própria
 * calibragem, herdada e presa a `goalHeight`. Mexer nele é outra conversa.
 */
const UNITS_PER_METER = 2.4;
const meters = (value: number): number => value * UNITS_PER_METER;

const fieldWidth = meters(105);
const fieldHeight = meters(64);
const goalOpening = meters(8.32);

export const FIELD = {
  unitsPerMeter: UNITS_PER_METER,
  width: fieldWidth,
  height: fieldHeight,
  goalTop: (fieldHeight - goalOpening) / 2,
  goalBottom: (fieldHeight + goalOpening) / 2,
  /** Profundidade da rede atrás da linha do gol. */
  goalDepth: meters(2),
  goalHeight: 4.8,
  /**
   * Raio da secção dos postes e do travessão (Regra 1: 12 cm de espessura). A boca do gol é
   * medida pelas bordas INTERNAS da madeira, então `goalTop`, `goalBottom` e `goalHeight` são
   * essas bordas e os eixos ficam um raio para fora delas. Fino de propósito: o que se sente em
   * campo é a soma com o raio da bola, e é ela que decide entre entrar, bater e sair.
   */
  postRadius: meters(0.06),
  penaltyDepth: meters(16.5),
  penaltyWidth: meters(40.32),
  goalAreaDepth: meters(5.5),
  goalAreaWidth: meters(18.32),
  penaltySpotDistance: meters(11),
  /** Mesmo raio do círculo central e da meia-lua da grande área. */
  centerCircleRadius: meters(9.15),
  cornerArcRadius: meters(1),
  // Faixa de segurança fora das linhas (~5% da largura do campo): é onde o cobrador do lateral e
  // do escanteio fica, do lado de fora, como no futebol de verdade. Jogadores podem pisá-la.
  runOff: fieldHeight * 0.05,
  // Corpo e bola ficam ~2× maiores que na vida real (1,25 m de largura, bola de 42 cm) para
  // seguirem legíveis no zoom em que o campo inteiro cabe na tela. Os dois crescem junto, então
  // a bola continua um terço do jogador, como no futebol de verdade.
  playerRadius: 1.5,
  ballRadius: 0.5,
} as const;

export const PHYSICS = {
  playerDrag: 2.35,
  ballDrag: 0.72,
  airBallDrag: 0.16,
  ballBounce: 0.38,
  // A madeira é rígida: devolve muito mais da bola que o gramado, que afunda e absorve.
  goalFrameRestitution: 0.7,
  landingFriction: 0.86,
  ballPlayerRestitution: 0.42,
  gravity: 29,
  controlSpring: 14,
  controlledBallRepositionSpeed: 10,
  firstTouchSettleTime: 0.055,
  feintControlSettleTime: 0.28,
  controlAttemptCooldown: 0.2,
  heavyTouchCooldown: 0.32,
  passiveCollisionRadiusFactor: 0.78,
  playerBounce: 0.25,
  kickDistance: 4.15,
  // Até que altura um jogador de linha ainda alcança a bola — de cabeça, no alto do salto. É o
  // teto do domínio e da leitura da corrida: acima dele a bola passa por cima de todo mundo e
  // não há disputa nenhuma. Toda altura de contato sai daqui em fração (ver `CONTACT_BAND`),
  // então este é o único número a mexer para subir ou baixar o jogo aéreo inteiro.
  //
  // O teto é `GOALKEEPING.standingReach` (2,85): quem joga com a cabeça não pode alcançar mais
  // alto que o goleiro de mãos erguidas, senão o cruzamento deixa de ser da área do goleiro.
  //
  // Subir daqui foi MEDIDO e não compensa: a 2,6 o acerto de passe cai (0,44 → 0,40) e a
  // interceptação sobe (0,42 → 0,46). Alcançar mais alto é um ganho simétrico, e quem tira
  // proveito dele são os onze marcadores, não o recebedor — a bola alta vira disputa de todos
  // em vez de entrega para um. Reabrir só se a bola aérea deixar de ser a exceção que é hoje.
  reachableBallHeight: 2.4,
  kickCooldown: 0.42,
  maxBallSpeed: 108,
  // Velocidade que a perna imprime numa bola ERGUIDA. É o teto de força do lançamento, e é ele
  // que decide se o passe aéreo sai rasante ou em parábola: a altura vem do corpo a transpor
  // (ver `pass-trajectory`), e a distância, do que sobra de velocidade. Sem este teto o motor
  // resolvia um lançamento de 38 m como um foguete rasante a 94 u/s — quase o dobro do que
  // qualquer recepção amortece. Está na base da escala do chute (`lerp(54, 92, power)`): um
  // passe erguido é batido como a mais suave das finalizações.
  aerialPassLaunchSpeed: 56,
  walkSpeedFactor: 0.62,
  controlledSpeedFactor: 0.68,
  runSpeedFactor: 1.32,
  burstSpeedFactor: 2.05,
  burstAccelerationFactor: 2.25,
  burstDuration: 0.78,
  burstCooldown: 2.1,
  feintReactionDuration: 0.7,
  feintEvasionDuration: 0.72,
  ballCarryTurnRate: 20,
  ballActionAlignment: 0.64,
} as const;

// Duas barras de estamina. A longa (fôlego) só decai na partida e termina entre 50%–60%
// para um atleta médio; a volátil (piques) drena em disparada e recupera em ~10s parado.
// Custos são por unidade de distância percorrida, então "atravessar o campo" tem preço fixo.
/**
 * Corrida de referência para calibrar a estamina: gol a gol, descontando o espaço atrás de
 * cada linha de fundo, onde ninguém dispara. Tudo que mede desgaste por distância se apoia
 * nela, de forma que redimensionar o gramado não mude o custo de atravessar o campo.
 */
export const GOAL_TO_GOAL_SPRINT = fieldWidth - 10;

// Fração da barra volátil consumida numa travessia gol a gol, por ritmo. São estes os
// números de game design; o custo por unidade percorrida sai deles.
//
// Passar de 1 é intencional: a barra cheia banca pouco mais de um terço do campo em disparada
// contínua, e o trote também cobra — recupera-se de verdade parando, não trotando. Com os
// valores antigos (0,7 e 0,18 contra 0,22/s de recarga) o ciclo pique/espera era lucrativo e a
// barra vivia grudada no topo: disparar não custava decisão nenhuma.
const VOLATILE_BURST_PER_CROSSING = 2;
const VOLATILE_RUN_PER_CROSSING = 0.6;

export const STAMINA = {
  // --- Volátil (piques/explosões) ---
  // Derivado do campo: uma travessia gol a gol custa sempre a mesma fatia da barra, tenha o
  // gramado a medida do 5x5 ou a do 11x11. Antes o custo era fixo por unidade e crescer o
  // campo encarecia cada corrida sem ninguém perceber.
  volatileBurstCostPerUnit: VOLATILE_BURST_PER_CROSSING / GOAL_TO_GOAL_SPRINT,
  volatileRunCostPerUnit: VOLATILE_RUN_PER_CROSSING / GOAL_TO_GOAL_SPRINT,
  // Do zero ao cheio em ~10s parado; trotando leva bem mais, porque a corrida cobra por cima.
  volatileRecoveryPerSecond: 0.10,
  // --- Longa (fôlego de partida): só decai ---
  longBurstCostPerUnit: 0.00040,
  longRunCostPerUnit: 0.00022,
  longWalkCostPerUnit: 0.00010,
  longIdleCostPerSecond: 0.00092,
  longFloor: 0.2,
  // Escala do desgaste longo, DERIVADA da duração da partida (ver `longDrainScale` em
  // movement-system). Era um knob manual que precisava ser reajustado à mão a cada mudança de
  // regime — e que amarrava a calibragem à partida de dez minutos: os custos abaixo são por
  // segundo em campo e por unidade percorrida, e ambos crescem com a duração, então uma partida
  // de noventa minutos punha todo mundo no piso só de estar em pé. Um multiplicador único
  // devolve o mesmo fim de partida em qualquer duração, como GOAL_TO_GOAL_SPRINT já fez com o
  // tamanho do campo. O número é o que a calibragem mediu em REFERENCE_COMPRESSION (ver rules).
  longDrainAtReference: 0.193,
  // --- Interação longa → volátil (penalidade modesta) ---
  // Custo da volátil ×(1 + (1-longa)·slope); recarga ×(1 - (1-longa)·slope).
  fatigueVolatileCostSlope: 0.5,
  fatigueVolatileRecoverySlope: 0.35,
  // Queda sutil de velocidade de topo com o cansaço: vel ×(1 - (1-longa)·slope) → ~5% a 50%.
  fatigueSpeedSlope: 0.1,
  // Recuperação da volátil concedida a cada bola parada (a longa não recupera).
  volatileDeadBallRecovery: 0.34,
} as const;

export const FIXED_STEP = 1 / 120;

// Regra 7: a partida é dividida em tempos iguais. Cada um começa com uma saída de bola do
// círculo central, e a saída do segundo tempo é do time que NÃO cobrou a do primeiro.
// O relógio não zera no intervalo: ele corre de 0 a MATCH_DURATION, como no futebol de verdade.
export const MATCH_HALVES = 2;
// Vinte minutos de relógio, por medição em duas frentes. De um lado o custo: a 82 us por tick uma
// temporada de 380 partidas de vinte minutos custa pouco mais de uma hora de CPU, contra nove
// horas se fossem de noventa — o teto está registrado em rules.ts e em docs/architecture.md. Do
// outro o placar: em dez minutos o motor produzia 0,8 gol e 11 finalizações por partida, que não é
// futebol e não faz tabela de liga; em vinte ele produz 3,4 gols e 24 finalizações, que é.
export const HALF_DURATION = 10 * 60;
export const MATCH_DURATION = HALF_DURATION * MATCH_HALVES;
export const DEFAULT_MATCH_SEED = 0x4a39b70d;

// Bola parada: o cobrador CAMINHA até a bola em vez de teleportar. `min`/`maxSetupSeconds` dão o
// ritmo (curto) e a trava anti-deadlock; o resto é geometria dos pontos de cobrança. A bola só
// entra em jogo quando o cobrador chega (raio de chegada) E passou o tempo mínimo de preparo.
export const RESTART = {
  // Piso do preparo: mesmo com o cobrador já no ponto, a cobrança espera este tempo (ritmo curto).
  minSetupSeconds: 2,
  // Teto absoluto: se o reposicionamento não concluiu (ou o cobrador está cercado), cobra assim
  // mesmo. Generoso o bastante para os dois times voltarem à formação na saída de bola.
  maxSetupSeconds: 7,
  arrivalRadius: FIELD.playerRadius + FIELD.ballRadius + 0.6,
  // Distância a que o cobrador para atrás da bola (a bola fica no ponto; ele, um passo atrás). Vale
  // para os seis reinícios: no lateral/escanteio isso já o deixa na linha/junto do arco, sem knob.
  takerStandOffset: FIELD.playerRadius + FIELD.ballRadius + 0.15,
  // Lei 17: a bola fica DENTRO do arco de escanteio — é a marcação desenhada no gramado. O centro
  // vai sobre a diagonal da quina, a um raio de bola da borda do arco: bola inteira dentro do
  // arco e inteira dentro do campo, sem depender de nenhuma folga inventada.
  cornerBallInset: (FIELD.cornerArcRadius - FIELD.ballRadius) / Math.SQRT2,
  // A bola do lateral entra um passo para DENTRO da linha (não exatamente sobre ela): posta na
  // borda, o ruído angular do chute a empurrava para fora já nos primeiros ticks e o jogo
  // reentendia como nova saída. Um passo para dentro dá a margem que a detecção de limite exige.
  throwInBallInset: FIELD.ballRadius + 1.5,
  fieldMarginFactor: 0.55,
  fieldMarginFloor: 8,
  // --- Distância que o adversário respeita até a bola entrar em jogo ---
  // Leis 8, 13 e 17 usam a MESMA medida (9,15 m) para o círculo central, o tiro livre e o
  // escanteio — é o raio do círculo central, e por isso sai dele em vez de virar outro número.
  opponentDistance: FIELD.centerCircleRadius,
  // Lei 15: no lateral são 2 m do ponto do arremesso.
  throwInOpponentDistance: meters(2),
  // Folga além da linha da área no tiro de meta (Lei 16): o corpo inteiro fica fora dela.
  boxClearanceMargin: FIELD.playerRadius,
  // Colocação (TeamShapePlacement) do tiro de meta. Quem cobra arma a saída com a zaga aberta
  // junto da área (o companheiro PODE receber dentro dela desde 2019); quem defende pressiona a
  // borda — e a zona de exclusão o mantém fora da área sem coreografia nenhuma.
  goalKickBuildUpLineHeight: 10,
  goalKickBuildUpWidth: 0.85,
  goalKickPressLineHeight: 48,
  goalKickPressForwardLimit: 80,
  goalKickWidth: 0.7,
  // Escanteio: atacantes ocupam a área (forwardLimit alto), defensores comprimem no próprio gol.
  cornerAttackForwardLimit: 92,
  cornerDefendLineHeight: 8,
} as const;

// Acréscimos (Regra 7 estendida): o tempo de bola morta vira tempo adicional, e o tempo/jogo só
// termina após o lance concluir. `maxAddedTime` limita o placar; `graceCeiling` é o teto absoluto
// além do nominal — passou disso, apita seja como for (garante o término).
export const STOPPAGE = {
  accrualFactor: 1,
  maxAddedTime: 30,
  graceCeiling: 45,
} as const;

export const TACTICS = {
  counterAttackWindow: 4.5,
  counterPressWindow: 3.2,
  recoveryWindow: 7,
  finalThirdStart: 0.68,
  buildUpEnd: 0.34,
  collectivePlanSeconds: 2.2,
  predictionMinSeconds: 0.5,
  predictionMaxSeconds: 1.8,
  // Tempo que o portador leva acomodando a bola antes de considerar entregá-la. É o relógio da
  // circulação: abaixo dele o jogador conduz mesmo que exista um passe melhor.
  carrierSettleSeconds: 0.72,
  // Fim de jogo: a partir de que FRAÇÃO da partida o placar manda no bloco defensivo. Eram 120 s e
  // 150 s cravados, calibrados na partida de dez minutos — as duas frações reproduzem exatamente
  // esses números lá e acompanham a duração em qualquer outra.
  protectLeadShare: 0.2,
  chaseGameShare: 0.25,
} as const;

/**
 * Viés que o plano tático aplica sobre o motor. Cada eixo de `TacticalMentality` entra em **um
 * único ponto**, e o valor aqui é o quanto o extremo (0 ou 100) desloca esse ponto. O neutro (50)
 * vale exatamente zero — é o que faz um plano neutro reproduzir a partida que o motor já produzia
 * sozinho, e o que o teste de caracterização verifica.
 */
export const MENTALITY = {
  /** `defensiveLine`: pontos de profundidade (%) somados à altura da linha mais recuada. */
  lineHeight: 14,
  /** `width`: fração da altura do campo somada à abertura da forma. */
  teamWidth: 0.16,
  /** `pressing`: até que altura do campo o segundo homem ainda sai da linha para dividir. */
  pressDangerZone: 0.22,
  /** `risk`: apetite somado ao risco que personalidade e placar já produzem. */
  risk: 0.25,
  /** `tempo`: fração de `TACTICS.carrierSettleSeconds` descontada do tempo de acomodação. */
  tempo: 0.5,
} as const;

/**
 * Apetite da decisão individual: quanto cada saída vale na comparação que o portador faz, e quanto
 * o time valoriza servir cada dever e cada tipo de bola. É a superfície de **estilo** do motor —
 * mexer aqui muda como o jogo joga, sem tocar em regra nem em física.
 *
 * O critério do que mora aqui: vem para cá o coeficiente que um ajuste de estilo mexeria ("o time
 * chuta pouco de fora", "cruza demais", "devolve a bola cedo"); fica na fórmula o que é forma da
 * conta — limite de clamp que só mantém o termo na faixa, denominador de decaimento por ordem e
 * geometria. É a mesma divisão que DUEL e GOALKEEPING já fazem com os sistemas deles.
 *
 * As referências em "percentual de campo" são a distância em que o termo vale 1.
 */
export const DECISION = {
  /** Instrução individual do treinador. `normal` vale zero: o padrão não mexe em nada. */
  freedomAppetite: { rarely: -0.4, normal: 0, often: 0.4 },

  /** A comparação de topo do portador: chutar, passar ou levar. */
  carrier: {
    // Chance clara de gol domina qualquer alternativa — só um passe claramente melhor a supera.
    clearChanceBonus: 1.45,
    clearChancePassEdge: 0.18,
    // Quanto o passe precisa superar a condução para o portador entregá-la. Sob pressão a régua é
    // baixa (segurar custa caro); em espaço livre ele leva a bola.
    passAdvantageUnderPressure: 0.08,
    passAdvantageInSpace: 0.38,
    // Peso da política aprendida de cada saída (ver PlayerPolicy).
    passPolicyWeight: 0.52,
    dribblePolicyWeight: 0.62,
    passUnderPressure: 0.58,
    passFromEdge: 0.62,
    dribbleSpaceReference: 15,
    dribbleFromEdge: 0.55,
    breakBonus: 0.54,
    breakContinuation: 0.32,
    finalThirdUrgency: 0.22,
  },

  /**
   * A nota do passe: **o que a bola vale × a chance de ela chegar**, menos o que custa perdê-la.
   *
   * Antes era uma soma de valor MENOS uma soma de risco, e por isso um valor grande engolia
   * qualquer risco: o ótimo da fórmula era a bola longa para o vazio, que o motor jogava 88% das
   * vezes e completava 24%. Com o risco entrando como fator, e não como parcela, a bola de 24%
   * perde para a de 90% sem precisar de penalidade nenhuma — e as penalidades ad-hoc que
   * existiam para simular isso (pressão de linha, comprimento, desconto aéreo) saíram todas.
   *
   * O que mora aqui é só o VALOR: quanto vale receber em tal lugar, de tal jeito, servindo tal
   * dever. A chance de chegar é geometria e sai de `runtime/pass-viability`.
   */
  pass: {
    progressReference: 24,
    opennessReference: 14,
    /** Receber com espaço vale por si: dá o próximo lance. Não é mais o termo de risco que era. */
    space: 0.42,
    centrality: 0.18,
    wallPass: 0.64,
    /** Janela da tabela: por quanto tempo quem me passou a bola ainda é o parceiro da devolução. */
    wallPassWindow: 4.2,
    /**
     * O que custa entregar a bola. Cresce quanto mais perto do próprio gol ela se perde — perder
     * no ataque é um contra-ataque; perder na saída é um gol. É a única parcela que sobrou fora
     * da multiplicação, porque ela é o preço do fracasso, não um desconto no sucesso.
     */
    turnoverCost: 1.15,
    channelAffinity: 0.2,
    /** Repertório: bola de cada tipo vale o que o futebol paga por ela. */
    purpose: { cutback: 0.42, crossToFinisher: 0.32, cross: 0.14, throughBall: 0.28, layoff: 0.22 },
    /**
     * Servir o dever que o coletivo entregou. É por aqui que o time joga PARA quem foi encarregado
     * de atacar as costas da linha, em vez de para um id nomeado no plano.
     */
    duty: { runInBehind: 0.34, runInBehindRisk: 0.18, overlap: 0.2, support: 0.18, restDefense: 0.3 },
    /** Passar para quem já está impedido é jogar a posse fora: penalidade dura, não desconto. */
    offsidePenalty: 5,
  },
} as const;

export const POSSESSION = {
  confirmationSeconds: 0.32,
  looseBallGraceSeconds: 0.55,
  // Prazo para dominar a bola do passe depois que ela chega. Uma constante, e não quatro por
  // variante: o que muda de um passe para outro é quanto do voo a bola ficou ALTA demais para
  // alguém, e isso `expirePendingPass` soma por cima, lendo a trajetória de verdade.
  passControlSeconds: 0.6,
  phaseDebounceSeconds: 0.45,
  minimumPhaseSeconds: 0.75,
  finalThirdEnter: 0.68,
  finalThirdRearm: 0.58,
  finalThirdEntryCooldown: 7.5,
} as const;

export const COGNITION = {
  /**
   * De quanto em quanto tempo o quadro que os vinte e dois enxergam se refaz — a leitura da bola
   * e o contexto tático. NÃO é a taxa da física: o corpo se integra a 120 Hz, a percepção corre a
   * 30, como a amostragem espacial já corria na régua dela. Era a mesma pergunta respondida três
   * vezes por tick, e só ela custava um quinto do quadro.
   */
  perceptionSeconds: 1 / 30,
  teamTickSeconds: 0.15,
  fastestThinkSeconds: 0.14,
  slowestThinkSeconds: 0.32,
  planDuration: {
    passing: 0.25,
    shooting: 0.25,
    receiving: 0.7,
    firstTime: 0.28,
    breaking: 0.65,
    carrying: 0.45,
    sprinting: 0.45,
    knockingOn: 0.45,
    feinting: 0.45,
    pressing: 0.65,
    marking: 0.65,
    covering: 0.65,
    supporting: 0.85,
    goalkeeping: 0.5,
    preparingSave: 0.18,
    diving: 0.32,
    jumping: 0.32,
    claimingHighBall: 0.4,
    recoveringSave: 0.35,
    holdingBall: 0.3,
  },
} as const;

export const GOALKEEPING = {
  lowHeight: 0.35,
  mediumHeight: 1.8,
  highHeight: 3.8,
  // Reflexo do goleiro depois de ler o chute. Goleiro é reação rápida: mesmo o mais fraco
  // dispara em ~0,16s e o de elite em ~0,05s — nada de ficar "acordando" enquanto a bola passa.
  minimumReaction: 0.05,
  maximumReaction: 0.16,
  catchThreshold: 0.62,
  parryThreshold: 0.25,
  // O degrau mais baixo da escada do contato: abaixo disto ele não encosta na bola. Pular certo
  // não é garantia de tocar — na ponta do alcance, num chute forte, a bola passa por dentro do
  // raio sem mão nenhuma nela. Fica logo abaixo do `parryThreshold` porque é a mesma faixa de
  // contato marginal: medido, ela se divide em roçar (~3%) e passar limpo (~1%) com um goleiro
  // de elite, e passar limpo cresce depressa conforme o goleiro piora.
  touchThreshold: 0.06,
  catchRecovery: 0.56,
  diveRecovery: 0.92,
  maximumAttemptAge: 2.2,
  // Reach beyond the body, as a multiple of the keeper's own radius: one radius of arm.
  // Everything past that has to be earned by actually moving the body there.
  handReachFactor: 1,
  // Impulso do mergulho, em unidades por segundo. Não é dosado: mergulho é tudo ou nada, e o que
  // o braço alcança em pé sai sem impulso nenhum. Decai sob `diveDrag` e não se corrige no ar.
  // Este número sempre foi o teto do mergulho; agora é o mergulho. Medido na bateria de chutes:
  // o corpo percorre ~3,4 m nos cantos, contra ~1,9 m do impulso dosado antigo, e as taxas de
  // defesa por zona ficaram onde estavam — o goleiro defende o mesmo, mergulhando de verdade.
  diveLaunchSpeed: 31,
  diveDrag: 1.4,
  // Tempo de voo do mergulho, do impulso até o pouso, quando a bola está no alcance do corpo.
  jumpLaunchVertical: 5.6,
  // Gravidade durante o salto, em unidades de altura do gol.
  jumpGravity: 15.5,
  // Tempo de voo do salto, do impulso até o pouso, quando a bola está no alcance do corpo.
  groundedDiveTime: 0.42,
  // Alcance do goleiro em pé, do chão até a ponta dos dedos, em unidades de altura do gol.
  standingReach: 2.85,
  // How fast the keeper shuffles across the line while waiting for the launch window.
  approachSpeedFactor: 1.25,
  // Quanto ele ajusta os pés diante de um chute, a partir de onde leu a bola: um metro, um passo.
  // Tudo além disso é mergulho. Sem esta trava ele corria lateralmente até o ponto de contato e
  // chegava lá em pé — o salto virava o resíduo da corrida, e não existia na tela.
  setStep: meters(1),
  // If the window never opens, launch anyway this close to arrival and come up short.
  desperationLead: 0.07,
  // Upper bound on how far ahead the launch solver looks along the ball path.
  launchSearchStep: 0.02,
  // Margem de segurança do commit, em cima do tempo que o corpo leva para cobrir o vão. Pequena
  // de propósito: com impulso pleno, decolar cedo demais faz o corpo passar VOANDO por cima da
  // rota antes de a bola chegar. O mergulho é do tamanho que é; o que se acerta é a hora.
  commitLead: 0.04,

  // --- Posição de guarda (princípio da posição, não uma Lei) ---
  // O goleiro vive na bissetriz do ângulo bola–postes, que é o segmento da bola até o CENTRO do
  // gol: de lá os dois cantos ficam à mesma distância. A profundidade é uma fração do caminho
  // até a bola, e é o que fecha o ângulo quando ela chega e devolve o corpo para trás quando ela
  // se afasta — encobri-lo exige passar por cima e ainda cair sob o travessão.
  guardAdvanceFraction: 0.22,
  // Piso de avanço: nunca colado na linha, porque de dentro do gol não se joga o corpo.
  guardRestingDepth: meters(1.8),
  // --- Reivindicação: a única pergunta que faz o goleiro sair do gol ---
  // Bola solta rasteira é do pé: só sai quando ela está lenta, um adversário ameaça recolhê-la e
  // ele chega antes — senão segura a posição e deixa para a defesa.
  looseClaimMaxBallSpeed: 46,
  looseClaimBeatMargin: 1.4,
  looseClaimThreatRange: 16,
  // Bola alta na área é da mão: acima de `mediumHeight` a mão vence o pé de qualquer um, então
  // ele reivindica mesmo saindo ATRÁS do adversário mais próximo (margem invertida em relação à
  // rasteira) e sem precisar que alguém a ameace.
  aerialClaimBeatMargin: 4,
  // Passo da varredura que procura o ponto reivindicável na rota. Grosseiro de propósito: é
  // gatilho, não mira — a mira fina é do solver do mergulho (`launchSearchStep`).
  claimSearchStep: 0.06,
  // --- Bola nas mãos (Regra 12) ---
  // Ele acomoda a bola por `minimumHoldSeconds` antes de pensar em distribuir e tem até
  // `maximumHoldSeconds` para soltá-la. Entre as duas, a exigência para soltar decai de
  // `releaseStandard` a zero: no começo só uma saída boa o convence, no fim qualquer uma serve.
  // Estourada a janela ele perde a proteção e vira um portador comum — é a punição do jogo para
  // quem segurou demais, e dispensa um caso especial que o obrigue a chutar.
  //
  // `releaseStandard` é uma nota na escala do `choosePass`, calibrada por medição: com o campo
  // aberto o goleiro acha uma saída acima dela e joga logo; num quadro fechado ele espera. Acima
  // do dobro disto ele segura até a janela quase estourar, e aí o passe sai pior do que sairia
  // antes.
  //
  // Reaferido quando a nota do passe virou valor × probabilidade: a escala encolheu (o teto de
  // uma nota boa caiu de ~5 para ~2,5), e a régua antiga de 5 punha o goleiro segurando a bola
  // 3,3s em média em vez dos ~2s de antes. Este número só faz sentido junto da escala de
  // `DECISION.pass` — mexer numa exige remedir a outra.
  minimumHoldSeconds: 1.2,
  maximumHoldSeconds: 6,
  releaseStandard: 2.8,
  // Depois de espalmar/rebater, fica em alerta e se reposiciona em velocidade por este tempo.
  alertSeconds: 2.6,
  // Velocidade de reposicionamento durante o alerta (corrida, não a corridinha de ajuste).
  alertSpeedFactor: 1.85,
} as const;

// A corrida pela bola: "quem chega no próximo toque, e com que folga?". É a leitura de bola do
// motor (runtime/ball-situation), que substituiu o "quem tocou por último".
export const CONTEST = {
  // Até onde a rota da bola é varrida à procura do ponto de encontro. Mesma ordem do horizonte
  // de reivindicação do goleiro: além disso a previsão não vale o custo.
  horizonSeconds: 2.2,
  searchStep: 0.06,
  // Folga (s) do favorito abaixo da qual o lance está em aberto — e aí ele não é de ninguém.
  // Curta de propósito: uma bola realmente dividida é rara, e chamar de disputa toda vantagem
  // pequena deixa os dois times permanentemente desorganizados, correndo atrás de rebote.
  openMargin: 0.15,
  // Histerese: já em disputa, o lance só volta a ter dono com esta folga. Sem ela o estado
  // oscilaria a cada quadro numa corrida equilibrada, e o plano de todo mundo junto com ele.
  settleMargin: 0.3,
  // Quantos de cada time saem para a bola. Enquanto ela tem dono — no pé dele ou correndo à
  // frente dele — vai um só: o segundo homem cobre, não dobra, e dois em cima da mesma bola é
  // buraco atrás. Só a dividida de verdade justifica os dois; o terceiro já é o time se
  // desmanchando atrás de uma bola que dois já estão disputando.
  pressSlots: 1,
  contestSlots: 2,
  // Quanto a vontade de ir na bola (agressividade, intensidade, antecipação) adianta o jogador
  // na fila da disputa, em segundos. Substitui o mesmo apetite que antes era medido em metros.
  pressAppetite: 0.35,
} as const;

// Comportamento defensivo além do presser único. Frações são múltiplos de FIELD.width/height,
// resolvidas em quem consome (o config mantém o vocabulário absoluto do resto do motor).
export const DEFENSE = {
  // --- Item 1: segundo engajador na zona de perigo ---
  // Só quando a bola do adversário está no nosso terço defensivo (progresso 0 = nosso gol).
  dangerZoneProgress: 0.33,
  // O 1º presser precisa estar ao menos isto longe da bola (fração de width) para o portador
  // contar como "sem pressão real" — espelha o raio de pressão fieldX(7)/width = 0,07.
  secondPresserUnpressuredGap: 0.07,
  // Não puxar um zagueiro que esteja mais longe que isto (fração de width) do portador.
  secondPresserEngageRange: 0.16,
  // --- Item 4: recomposição garantida do zagueiro adiantado ---
  // Quão à frente do próprio anchor (fração de width) conta como "adiantado".
  recoverAdvancedGap: 0.07,
  // Janela após perder a posse em que a recomposição em disparada é garantida (só para a zaga).
  recoverWindow: 3.5,
  // Fora dessa janela, qualquer um recompõe em disparada desde que tenha pique sobrando.
  recoverMinEnergy: 0.35,
  // Teto de duração do pique de recomposição.
  recoverBurstMax: 1.6,
  // Risco mínimo do plano coletivo para liberar o lateral a sobrepor no ataque.
  overlapMinRisk: 0.5,
  // --- Marcação: zona com pega firme (ver runtime/marking) ---
  // Raio (fração de width) em que um adversário conta como "meu". Medido do corpo do defensor,
  // não da âncora ideal da célula: quem está deslocado responde por quem está perto dele.
  zoneRadius: 0.14,
  // Alcance (fração de width) em que o marcado ainda é uma ameaça — a distância de um PASSE, e
  // não a de uma corrida: quem está a trinta metros da bola se encontra com um toque só, e é
  // por isso que se marca de perto. Além dela vale o piso.
  tightenRange: 0.4,
  // Piso da firmeza: com a bola do outro lado do campo o defensor sustenta a zona e só observa
  // o vizinho. Zero seria ignorá-lo — que é o que o motor fazia.
  zoneTightness: 0.25,
} as const;

// Desfechos de contato (tabela resolveContact). Os gates de "roubo limpo" exigem momento real
// do defensor; sem eles o duelo cai no desfecho neutro (pokeLoose), idêntico ao histórico.
export const DUEL = {
  // --- Disputa contínua pela bola (o duelo é um processo, não um evento de um quadro). ---
  // Margem além dos dois corpos para alguém entrar na disputa. Mesma janela do contato antigo.
  engageMargin: 0.75,
  // Em quantas unidades além do encosto o desafiante deixa de alcançar a bola. É o alcance da
  // perna esticada: curto, porque desarme é coisa de pé na bola, não de estar por perto. É também
  // o que dá valor à proteção de bola — esconder a bola do outro lado do corpo aumenta esta
  // distância, e a pressão cai por geometria, sem precisar de termo próprio.
  reachFalloff: 3.2,
  // Velocidade (u/s) que um desafiante de força 1, com o pé na bola e ela escancarada, imprime.
  // É a régua da disputa: subir isto faz a bola sair mais rápido de todo mundo.
  pressureRate: 18,
  closingReference: 9, // pique de chegada (u/s) que já vale o bônus cheio
  closingWeight: 0.55, // quanto chegar em velocidade acrescenta à pressão
  // Quanto a mordida do desafiante afrouxa a mão do portador. É o que faz o desarme tirar o
  // domínio, e não só empurrar a bola — sem isto a mola de controle seria intransponível.
  contestGripBite: 2,
  gripFloor: 0.16,
  // Quem está perdendo a bola na dividida fica desequilibrado por um instante. É o que impede o
  // portador de reclamar a própria bola perdida no quadro seguinte — sem isso o desarme nunca sai.
  beatenKickCooldown: 0.38,
  beatenReaction: 0.24,
  // Trombada: entrar no corpo não empurra a bola em direção nenhuma, mas arrebenta o domínio —
  // é assim que se perde a bola sem que ninguém a tenha tocado. Vale menos que o pé na bola,
  // porque desarmar de verdade é chegar nela.
  chargeBite: 0.75,
  // Aceleração (u/s²) com que quem atropela empurra o portador para longe. Força que DURA, não um
  // tapa: quem entra por cima segue empurrando enquanto o corpo está lá.
  chargeShove: 34,
  chargeReaction: 0.3, // tempo em que o portador fica desequilibrado sob a trombada
  // --- Lei 12: entrada imprudente. Falta é chegar no corpo, não na bola. ---
  foulBodyGap: 0.4, // quão encostados os corpos precisam estar para ser uma entrada, não um roçar
  // Velocidade (u/s) contra o corpo do portador que caracteriza a entrada. Alta de propósito:
  // correr até um adversário a 7-10 u/s é marcação normal; falta é chegar em disparada.
  foulClosingSpeed: 15,
  foulBallReach: 0.35, // acima disto ele pegou na bola primeiro — não é falta, é desarme
  // Quanto a agressividade precisa superar a técnica defensiva para o jogador entrar mal. Positivo
  // porque a maioria dos duelos é limpa: falta é exceção, não a regra do contato.
  foulRestraint: 0.52,
  foulLatenessWeight: 0.3, // quanto chegar longe da bola conta como imprudência
  foulSpeedWeight: 0.25, // quanto passar da velocidade mínima conta
  // Lei 5 — vantagem: o quanto o portador precisa ser mais forte que quem entrou para aguentar o
  // tranco e seguir jogando. Positivo porque atropelar funciona: só quem leva vantagem física
  // clara fica de pé, e aí o árbitro engole o apito.
  rideChallengeEdge: 0.1,
  freezeSeconds: 0.9, // jogada parada enquanto o árbitro apita, antes do tiro livre
  // Balão baixo por cima da dividida (escolha do atacante, não desfecho do duelo).
  knockPastMinEnergy: 0.35, // energia volátil mínima para bancar a corrida atrás do balão
  knockPastProbe: 0.08, // até onde sondar espaço atrás do defensor (fração de width)
  knockPastMinSpace: 0.045, // espaço livre mínimo atrás (fração de width) para valer a pena
  knockPastSpeed: 26,
  knockPastLift: 7, // apex ≈ v²/(2·gravity) ≈ 0,85 < 1,8 → bola segue jogável
  // Finta/contato só engajam quando os corpos estão a um passo um do outro: distância <
  // (raio + raio + isto). Antes a finta disparava a ~18u (espaço vazio); hoje ~6,5u, que é o
  // 1x1 de verdade. É margem, não raio: quando os corpos encolheram para a escala métrica ela
  // subiu de 2 para 3,5 justamente para a janela do drible continuar a mesma em metros.
  feintEngageMargin: 3.5,
  // Defensor que tentou e não venceu: fica batido por um instante, não paralisado. Eram 0,92s —
  // quase um segundo de 38% de aceleração por apenas não ter ganhado a bola. O `duelCooldown`
  // (0,62s) já é quem impede a re-investida imediata; isto aqui é só o tranco do corpo.
  repelReaction: 0.4,
  // Depois da finta, o tempo até o jogador poder entrar em novo duelo. Eram 5,2s/6,8s cravados —
  // uma ordem de grandeza acima do cooldown de desarme (0,55–0,85s), e o motivo de o driblador
  // quase nunca driblar. Quem foi lido demora mais a tentar de novo do que quem passou.
  feintCooldownWon: 1.6,
  feintCooldownLost: 2.4,
  // Vantagem mínima do portador sobre o marcador (escala de `duelStrength`) para valer a tentativa
  // de finta. Negativa de propósito: encarar alguém um pouco melhor faz parte do drible.
  feintConfidenceEdge: -0.04,
  // Quanta confiança o portador tem em escapar da pressão sozinho, lida da sua `duelStrength`:
  // abaixo da base é zero, uma faixa acima dela é confiança total. A base fica onde ficava o
  // antigo limiar (jogador mediano e inteiro sai por volta de 0,2 de confiança).
  escapeConfidenceBase: 0.64,
  escapeConfidenceSpan: 0.35,
} as const;

// Proteção de bola: a bola não mora no nariz do portador, ela desliza para o lado oposto a quem
// pressiona. É a geometria que faz existir o corpo entre a bola e o marcador — sem ela, nenhum
// ajuste de fórmula de duelo produz um lance de proteção.
export const SHIELD = {
  // A partir de quantas unidades além do encosto dos corpos o portador começa a esconder a bola.
  // Largo o bastante para ele já estar protegendo quando o marcador chega, não depois.
  range: 6,
  // Até onde a bola se afasta da frente do corpo. Além de ~110° ela sai do alcance do pé de
  // apoio e o portador a perderia de vista — proteger vira esconder de si mesmo.
  maxAnchor: Math.PI * 0.6,
  // Velocidade com que a bola contorna o corpo (rad/s). Uma virada completa de proteção leva
  // ~0,3s, que é o tempo de um passo. Mais rápido que isto e a âncora vira teleporte de novo.
  turnRate: 6,
} as const;

// Lookahead de condução→finalização: valoriza conduzir para abrir um chute melhor.
export const CONDUCT = {
  carryShotWeight: 0.6, // peso do bônus na utilidade de drible
  carryShotMinGain: 0.3, // só conta se o chute futuro superar o atual por esta margem
  carryShotCap: 1.2, // teto do ganho considerado
  carryShotMaxDistance: 20, // o chute futuro precisa ser de dentro de fieldX(20) para valer
} as const;

// Lei 11 — impedimento. `runMarginProgress` é o afrouxamento "equilibrado": o teto de avanço da
// forma (forwardLimitFor) fica esta fração da largura à frente da penúltima linha, para os
// corredores fazerem a diagonal nas costas da defesa e, de vez em quando, serem pegos. Zerá-lo
// devolve a disciplina antiga (impedimento vira lei que quase nunca é apitada).
export const OFFSIDE = {
  runMarginProgress: 0.06,
  // Margem para "estar à frente da linha" — empatar com o penúltimo adversário é legal, então
  // exige-se ultrapassá-lo por esta fração da largura, não por um resíduo de arredondamento.
  toleranceProgress: 0.004,
  // A jogada congela e a linha é desenhada por este tempo antes do tiro livre sair. É a
  // "animação da bandeira" pedida: tempo de leitura, não física.
  freezeSeconds: 1.3,
} as const;

export const ANALYTICS_GRID = {
  columns: 12,
  rows: 8,
  sampleInterval: 0.5,
} as const;
