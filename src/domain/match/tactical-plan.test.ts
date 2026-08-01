import { describe, expect, it } from "vitest";
import { referenceMatchConfig, smallSidedMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { decideAll } from "./decision";
import { perceive } from "./runtime/ball-situation";
import { FIELD } from "./config";
import { applyTeamAdjustment, createMatchState } from "./index";
import { dutyHolders } from "./systems/assignment-system";
import { updateTacticalContext } from "./systems/tactics-system";
import { BUILD_UP_STYLES, DEFENSIVE_BLOCKS } from "../tactics/vocabulary";
import { DEFAULT_INSTRUCTION, NEUTRAL_DIRECTIVES } from "../tactics/model";
import type { FreedomInstruction, PlayerInstruction, TacticalMentality, TeamDirectives } from "../tactics/model";
import type { MatchState, PlayerRuntime, TeamCollectivePlan } from "./model";

/**
 * A ponte entre o plano do treinador e o motor. O que estes testes protegem não é a fórmula de
 * cada viés — é que cada controle **chegue** ao jogo: um eixo que se desligar em silêncio devolve
 * ao usuário um botão que não faz nada, que é o defeito que já existiu aqui.
 *
 * O caso neutro tem seu próprio guardião: `characterization.test.ts`, que mede o fingerprint da
 * partida de referência (diretrizes neutras) e acusa qualquer eixo que vaze para o meio da régua.
 */
type Directives = Partial<Omit<TeamDirectives, "mentality">> & { mentality?: Partial<TacticalMentality> };

/** Mesmo cenário, mesma semente: só as diretrizes (e, se pedido, as instruções) do azul mudam. */
const directed = (overrides: Directives, instruction?: Partial<PlayerInstruction>): MatchState => {
  const config = smallSidedMatchConfig(11);
  const { blue } = config.teams;
  config.teams.blue = { ...blue, ...overrides, mentality: { ...blue.mentality, ...overrides.mentality } };
  if (instruction) {
    for (const participant of config.participants) {
      if (participant.team === "blue" && participant.slotId !== "gol") {
        participant.instruction = { ...participant.instruction, ...instruction };
      }
    }
  }
  const state = createMatchState(config);
  startOpenPlay(state);
  return state;
};

const bluePlan = (overrides: Directives): TeamCollectivePlan => {
  const state = directed(overrides);
  updateTacticalContext(state, 0);
  return state.tactics.blue.collectivePlan!;
};

/** Coral conduzindo em `progress` do campo do azul; todo o resto estacionado longe da jogada. */
const coralCarryingAt = (state: MatchState, progress: number): PlayerRuntime => {
  const carrier = state.players.find((player) => player.team === "coral" && player.profile.position === "centerMid")!;
  const presser = state.players.find((player) => player.team === "blue" && player.profile.position === "striker")!;
  const stepper = state.players.find((player) => player.team === "blue" && player.profile.position === "centerBack")!;
  carrier.position = { x: FIELD.width * progress, y: FIELD.height / 2 };
  carrier.velocity = { x: 0, y: 0 };
  // 1º pressionador mais perto da bola, porém fora do raio de pressão; zagueiro ao alcance.
  presser.position = { x: carrier.position.x + 22, y: carrier.position.y };
  stepper.position = { x: carrier.position.x + 34, y: carrier.position.y };
  state.players.forEach((player, index) => {
    if (player === carrier || player === presser || player === stepper) return;
    player.position = { x: FIELD.width - 18, y: 6 + index * 4 };
    player.kickCooldown = 5;
  });
  state.ball.position = { ...carrier.position };
  state.ball.velocity = { x: 0, y: 0 };
  state.ball.controllerId = carrier.profile.id;
  state.ball.lastTouch = carrier.team;
  state.ball.lastTouchPlayerId = carrier.profile.id;
  return carrier;
};

describe("o plano tático chega ao motor", () => {
  it("sobe e abre o time conforme a mentalidade manda", () => {
    const low = bluePlan({ mentality: { defensiveLine: 0, width: 0 } }).placement;
    const neutral = bluePlan({}).placement;
    const high = bluePlan({ mentality: { defensiveLine: 100, width: 100 } }).placement;

    expect(high.lineHeight).toBeGreaterThan(neutral.lineHeight);
    expect(neutral.lineHeight).toBeGreaterThan(low.lineHeight);
    expect(high.width).toBeGreaterThan(neutral.width);
    expect(neutral.width).toBeGreaterThan(low.width);
  });

  it("move o apetite coletivo pelo eixo de risco", () => {
    const risk = (value: number): number => bluePlan({ mentality: { risk: value } }).risk;

    expect(risk(100)).toBeGreaterThan(risk(50));
    expect(risk(50)).toBeGreaterThan(risk(0));
  });

  it("deixa o motor escolher o estilo em `auto` e obedece a qualquer outro valor", () => {
    expect(BUILD_UP_STYLES).toContain(bluePlan({}).buildUpStyle);
    expect(DEFENSIVE_BLOCKS).toContain(bluePlan({}).defensiveBlock);

    for (const style of BUILD_UP_STYLES) {
      expect(bluePlan({ buildUpStyle: style }).buildUpStyle).toBe(style);
    }
    for (const block of DEFENSIVE_BLOCKS) {
      expect(bluePlan({ defensiveBlock: block }).defensiveBlock).toBe(block);
    }
  });

  it("solta o segundo homem mais longe do próprio gol quando o eixo de pressão sobe", () => {
    const pressersAtMidfield = (pressing: number): string[] => {
      const state = directed({ mentality: { pressing } });
      coralCarryingAt(state, 0.5);
      updateTacticalContext(state, 0);
      return dutyHolders(state.tactics.blue.collectivePlan, "press");
    };

    // No meio-campo o teto neutro (o próprio terço defensivo) ainda não autoriza o segundo homem.
    expect(pressersAtMidfield(50)).toHaveLength(1);
    expect(pressersAtMidfield(100)).toHaveLength(2);
  });

  it("tira o time de cima da bola quando nenhum gatilho está habilitado", () => {
    const pressing = (pressTriggers: TeamDirectives["pressTriggers"]): { trigger: unknown; duties: string[]; intents: number } => {
      const state = directed({ pressTriggers });
      coralCarryingAt(state, 0.24);
      updateTacticalContext(state, 0);
      perceive(state);
      const decisions = decideAll(state);
      const blueIds = state.players.filter((player) => player.team === "blue").map((player) => player.profile.id);
      return {
        trigger: state.tactics.blue.collectivePlan!.pressTrigger,
        duties: dutyHolders(state.tactics.blue.collectivePlan, "press"),
        intents: blueIds.filter((id) => decisions.get(id)?.intent === "pressing").length,
      };
    };

    const armed = pressing(["looseBall", "counterPress", "touchline", "compact"]);
    expect(armed.trigger).not.toBeNull();
    expect(armed.duties.length).toBeGreaterThan(0);
    expect(armed.intents).toBeGreaterThan(0);

    const disarmed = pressing([]);
    expect(disarmed.trigger).toBeNull();
    expect(disarmed.duties).toHaveLength(0);
    expect(disarmed.intents).toBe(0);
  });

  it("solta a bola antes quando o eixo de tempo sobe", () => {
    // Idade de posse fixa entre os dois limiares: com tempo alto o portador já se acomodou e pode
    // entregar a bola, com tempo baixo ele ainda a está segurando. É esse relógio que o eixo move.
    const releases = (tempo: number): number => {
      let passing = 0;
      for (let step = 0; step < 12; step += 1) {
        const state = directed({ mentality: { tempo } });
        const carrier = state.players.find((player) => player.team === "blue" && player.profile.position === "centerMid")!;
        carrier.position = {
          x: FIELD.width * (0.3 + step * 0.04),
          y: FIELD.height * (0.5 + ((step % 3) - 1) * 0.15),
        };
        state.ball.position = { ...carrier.position };
        state.ball.controllerId = carrier.profile.id;
        state.ball.lastTouch = "blue";
        state.ball.lastTouchPlayerId = carrier.profile.id;
        state.elapsed = 0.5;
        updateTacticalContext(state, 0);
        perceive(state);
        if (decideAll(state).get(carrier.profile.id)?.intent === "passing") passing += 1;
      }
      return passing;
    };

    expect(releases(100)).toBeGreaterThan(releases(0));
  });

  it("puxa a decisão do portador conforme a liberdade de finalizar", () => {
    // Uma varredura de posições, e não uma partida: o que muda é o limiar entre chutar e seguir
    // com a bola, e ele só se revela na margem.
    //
    // A margem exige um marcador em cena. Sem ele o atacante está livre a 20 m do gol e conduzir é a
    // resposta certa em qualquer instrução — foi assim que esta varredura deixou de discriminar quando
    // as três utilidades passaram a ser probabilidade de gol: dentro de 18 m a chance clara manda, e
    // fora dela a condução livre ganha de qualquer chute. O zagueiro goal-side é o que devolve a
    // decisão à margem, cobrando da condução o corpo no caminho.
    const looksTaken = (shootFreedom: FreedomInstruction): number => {
      let shooting = 0;
      for (let step = 0; step < 12; step += 1) {
        const state = directed({}, { shootFreedom, role: "insideForward", duty: "attack" });
        const striker = state.players.find((player) => player.team === "blue" && player.profile.position === "striker")!;
        striker.position = {
          x: FIELD.width * (0.58 + step * 0.03),
          y: FIELD.height * (0.5 + ((step % 3) - 1) * 0.12),
        };
        const marker = state.players.find((player) => player.team === "coral" && player.profile.position === "centerBack")!;
        marker.position = {
          x: striker.position.x + FIELD.unitsPerMeter * 4,
          y: striker.position.y + FIELD.unitsPerMeter * (step % 4) * 0.9,
        };
        state.ball.position = { ...striker.position };
        state.ball.controllerId = striker.profile.id;
        state.ball.lastTouch = "blue";
        state.ball.lastTouchPlayerId = striker.profile.id;
        updateTacticalContext(state, 0);
        perceive(state);
        if (decideAll(state).get(striker.profile.id)?.intent === "shooting") shooting += 1;
      }
      return shooting;
    };

    expect(looksTaken("often")).toBeGreaterThan(looksTaken("rarely"));
  });

  /**
   * A trava da reforma de função: **os mesmos onze, o mesmo desenho, dois times diferentes.** Antes o
   * comportamento vinha de `PlayerRole`, campo de nascença do atleta — trocar de plano não mudava
   * nada, e o treinador não tinha como pedir um time que sobe ou um que segura.
   */
  it("faz o mesmo elenco jogar diferente conforme a função e o dever", () => {
    const shape = (instruction: Partial<PlayerInstruction>): { depth: number; pressers: number } => {
      const state = directed({}, instruction);
      updateTacticalContext(state, 0);
      const outfield = state.players.filter((player) => player.team === "blue" && player.slotId !== "gol");
      const depth = outfield.reduce((sum, player) => sum + player.homeAnchor.x, 0) / outfield.length;

      // O mesmo lance, nos dois times: adversário conduzindo no nosso terço, sem pressão em cima.
      coralCarryingAt(state, 0.24);
      updateTacticalContext(state, 0);
      // O segundo pressionador é um a mais na bola, além do primeiro — e só quem segura a linha o é.
      return { depth, pressers: dutyHolders(state.tactics.blue.collectivePlan, "press").length };
    };

    const holding = shape({ role: "anchor", duty: "defend" });
    const pushing = shape({ role: "poacher", duty: "attack" });

    // Quem pede um time de finalizadores recebe um time mais alto...
    expect(pushing.depth).toBeGreaterThan(holding.depth);
    // ...e ninguém que largue a linha para dobrar na bola: segurar a linha é propriedade da FUNÇÃO, e
    // um time sem retaguarda não tem quem saia. É a diferença que o antigo `PlayerRole` não fazia.
    expect(holding.pressers).toBeGreaterThan(pushing.pressers);
  });

  it("obedece ao treinador no meio do jogo, e a instrução fica com o slot", () => {
    const state = createMatchState(referenceMatchConfig(7));
    startOpenPlay(state);
    updateTacticalContext(state, 0);
    const ponta = state.players.find((player) => player.team === "blue" && player.slotId === "pe")!;
    const outroPonta = state.players.find((player) => player.team === "blue" && player.slotId === "pd")!;
    const anchorAntes = { ...ponta.homeAnchor };
    const fitAntes = ponta.positionFit;

    applyTeamAdjustment(state, "blue", {
      directives: { ...NEUTRAL_DIRECTIVES, mentality: { ...NEUTRAL_DIRECTIVES.mentality, pressing: 90 } },
      // Os dois pontas trocam de lado — o mesmo time, posições diferentes.
      slotByPlayer: { [ponta.profile.id]: "pd", [outroPonta.profile.id]: "pe" },
      instructionBySlot: { pd: { ...DEFAULT_INSTRUCTION, marking: "man" } },
    });

    expect(ponta.slotId).toBe("pd");
    expect(outroPonta.slotId).toBe("pe");
    expect(ponta.homeAnchor).not.toEqual(anchorAntes);
    expect(ponta.positionFit).not.toBe(fitAntes);
    // A instrução é do slot: quem assume a vaga assume a ordem dada a ela.
    expect(ponta.instruction.marking).toBe("man");
    expect(outroPonta.instruction.marking).toBe("zone");
    expect(state.tactics.blue.directives.mentality.pressing).toBe(90);
    // O plano coletivo em cache foi decidido sob as diretrizes antigas e não pode sobreviver.
    expect(state.tactics.blue.collectivePlan).toBeNull();
    expect(state.tactics.coral.directives.mentality.pressing).toBe(50);
  });
});
