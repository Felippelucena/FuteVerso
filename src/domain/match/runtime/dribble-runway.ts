import { DUEL, FIELD, PHYSICS } from "../config";
import type { DribbleRangeReason, DribbleTouchRange, MatchState, PlayerRuntime, Vec2 } from "../model";
import { add, clamp, cross, dot, normalize, scale, subtract } from "../../shared/math";
import { laneSurvival } from "./pass-viability";
import { clampToField } from "./pitch";
import { interceptionThreat, predictedSpaceAt, predictPlayerAlongPlan } from "./prediction";
import { etaToPoint, playerSkillSpeed } from "./player-metrics";

export interface ForwardRunway {
  direction: Vec2;
  distance: number;
  fieldDistance: number;
  blockerId: string | null;
}

export interface DribbleTouchChoice {
  range: DribbleTouchRange | null;
  target: Vec2;
  touchDistance: number;
  runway: number;
  carrierEta: number;
  opponentEta: number;
  reason: DribbleRangeReason;
}

// Gates de energia leem a barra volátil (piques). Avançar em espaço = knock-on por padrão,
// então os limiares de corredor/energia são baixos; a bola colada (carry) fica de reserva
// para apertado/pressão/finta.
const RANGE_RULES = [
  { range: "long", runway: 40, minimum: 25, maximum: 38, energy: 0.5, raceMargin: 0.55, fraction: 0.72 },
  { range: "medium", runway: 26, minimum: 16, maximum: 24, energy: 0.4, raceMargin: 0.3, fraction: 0.68 },
  { range: "short", runway: 10, minimum: 8, maximum: 13, energy: 0.26, raceMargin: 0, fraction: 0.62 },
] as const;

const opponentEtaAt = (state: MatchState, player: PlayerRuntime, target: Vec2): number => Math.min(
  ...state.players.filter((candidate) => candidate.team !== player.team).map((opponent) => etaToPoint(opponent, target)),
);

/** Rumo padrão: o gol adversário. É o que sobra quando ninguém disse para onde levar a bola. */
export const goalwardHeading = (player: PlayerRuntime): Vec2 => ({ x: player.team === "blue" ? 1 : -1, y: 0 });

/** Até onde este rumo cabe dentro das linhas, com a mesma margem que o alvo do toque respeita. */
const roomToTouchline = (from: Vec2, heading: Vec2): number => {
  const along = (position: number, rate: number, low: number, high: number): number =>
    rate > 0.0001 ? (high - position) / rate : rate < -0.0001 ? (low - position) / rate : Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(
    along(from.x, heading.x, 5, FIELD.width - 5),
    along(from.y, heading.y, 5, FIELD.height - 5),
  ));
};

/**
 * Quanto corredor existe NESTE rumo, e quem o fecha.
 *
 * O rumo é parâmetro porque quem escolhe para onde levar a bola é o portador (`chooseDribbleTarget`,
 * que pesa espaço, progresso, canal e risco de linha) — aqui só se mede o que cabe naquela direção.
 * Estava cravado em `{±1, 0}`: o toque à frente saía reto, com o mesmo `y`, e a posição do marcador
 * não entrava na conta. Como o toque à frente é 87% de todos os dribles do motor, na prática o
 * drible dominante era cego, e a inteligência de `chooseDribbleTarget` só valia para os outros 13%.
 */
export const evaluateForwardRunway = (
  state: MatchState,
  player: PlayerRuntime,
  heading: Vec2 = goalwardHeading(player),
): ForwardRunway => {
  const direction = normalize(heading);
  const fieldDistance = roomToTouchline(player.position, direction);
  const maximumDistance = Math.max(0, Math.min(45, fieldDistance));
  let blockerId: string | null = null;
  let blockerDistance = maximumDistance;
  for (const opponent of state.players.filter((candidate) => candidate.team !== player.team)) {
    const relative = subtract(opponent.position, player.position);
    const currentForward = dot(relative, direction);
    if (currentForward <= 0 || currentForward >= blockerDistance + opponent.radius) continue;
    const carrierEta = currentForward / Math.max(1, playerSkillSpeed(player) * PHYSICS.burstSpeedFactor);
    const future = predictPlayerAlongPlan(state, opponent, clamp(carrierEta, 0.12, 1.8));
    const ahead = subtract(future, player.position);
    const futureForward = dot(ahead, direction);
    const corridorHalfWidth = player.radius + opponent.radius + FIELD.ballRadius + 1.25;
    if (futureForward <= 0 || Math.abs(cross(direction, ahead)) > corridorHalfWidth) continue;
    blockerDistance = Math.max(0, Math.min(currentForward, futureForward) - opponent.radius - FIELD.ballRadius);
    blockerId = opponent.profile.id;
  }
  return { direction, distance: Math.min(maximumDistance, blockerDistance), fieldDistance, blockerId };
};

/**
 * Vale erguer a bola por cima da dividida? Só quando o marcador está goal-side, colado, e há
 * espaço livre atrás dele para o portador disparar. É escolha do atacante — por isso mora aqui,
 * ao lado das outras decisões de avanço, e não no desfecho de um duelo.
 */
export const knockPastEligible = (state: MatchState, carrier: PlayerRuntime, challenger: PlayerRuntime): boolean => {
  if (carrier.sprintEnergy <= DUEL.knockPastMinEnergy || carrier.dribbleTouchCooldown > 0) return false;
  const goalward = { x: carrier.team === "blue" ? 1 : -1, y: 0 };
  if ((challenger.position.x - carrier.position.x) * goalward.x <= 0) return false; // precisa estar à frente
  const behind = {
    x: challenger.position.x + goalward.x * DUEL.knockPastProbe * FIELD.width,
    y: challenger.position.y,
  };
  const others = state.players.filter((player) => player.team !== carrier.team && player.profile.id !== challenger.profile.id);
  const space = others.length ? predictedSpaceAt(behind, others, 0.4) : FIELD.width;
  return space >= DUEL.knockPastMinSpace * FIELD.width;
};

/**
 * **A chance de a bola ainda ser nossa depois deste toque** — o que `completionChance` é para o passe.
 *
 * Era o que faltava para os três verbos do portador competirem na mesma unidade: a condução era a
 * única saída cujo risco não era cobrado, e por isso levar a bola até o gol parecia de graça — o valor
 * da área (0,47–0,77) contra um chute de 20 m que já pagava pressão e corpo na rota. O atacante
 * deixava de chutar, e não por estar mal calibrado: a comparação é que era desonesta.
 *
 * A pergunta é a MESMA do passe, e por isso a régua é a mesma: quantos corpos alcançam a bola no
 * caminho (`interceptionThreat` → `laneSurvival`), e se há um em cima de mim, passo por ele
 * (`escapeConfidence`, que sai do duelo). A carreta é lenta — o tempo de viagem é o do portador, não o
 * de uma bola chutada —, e é por isso que a defesa projetada tem tempo de fechar o corredor.
 *
 * **Sem a corrida**, e isto foi medido nos dois sentidos. `chooseDribbleTouch` filtra por `raceMargin`
 * no knock-on mas não no caminho de fallback, então o termo não é redundante em teoria — só que somá-lo
 * derruba a condução a ponto de o time não chegar mais à área: chutes de dentro caíram de 4,5 para 2,5
 * e o xG por partida de 1,11 para 0,30. O motor já cobra a corrida em outro lugar (o próprio duelo,
 * quando o marcador chega), e cobrá-la aqui também é o mesmo lance pago duas vezes.
 */
export const carrySurvival = (
  carrier: PlayerRuntime,
  opponents: PlayerRuntime[],
  touch: DribbleTouchChoice,
  pressure: number,
  escapeConfidence: number,
): number => laneSurvival(interceptionThreat(carrier.position, touch.target, opponents, touch.carrierEta))
  * (1 - pressure * (1 - escapeConfidence));

export const chooseDribbleTouch = (
  state: MatchState,
  player: PlayerRuntime,
  runway = evaluateForwardRunway(state, player),
): DribbleTouchChoice => {
  let reductionReason: DribbleRangeReason | null = null;
  for (const rule of RANGE_RULES) {
    if (runway.distance < rule.runway) continue;
    if (player.dribbleTouchCooldown > 0) {
      reductionReason ??= "touchCooldown";
      continue;
    }
    // A energia volátil é o limitador do avanço em piques — não um cooldown fixo.
    if (player.sprintEnergy <= rule.energy) {
      reductionReason ??= "reducedForEnergy";
      continue;
    }
    const touchDistance = clamp(runway.distance * rule.fraction, rule.minimum, Math.min(rule.maximum, runway.fieldDistance));
    const target = clampToField(add(player.position, scale(runway.direction, touchDistance)), 5);
    const carrierEta = touchDistance / Math.max(1, playerSkillSpeed(player) * PHYSICS.burstSpeedFactor);
    const opponentEta = opponentEtaAt(state, player, target);
    if (opponentEta <= carrierEta + rule.raceMargin) {
      reductionReason ??= "reducedForRace";
      continue;
    }
    return {
      range: rule.range,
      target,
      touchDistance,
      runway: runway.distance,
      carrierEta,
      opponentEta,
      reason: reductionReason ?? "clearRunway",
    };
  }
  const fallbackDistance = Math.min(9, runway.distance, runway.fieldDistance);
  const fallbackTarget = clampToField(add(player.position, scale(runway.direction, Math.max(0, fallbackDistance))), 5);
  const carrierEta = fallbackDistance / Math.max(1, playerSkillSpeed(player) * PHYSICS.runSpeedFactor);
  return {
    range: null,
    target: fallbackTarget,
    touchDistance: fallbackDistance,
    runway: runway.distance,
    carrierEta,
    opponentEta: opponentEtaAt(state, player, fallbackTarget),
    reason: reductionReason ?? "insufficientRunway",
  };
};
