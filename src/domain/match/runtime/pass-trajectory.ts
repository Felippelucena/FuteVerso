import { CONTEST, FIELD, PHYSICS } from "../config";
import type { PassRange, PassTargeting, PassTrajectory, Vec2 } from "../model";
import { add, clamp, distance, normalize, scale, subtract } from "../../shared/math";

export interface PassTrajectorySolution {
  velocity: Vec2;
  verticalVelocity: number;
  duration: number;
  landingPoint: Vec2;
}

/**
 * O obstáculo que uma bola erguida precisa transpor. `atFraction` é onde ele está na rota, de 0
 * (no pé de quem passa) a 1 (no alvo) — é a alavanca da conta: quem está no meio do caminho é o
 * mais caro de superar, e quem está colado no passador ou no recebedor quase não pede altura.
 */
export interface LaneClearance {
  height: number;
  atFraction: number;
}

/**
 * A altura que basta: o corpo inteiro da bola acima do que um jogador alcança. A margem é o raio
 * da bola porque é isso que ela é — passar "raspando o alcance" com o centro ainda é passar pelo
 * pé de alguém.
 */
export const CLEARANCE_HEIGHT = PHYSICS.reachableBallHeight + FIELD.ballRadius;

/** Sem obstáculo conhecido, supõe-se o pior caso: um corpo no meio da rota, que é o mais caro. */
const DEFAULT_CLEARANCE: LaneClearance = { height: CLEARANCE_HEIGHT, atFraction: 0.5 };

const dragMatchedSpeed = (travelDistance: number, duration: number, drag: number): number => {
  if (drag <= 0) return travelDistance / Math.max(0.01, duration);
  return travelDistance * drag / Math.max(0.01, 1 - Math.exp(-drag * duration));
};

/**
 * Tempo de voo de uma bola erguida: o **mínimo** que a põe acima do obstáculo no instante em que
 * ela passa por cima dele.
 *
 * Era `gravity × duração / 2`, que amarrava o tempo de voo ao tempo de viagem horizontal. Um
 * passe de 34 m subia a mais de 6 m e ficava fora do alcance de qualquer um durante 95% do voo —
 * o motor jogava a bola por cima e depois não conseguia dominá-la. A altura de um passe é a do
 * obstáculo que ele transpõe, e nada mais.
 *
 * Com h(t) = v₀t − g·t²/2 e pouso em T (logo v₀ = gT/2), a altura na fração f da rota é
 * (g·T²/2)·f(1−f). Daí T sai fechado, sem busca nenhuma.
 */
const liftedFlightTime = (clearance: LaneClearance): number => {
  if (clearance.height <= 0) return 0;
  const leverage = clamp(clearance.atFraction * (1 - clearance.atFraction), 0.04, 0.25);
  return Math.sqrt(2 * clearance.height / (PHYSICS.gravity * leverage));
};

/**
 * O voo mais curto em que a bola ainda cobre a distância com a força que a perna imprime. É o
 * piso do tempo de viagem, e é ele que obriga a bola longa a subir: não se joga um lançamento de
 * 40 m rasante porque não há chute que o faça — para chegar lá a bola tem de ficar mais tempo no
 * ar, e ficar mais tempo no ar é subir.
 */
const crossingTime = (travelDistance: number, drag: number, launchSpeed: number): number => {
  if (drag <= 0) return travelDistance / launchSpeed;
  const asymptote = launchSpeed / drag;
  return -Math.log(1 - clamp(travelDistance / asymptote, 0, 0.985)) / drag;
};

export const estimatePassDuration = (
  travelDistance: number,
  trajectory: PassTrajectory,
  range: PassRange,
  targeting: PassTargeting,
  power = 0.7,
  clearance: LaneClearance = DEFAULT_CLEARANCE,
): number => {
  if (trajectory === "air") {
    // Duas exigências, e o voo é a maior das duas: subir o bastante para passar por cima do
    // corpo que está na rota, e ficar no ar o bastante para a força do chute cobrir a distância.
    // Daí a bola curta sair rasante e a longa em parábola, sem nenhum caso especial.
    //
    // O teto é o horizonte em que o motor ainda lê uma bola (`CONTEST.horizonSeconds`): além
    // dele ninguém prevê o encontro, então uma bola mais lenta que isso não é jogada, é aposta.
    const launchSpeed = PHYSICS.aerialPassLaunchSpeed * (0.88 + clamp(power, 0, 1) * 0.22);
    return clamp(
      Math.max(liftedFlightTime(clearance), crossingTime(travelDistance, PHYSICS.airBallDrag, launchSpeed)),
      0.5,
      CONTEST.horizonSeconds,
    );
  }
  const pace = range === "long" ? 36 : targeting === "space" ? 34 : 28;
  const poweredPace = pace * (0.88 + clamp(power, 0, 1) * 0.22);
  return range === "long"
    ? clamp(travelDistance / poweredPace, 0.72, 2.05)
    : clamp(travelDistance / poweredPace, 0.28, 1.25);
};

export const solvePassTrajectory = (
  origin: Vec2,
  target: Vec2,
  trajectory: PassTrajectory,
  range: PassRange,
  targeting: PassTargeting,
  power = 0.7,
  clearance: LaneClearance = DEFAULT_CLEARANCE,
): PassTrajectorySolution => {
  const travelDistance = distance(origin, target);
  const direction = normalize(subtract(target, origin));
  const duration = estimatePassDuration(travelDistance, trajectory, range, targeting, power, clearance);
  const drag = trajectory === "air" ? PHYSICS.airBallDrag : PHYSICS.ballDrag;
  const speed = clamp(dragMatchedSpeed(travelDistance, duration, drag), 0, PHYSICS.maxBallSpeed);
  const verticalVelocity = trajectory === "air" ? PHYSICS.gravity * duration / 2 : 0;
  const reachableDistance = drag > 0 ? speed * (1 - Math.exp(-drag * duration)) / drag : speed * duration;
  const landingPoint = {
    x: clamp(origin.x + direction.x * reachableDistance, FIELD.ballRadius, FIELD.width - FIELD.ballRadius),
    y: clamp(origin.y + direction.y * reachableDistance, FIELD.ballRadius, FIELD.height - FIELD.ballRadius),
  };
  return { velocity: scale(direction, speed), verticalVelocity, duration, landingPoint };
};

/**
 * Quanto tempo, do voo, a bola passa ao alcance de um jogador. É a janela real para dominá-la —
 * a rasteira vale o voo inteiro, a erguida só as pontas —, e é dela que sai tanto a chance de
 * recepção quanto o prazo em que o passe ainda pode se completar.
 */
export const reachableFlightSeconds = (solution: PassTrajectorySolution): number => {
  if (solution.verticalVelocity <= 0) return solution.duration;
  // h(t) = v₀t − g·t²/2 cruza o alcance em duas raízes; entre elas a bola está alta demais.
  const discriminant = solution.verticalVelocity * solution.verticalVelocity
    - 2 * PHYSICS.gravity * PHYSICS.reachableBallHeight;
  if (discriminant <= 0) return solution.duration;
  const spread = Math.sqrt(discriminant) / PHYSICS.gravity;
  return Math.max(0, solution.duration - 2 * spread);
};

export const targetAlongDirection = (origin: Vec2, intendedTarget: Vec2, direction: Vec2): Vec2 =>
  add(origin, scale(normalize(direction), distance(origin, intendedTarget)));
