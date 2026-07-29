import { CONTEST, FIELD, PHYSICS } from "../config";
import { add, clamp, distance, normalize, scale, subtract } from "../../shared/math";
import type { AgentDecision, MatchState, PlayerRuntime, Team } from "../model";
import { goalCenter } from "../runtime/formation-geometry";
import { clampToField } from "../runtime/pitch";
import { playerSkillSpeed } from "../runtime/player-metrics";

/**
 * Ir até onde a bola vai estar. Ver o comentário da própria função: é o mesmo trajeto para quem
 * empurrou a bola à frente, para quem espera o passe e para quem vai tomá-la de alguém.
 */

/**
 * Ir até onde a bola vai estar. É o mesmo movimento para quem empurrou a bola à frente num
 * pique, para quem espera o passe e para quem vai tomá-la de alguém: muda o rótulo, a postura e
 * o ponto exato de chegada, não o trajeto.
 *
 * É aqui que morre o detector de desvio caseiro da recepção. Se a bola muda de rota, o ponto de
 * encontro muda com ela; quem deixou de chegar primeiro deixa de ser o dono do lance, sem que
 * ninguém precise reconhecer um "desvio".
 */
export const pursueBallDecision = (player: PlayerRuntime, state: MatchState, team: Team, committed: boolean): AgentDecision => {
  const situation = state.ballSituation;
  const ownKnockOn = state.ball.dribbleOwnerId === player.profile.id;
  const awaitingPass = state.pendingPass?.receiverId === player.profile.id;
  // O rótulo sai de POR QUE a bola é minha, e não de como ela está rolando: continuo o meu
  // pique, recebo o passe que veio para mim, ou vou tomar uma bola que não era de ninguém.
  const mine = ownKnockOn || awaitingPass;
  const style = state.ball.dribbleStyle;
  const intent: AgentDecision["intent"] = ownKnockOn
    ? style === "feint" ? "feinting" : style === "carry" ? "carrying" : "knockingOn"
    : awaitingPass ? "receiving" : "pressing";
  // Bola minha: vou nela. Bola a tomar: chego pelo lado do próprio gol, fechando a saída em vez
  // de correr atrás por trás.
  const phase = state.tactics[team].phase;
  const aggressive = committed || situation.phase === "contested"
    || phase === "counterPress" || phase === "highPress";
  const target = mine ? { ...situation.contactPoint } : add(
    situation.contactPoint,
    scale(
      normalize(subtract(goalCenter(team, true), situation.contactPoint)),
      player.radius * (aggressive ? 0.95 : 1.75),
    ),
  );
  if (!mine && state.tactics[team].collectivePlan?.pressTrigger === "touchline") {
    target.y += (situation.contactPoint.y < FIELD.height / 2 ? 1 : -1) * player.radius * 0.9;
  }
  const runSpeed = playerSkillSpeed(player) * PHYSICS.runSpeedFactor;
  const gap = distance(player.position, target);
  // Bola minha: só queimo pique se for chegar tarde ou se houver alguém no páreo. Bola a tomar:
  // solta se corre atrás, dominada se pressiona andando — e é esse pique que transforma um toque
  // adiantado do adversário numa chance de dividida.
  const race = mine
    ? gap / Math.max(0.12, situation.contactIn) > runSpeed * 0.88 || situation.margin < CONTEST.settleMargin
    : committed || situation.phase !== "controlled";
  // A régua de energia é uma só. Exigir mais de quem vai buscar a PRÓPRIA bola do que de quem vai
  // tomá-la invertia o lance: o toque à frente sai com 0,26 de barra (ver `dribble-runway`) e o
  // pique atrás dele pedia 0,48 — o motor autorizava o avanço e proibia a corrida que o completa,
  // enquanto o adversário disparava com 0,12.
  const burst = race && player.sprintCooldown <= 0 && player.sprintEnergy > 0.12;
  const raceSpeed = playerSkillSpeed(player) * PHYSICS.burstSpeedFactor;
  return {
    movementTarget: clampToField(target, 3),
    burst,
    burstDuration: burst
      ? clamp(gap / Math.max(1, raceSpeed * 0.78), PHYSICS.burstDuration, 1.45)
      : undefined,
    posture: mine ? "inPossession" : "outOfPossession",
    intent,
    reason: ownKnockOn ? "carryIntoSpace" : awaitingPass ? "attackReception" : "pressBall",
    ballAction: { kind: "none" },
  };
};
