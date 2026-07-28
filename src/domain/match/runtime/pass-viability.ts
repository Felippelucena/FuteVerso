import { clamp } from "../../shared/math";
import { PHYSICS } from "../config";
import type { PlayerRuntime, Vec2 } from "../model";
import { CLEARANCE_HEIGHT, type LaneClearance, type PassTrajectorySolution } from "./pass-trajectory";
import { interceptionRisk } from "./prediction";

/**
 * **Quão difícil é dominar esta bola?** — uma pergunta, uma resposta.
 *
 * Ela era respondida em três lugares que não se conheciam: `decision/pass` descontava a pressão
 * de linha da bola aérea em dois terços (ela passa por cima), `ball-system` cobrava dificuldade
 * na execução e `possession-system` cobrava de novo no primeiro toque — com números que
 * discordavam entre si. O decisor enxergava a bola aérea como quase grátis; o resolvedor a
 * tornava quase incontrolável. O motor então escolhia, na maioria das vezes, exatamente o passe
 * que ele mesmo não conseguia completar.
 *
 * Aqui a conta é uma só, e serve às duas pontas porque é **pura**: o resolvedor a chama com a
 * bola real que chegou; o decisor, com a bola prevista que ele pensa em jogar. É essa simetria
 * que impede as duas metades do motor de voltarem a discordar sobre o que é um passe bom.
 */

/**
 * Quão claramente um adversário precisa estar no caminho para valer a pena erguer a bola por
 * cima dele. Meio alcance: quem está mais longe que isso da linha do passe é pressão, não
 * barreira, e chapar a bola sobre ele custa o voo e não compra nada.
 */
const OBSTACLE_RISK = 0.5;

/**
 * O corpo que a bola precisa transpor para chegar: o adversário mais no caminho, e onde ele está
 * na rota. Corredor limpo devolve altura zero — e é isso que tira da bola aérea o desconto que
 * ela recebia de graça: erguer a bola só compra alguma coisa quando há de fato alguém a transpor.
 *
 * Quem é "alguém no caminho" é a MESMA pergunta que decide quem ameaça a rota (`interceptionRisk`),
 * e por isso é a mesma função. Enquanto cada uma tinha o próprio raio, o motor achava obstáculo
 * onde a outra não via ameaça — e erguia a bola para transpor um corpo que não bloqueava nada.
 */
export const laneClearance = (
  origin: Vec2,
  target: Vec2,
  opponents: PlayerRuntime[],
  travelSeconds: number,
): LaneClearance => {
  let worst: { risk: number; amount: number } | null = null;
  for (const opponent of opponents) {
    const { risk, atFraction } = interceptionRisk(origin, target, opponent, travelSeconds);
    if (risk < OBSTACLE_RISK || atFraction <= 0.02 || atFraction >= 0.98) continue;
    if (!worst || risk > worst.risk) worst = { risk, amount: atFraction };
  }
  return worst === null
    ? { height: 0, atFraction: 0.5 }
    : { height: CLEARANCE_HEIGHT, atFraction: worst.amount };
};

/**
 * Note que não há aqui nenhum termo "custo de dominar uma bola aérea longa". Havia — 0,24 contra
 * 0,12 da rasteira curta —, e era contagem dupla: a bola aérea longa já chega mais rápido e mais
 * alta, e é POR ISSO que ela é difícil. Cobrar de novo pelo rótulo era o motor descrevendo o
 * mesmo fato duas vezes, com números que não conversavam.
 */
export interface ReceptionContext {
  /** Qualidade de domínio de quem vai encostar na bola (ver `ballClaimQuality`). */
  quality: number;
  /** Fôlego longo de quem recebe. */
  stamina: number;
  composure: number;
  anticipation: number;
  /** Velocidade da bola em relação ao corpo — o que de fato precisa ser amortecido. */
  relativeSpeed: number;
  ballHeight: number;
  /** 0..1 — quanto o corpo já está voltado para a bola. */
  facingAlignment: number;
  /** 0..1 — pressão adversária sobre quem recebe. */
  pressure: number;
  /** Goleiro na própria área: mão em vez de pé, e por isso outra régua de contato. */
  ownBox: boolean;
  /** Quem alcança a própria bola adiantada não precisa dominá-la de novo. */
  continuesOwnDribble: boolean;
  /** Passe do próprio time que este jogador já esperava — ele chega orientado. */
  prepared: boolean;
  /** Teto de altura em que o jogador ainda alcança a bola (`PHYSICS.reachableBallHeight`). */
  reachableHeight: number;
}

/** Amplitude do ruído somado à margem no primeiro toque. */
export const RECEPTION_NOISE = 0.16;

/** Acima desta margem o domínio sai limpo; abaixo do piso, a bola escapa de vez. */
const cleanThreshold = (ownBox: boolean): number => ownBox ? 0.08 : 0.16;
const HEAVY_THRESHOLD = -0.13;

/**
 * A margem determinística do domínio: positiva sobra, negativa falta. O ruído do primeiro toque
 * NÃO entra aqui — quem resolve o contato o soma, quem decide o passe o integra em
 * probabilidade. Misturá-lo dentro tornaria a conta impura e inutilizável para prever.
 */
export const receptionMargin = (context: ReceptionContext): number => {
  const speedDifficulty = clamp(context.relativeSpeed / (context.ownBox ? 68 : 52), 0, 1)
    * (context.ownBox ? 0.5 : 0.64)
    * (context.prepared ? 0.9 : 1);
  const heightDifficulty = clamp(context.ballHeight / context.reachableHeight, 0, 1) * 0.18;
  const positioningDifficulty = (1 - context.facingAlignment) * 0.16;
  const pressureDifficulty = context.pressure * 0.1 * (1.22 - context.composure / 180);
  const dribbleBonus = context.continuesOwnDribble ? 0.18 : 0;
  const receptionBonus = context.prepared
    ? context.facingAlignment * 0.03 + context.anticipation / 100 * 0.03
    : 0;
  return context.quality * 0.72 + context.stamina * 0.1 + dribbleBonus + receptionBonus
    - speedDifficulty - heightDifficulty - positioningDifficulty - pressureDifficulty;
};

/** O desfecho do contato, já com o ruído do lance somado à margem. */
export const classifyReception = (
  margin: number,
  ownBox: boolean,
): "clean" | "heavy" | "miss" => {
  if (margin > cleanThreshold(ownBox)) return "clean";
  if (margin > HEAVY_THRESHOLD) return "heavy";
  return "miss";
};

/**
 * `signedMatchNoise` é a diferença de dois uniformes, ou seja **triangular em [-1, 1]** com pico
 * no zero. Saber a distribuição de verdade é o que permite converter margem em probabilidade sem
 * inventar um sigmoide com constante mágica: esta é a cauda superior exata dela.
 */
const triangularSurvival = (value: number): number => {
  if (value <= -1) return 1;
  if (value >= 1) return 0;
  return value <= 0 ? 1 - (1 + value) * (1 + value) / 2 : (1 - value) * (1 - value) / 2;
};

/** Chance de o domínio sair limpo, dada a margem determinística e o ruído do lance. */
export const controlChance = (margin: number, ownBox = false): number =>
  triangularSurvival((cleanThreshold(ownBox) - margin) / RECEPTION_NOISE);

/**
 * Chance de ganhar a corrida até a bola, a partir da folga em segundos sobre o adversário mais
 * rápido ao ponto de queda. A régua é a mesma que o motor já usa para dizer se um lance tem dono
 * (`CONTEST.settleMargin`): acima dela é nossa, abaixo do simétrico é dele, no meio é disputa.
 */
export const raceChance = (advantageSeconds: number, settleMargin: number): number =>
  clamp((advantageSeconds + settleMargin) / (2 * settleMargin), 0, 1);

/**
 * Chance de a bola atravessar a rota sem ser cortada. `threat` é a soma das oportunidades de
 * interceptação (ver `interceptionThreat`) — somar oportunidades e exponenciar é a forma certa
 * de transformar "quantas chances eles têm" em "qual a chance de nenhuma vingar".
 */
export const laneSurvival = (threat: number): number => Math.exp(-Math.max(0, threat));

/**
 * Altura da bola sobre um ponto da rota, dado em fração da distância. Com arrasto o avanço
 * horizontal não é linear no tempo, então a fração é invertida para o instante antes de olhar a
 * parábola — é o que permite perguntar "a bola já subiu quando chega neste corpo?".
 */
const heightAtFraction = (solution: PassTrajectorySolution, drag: number, fraction: number): number => {
  if (solution.verticalVelocity <= 0) return 0;
  const span = 1 - Math.exp(-drag * solution.duration);
  const at = drag > 0 && span > 0
    ? -Math.log(1 - clamp(fraction * span, 0, 0.999)) / drag
    : fraction * solution.duration;
  return solution.verticalVelocity * at - PHYSICS.gravity * at * at / 2;
};

/**
 * A ameaça real à rota do passe: a soma dos adversários que alcançam a bola **onde ela passa por
 * eles**. Quem está sob a parte alta do voo não conta — e é só isso que a bola erguida compra.
 *
 * Antes o desconto aéreo era um fator único sobre a soma inteira (0,34 cravado, depois a fração
 * do voo em que a bola está baixa). Os dois davam o mesmo abatimento ao marcador colado no
 * passador e ao que está no meio do campo, quando é justamente a posição dele na rota que decide
 * se a bola passa por cima ou no pé. Daí o motor jogar a bola erguida em toda parte: ele comprava
 * um desconto que a geometria não concedia.
 */
export const passLaneThreat = (
  origin: Vec2,
  target: Vec2,
  opponents: PlayerRuntime[],
  solution: PassTrajectorySolution,
  drag: number,
): number => {
  const segment = { x: target.x - origin.x, y: target.y - origin.y };
  if (segment.x * segment.x + segment.y * segment.y < 0.001) return 0;
  return opponents.reduce((total, opponent) => {
    const { risk, atFraction } = interceptionRisk(origin, target, opponent, solution.duration);
    if (risk <= 0) return total;
    return heightAtFraction(solution, drag, atFraction) > PHYSICS.reachableBallHeight ? total : total + risk;
  }, 0);
};

/**
 * **A chance de este passe terminar com a bola do nosso time.** As três perguntas que o futebol
 * faz de um passe, multiplicadas porque todas precisam dar certo: a bola passa, o meu chega
 * antes, e ele domina. É esta a nota que faltava — o motor calculava a corrida
 * (`receiverEta`/`opponentEta`) e a jogava fora.
 */
export const completionChance = (
  control: number,
  race: number,
  lane: number,
): number => clamp(control * race * lane, 0, 1);
