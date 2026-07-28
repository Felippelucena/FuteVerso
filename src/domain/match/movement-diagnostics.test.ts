import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { FIELD, FIXED_STEP } from "./config";
import { resolvePlanDecision } from "./decision";
import { supportTarget } from "./decision/support";
import { createMatchState, stepMatch } from "./index";
import { cellAnchor, cellKey } from "./runtime/formation-geometry";
import { assignedAnchor } from "./runtime/formation-geometry";
import { distance, dot, length } from "../shared/math";
import type { AssignmentDuty, AssignmentZone, MatchState, PlayerRuntime, Team, TeamPosture, Vec2 } from "./model";

/**
 * Diagnóstico de movimento: mede se o time **executa** a forma que o plano coletivo desenha, e a
 * que custo. Fica `it.skip` porque simula partidas inteiras; roda sob demanda trocando para `it`.
 *
 * Três perguntas, que juntas explicam o "bolo de jogadores se esbarrando":
 *
 * 1. **O alvo fica parado?** Uma incumbência que se remaneja mais rápido do que o corpo corre é
 *    um alvo inalcançável por construção — e um time que nunca chega a lugar nenhum.
 * 2. **A forma sai do papel?** A largura das âncoras contra a largura dos corpos. Quando as duas
 *    divergem, o desenho tático é decorativo.
 * 3. **Quantos corpos disputam o mesmo palmo de grama?** Amontoado em volta da bola, tempo em
 *    contato e a distância ao vizinho mais próximo.
 */
const SEEDS = [12_345, 98_765, 2026];

const METRES = FIELD.unitsPerMeter;
const metres = (units: number): number => units / METRES;

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const quantile = (values: number[], share: number): number => {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
};

const share = (part: number, whole: number): number => (whole === 0 ? 0 : (part / whole) * 100);

const outfieldOf = (state: MatchState, team?: Team): PlayerRuntime[] =>
  state.players.filter((player) => player.profile.position !== "goalkeeper"
    && (team === undefined || player.team === team));

/**
 * O dever aponta para um CORPO — a bola, o marcado — e não para a forma do time. Estes trocam de
 * dono legitimamente a cada disputa, então o remanejamento deles não é instabilidade: é o jogo.
 */
const FOLLOWS_A_BODY: ReadonlySet<AssignmentDuty> = new Set<AssignmentDuty>([
  "carry", "receive", "press", "trackRunner",
]);

interface DutyPhoto {
  duty: AssignmentDuty;
  cellKey: string;
  zone: AssignmentZone;
  posture: TeamPosture;
}

const simulate = (seed: number) => {
  const state = createMatchState(referenceMatchConfig(seed));

  const planIntervals: number[] = [];
  const lastPlanAt = new Map<Team, number>();
  const photo = new Map<string, DutyPhoto>();
  const dutyLifetimes: number[] = [];
  const cellLifetimes: number[] = [];
  const dutyStartedAt = new Map<string, number>();
  const cellStartedAt = new Map<string, number>();
  let cellChanges = 0;
  let cellSamples = 0;
  const anchorJumps: number[] = [];
  // A métrica central: quantos metros a âncora atribuída anda POR SEGUNDO, por decisão de
  // atribuição. As duas células são medidas na MESMA colocação, para descontar o deslize contínuo
  // do bloco — o que sobra é só o remanejamento.
  let reassignmentMetres = 0;
  let reassignmentPlayerSeconds = 0;
  let reshuffledOnFlip = 0;
  let comparedOnFlip = 0;

  const realWidth: number[] = [];
  const anchorWidth: number[] = [];
  const anchorError: number[] = [];
  const targetGap: number[] = [];
  const paceCount = new Map<string, number>();
  const nearBall: number[] = [];
  const nearestMate: number[] = [];
  const nearestAny: number[] = [];
  let contactTicks = 0;
  let bodyTicks = 0;
  let markerOnCarrier = 0;
  let carrierSamples = 0;
  const supportDrift: number[] = [];
  const lastSupport = new Map<string, { target: Vec2; carrier: Vec2; at: number }>();
  const reversalHistory = new Map<string, Vec2>();
  let reversals = 0;
  let movingWindows = 0;
  // A pergunta direta: a que velocidade o ALVO foge do corpo? Acima da velocidade de corrida do
  // jogador, chegar nele é impossível por construção — e nenhuma cinemática de chegada resolve.
  const targetSpeedByIntent = new Map<string, { metres: number; seconds: number }>();
  const lastTarget = new Map<string, { target: Vec2; at: number; plan: unknown }>();
  const replanJumps: number[] = [];
  const replanJumpByIntent = new Map<string, number[]>();
  // Discriminador: o salto vem do PLANO recongelar um deslocamento, ou da própria função de
  // decisão ser descontínua? Isto mede a saída crua de `supportTarget`, sem o plano no meio.
  const rawSupportJumps: number[] = [];
  const lastRawSupport = new Map<string, { target: Vec2; at: number }>();

  let nextSample = 0;
  let nextReversalSample = 0;

  while (!state.finished) {
    stepMatch(state, FIXED_STEP);

    // Transição de plano: detectada a cada tique, porque a mediana do intervalo (0,25 s) é menor
    // que o passo de amostragem das demais métricas.
    for (const team of ["blue", "coral"] as const) {
      const plan = state.tactics[team].collectivePlan;
      if (!plan) continue;
      const previousPlanAt = lastPlanAt.get(team);
      if (previousPlanAt === plan.startedAt) continue;
      if (previousPlanAt !== undefined) planIntervals.push(plan.startedAt - previousPlanAt);
      lastPlanAt.set(team, plan.startedAt);

      let flipped = 0;
      let comparedHere = 0;
      for (const player of outfieldOf(state, team)) {
        const assignment = plan.assignments[player.profile.id];
        if (!assignment) continue;
        const id = player.profile.id;
        const before = photo.get(id);
        const key = cellKey(assignment.zone);

        if (before && before.duty !== assignment.duty) {
          dutyLifetimes.push(state.elapsed - (dutyStartedAt.get(id) ?? state.elapsed));
          dutyStartedAt.set(id, state.elapsed);
        } else if (!before) dutyStartedAt.set(id, state.elapsed);

        if (before && before.cellKey !== key) {
          cellLifetimes.push(state.elapsed - (cellStartedAt.get(id) ?? state.elapsed));
          cellStartedAt.set(id, state.elapsed);
        } else if (!before) cellStartedAt.set(id, state.elapsed);

        if (before && previousPlanAt !== undefined) {
          cellSamples += 1;
          const elapsed = plan.startedAt - previousPlanAt;
          const postureFlipped = before.posture !== plan.posture;
          const positional = !FOLLOWS_A_BODY.has(before.duty) && !FOLLOWS_A_BODY.has(assignment.duty);
          // As duas células medidas na MESMA colocação: o que sobra é só o remanejamento, sem o
          // deslize contínuo do bloco atrás da bola.
          const moved = metres(distance(
            cellAnchor(before.zone, team, plan.placement),
            cellAnchor(assignment.zone, team, plan.placement),
          ));
          if (before.cellKey !== key) {
            cellChanges += 1;
            anchorJumps.push(moved);
          }
          if (positional && !postureFlipped && elapsed > 0) {
            reassignmentMetres += moved;
            reassignmentPlayerSeconds += elapsed;
          }
          if (postureFlipped) {
            comparedHere += 1;
            if (before.duty !== assignment.duty) flipped += 1;
          }
        }

        photo.set(id, { duty: assignment.duty, cellKey: key, zone: { ...assignment.zone }, posture: plan.posture });
      }
      if (comparedHere > 0) {
        reshuffledOnFlip += flipped;
        comparedOnFlip += comparedHere;
      }
    }

    if (state.elapsed >= nextReversalSample) {
      nextReversalSample = state.elapsed + 0.25;
      for (const player of outfieldOf(state)) {
        const previous = reversalHistory.get(player.profile.id);
        if (previous && length(player.velocity) > 1.5 && length(previous) > 1.5) {
          movingWindows += 1;
          if (dot(player.velocity, previous) < 0) reversals += 1;
        }
        reversalHistory.set(player.profile.id, { ...player.velocity });
      }
    }

    if (state.elapsed < nextSample) continue;
    nextSample = state.elapsed + 0.1;
    if (state.restart && !state.restart.ballInPlay) continue;

    const all = outfieldOf(state);
    nearBall.push(all.filter((player) => distance(player.position, state.ball.position) < 6 * METRES).length);

    for (const player of all) {
      paceCount.set(player.pace, (paceCount.get(player.pace) ?? 0) + 1);
      bodyTicks += 1;
      let mate = Number.POSITIVE_INFINITY;
      let any = Number.POSITIVE_INFINITY;
      let touching = false;
      for (const other of all) {
        if (other === player) continue;
        const gap = distance(player.position, other.position);
        if (gap < any) any = gap;
        if (other.team === player.team && gap < mate) mate = gap;
        if (gap < player.radius + other.radius + 0.05) touching = true;
      }
      nearestMate.push(metres(mate));
      nearestAny.push(metres(any));
      if (touching) contactTicks += 1;
      const target = resolvePlanDecision(player, state).movementTarget;
      targetGap.push(metres(distance(player.position, target)));

      const seen = lastTarget.get(player.profile.id);
      if (seen && state.elapsed > seen.at) {
        const moved = metres(distance(target, seen.target));
        // Salto na troca de plano e deriva dentro do mesmo plano são coisas diferentes: o primeiro
        // é a decisão mudando de ideia, o segundo é o alvo perseguindo uma referência viva.
        const intent = player.plan?.intent ?? "-";
        if (seen.plan !== player.plan) {
          replanJumps.push(moved);
          const bucket = replanJumpByIntent.get(intent) ?? [];
          bucket.push(moved);
          replanJumpByIntent.set(intent, bucket);
        } else {
          const bucket = targetSpeedByIntent.get(intent) ?? { metres: 0, seconds: 0 };
          bucket.metres += moved;
          bucket.seconds += state.elapsed - seen.at;
          targetSpeedByIntent.set(intent, bucket);
        }
      }
      lastTarget.set(player.profile.id, { target: { ...target }, at: state.elapsed, plan: player.plan });
    }

    for (const team of ["blue", "coral"] as const) {
      const plan = state.tactics[team].collectivePlan;
      if (!plan || plan.posture !== "inPossession") continue;
      const squad = outfieldOf(state, team);
      const bodies = squad.map((player) => player.position.y);
      const anchors = squad.map((player) => assignedAnchor(plan, player).y);
      realWidth.push(metres(Math.max(...bodies) - Math.min(...bodies)));
      anchorWidth.push(metres(Math.max(...anchors) - Math.min(...anchors)));
      for (const player of squad) {
        anchorError.push(metres(distance(player.position, assignedAnchor(plan, player))));
      }
    }

    const carrier = state.players.find((player) => player.profile.id === state.ball.controllerId) ?? null;
    if (!carrier || carrier.profile.position === "goalkeeper") {
      lastSupport.clear();
      continue;
    }
    carrierSamples += 1;
    const opponents = outfieldOf(state, carrier.team === "blue" ? "coral" : "blue");
    markerOnCarrier += opponents.filter((player) => player.plan?.intent === "marking"
      && distance(player.position, carrier.position) < 8 * METRES).length;

    for (const mate of outfieldOf(state, carrier.team)) {
      if (mate === carrier || mate.plan?.intent !== "supporting") {
        lastSupport.delete(mate.profile.id);
        continue;
      }
      const raw = supportTarget(mate, carrier, state).target;
      const seenRaw = lastRawSupport.get(mate.profile.id);
      if (seenRaw && state.elapsed - seenRaw.at < 0.15) rawSupportJumps.push(metres(distance(raw, seenRaw.target)));
      lastRawSupport.set(mate.profile.id, { target: { ...raw }, at: state.elapsed });

      const target = resolvePlanDecision(mate, state).movementTarget;
      const seen = lastSupport.get(mate.profile.id);
      if (seen && state.elapsed - seen.at < 1.2) {
        const carrierMoved = distance(carrier.position, seen.carrier);
        if (carrierMoved > 1) supportDrift.push(distance(target, seen.target) / carrierMoved);
      }
      lastSupport.set(mate.profile.id, { target: { ...target }, carrier: { ...carrier.position }, at: state.elapsed });
    }
  }

  return {
    planIntervals, dutyLifetimes, cellLifetimes, cellChanges, cellSamples, anchorJumps,
    reassignmentMetres, reassignmentPlayerSeconds, reshuffledOnFlip, comparedOnFlip,
    realWidth, anchorWidth, anchorError, targetGap, paceCount, nearBall, nearestMate, nearestAny,
    contactTicks, bodyTicks, markerOnCarrier, carrierSamples, supportDrift, reversals, movingWindows,
    targetSpeedByIntent, replanJumps, replanJumpByIntent, rawSupportJumps,
  };
};

type Run = ReturnType<typeof simulate>;

describe("diagnóstico de movimento", () => {
  it.skip("mede se o time executa a forma que o plano desenha, e a que custo", () => {
    const runs = SEEDS.map(simulate);
    const all = (pick: (run: Run) => number[]): number[] => runs.flatMap(pick);
    const total = (pick: (run: Run) => number): number => runs.reduce((sum, run) => sum + pick(run), 0);
    const round = (value: number): string => value.toFixed(2);

    const paces = new Map<string, number>();
    let paceTotal = 0;
    for (const run of runs) {
      for (const [pace, count] of run.paceCount) paces.set(pace, (paces.get(pace) ?? 0) + count);
      paceTotal += [...run.paceCount.values()].reduce((sum, count) => sum + count, 0);
    }
    const gaps = all((run) => run.targetGap);
    const crowd = all((run) => run.nearBall);
    const intents = new Map<string, { metres: number; seconds: number }>();
    const jumps = new Map<string, number[]>();
    for (const run of runs) {
      for (const [intent, bucket] of run.targetSpeedByIntent) {
        const total = intents.get(intent) ?? { metres: 0, seconds: 0 };
        intents.set(intent, { metres: total.metres + bucket.metres, seconds: total.seconds + bucket.seconds });
      }
      for (const [intent, values] of run.replanJumpByIntent) {
        jumps.set(intent, [...(jumps.get(intent) ?? []), ...values]);
      }
    }

    const report = {
      estabilidade: {
        "intervalo real entre planos (s)": round(average(all((run) => run.planIntervals))),
        "  mediana": round(quantile(all((run) => run.planIntervals), 0.5)),
        "vida média de um DEVER (s)": round(average(all((run) => run.dutyLifetimes))),
        "vida média de uma CÉLULA (s)": round(average(all((run) => run.cellLifetimes))),
        "% que troca de célula por plano": round(share(total((run) => run.cellChanges), total((run) => run.cellSamples))),
        "salto da âncora na troca (m)": round(average(all((run) => run.anchorJumps))),
        "VELOCIDADE DE REMANEJAMENTO (m/s)": round(
          total((run) => run.reassignmentMetres) / Math.max(1e-9, total((run) => run.reassignmentPlayerSeconds)),
        ),
        "% remanejado na troca de posse": round(
          share(total((run) => run.reshuffledOnFlip), total((run) => run.comparedOnFlip)),
        ),
      },
      forma: {
        "largura com bola — corpos (m)": round(average(all((run) => run.realWidth))),
        "largura com bola — âncoras (m)": round(average(all((run) => run.anchorWidth))),
        "erro à âncora atribuída (m)": round(average(all((run) => run.anchorError))),
        "  p90": round(quantile(all((run) => run.anchorError), 0.9)),
      },
      alvo: {
        "velocidade do alvo por intenção (m/s)": Object.fromEntries([...intents.entries()]
          .sort((first, second) => second[1].metres / second[1].seconds - first[1].metres / first[1].seconds)
          .map(([intent, bucket]) => [intent, round(bucket.metres / Math.max(1e-9, bucket.seconds))])),
        "salto do alvo na troca de plano (m)": round(average(all((run) => run.replanJumps))),
        "  p90": round(quantile(all((run) => run.replanJumps), 0.9)),
        "salto na troca de plano, por intenção (m · nº)": Object.fromEntries([...jumps.entries()]
          .sort((first, second) => average(second[1]) - average(first[1]))
          .map(([intent, values]) => [intent, `${round(average(values))} · ${values.length}`])),
      },
      execucao: {
        "distância ao alvo (m)": round(average(gaps)),
        "% do tempo a menos de 2 m do alvo": round(share(gaps.filter((gap) => gap < 2).length, gaps.length)),
        "% de janelas de 0,25 s com inversão": round(share(total((run) => run.reversals), total((run) => run.movingWindows))),
        ritmo: Object.fromEntries([...paces.entries()]
          .sort((first, second) => second[1] - first[1])
          .map(([pace, count]) => [pace, `${round(share(count, paceTotal))}%`])),
      },
      amontoado: {
        "jogadores a menos de 6 m da bola": round(average(crowd)),
        "  p90": round(quantile(crowd, 0.9)),
        "  % das amostras com 5 ou mais": round(share(crowd.filter((count) => count >= 5).length, crowd.length)),
        "% do tempo encostado em alguém": round(share(total((run) => run.contactTicks), total((run) => run.bodyTicks))),
        "distância ao mais próximo (m)": round(average(all((run) => run.nearestAny))),
        "  p10": round(quantile(all((run) => run.nearestAny), 0.1)),
        "distância ao companheiro mais próximo (m)": round(average(all((run) => run.nearestMate))),
        "marcadores colados no portador, por amostra": round(
          total((run) => run.markerOnCarrier) / Math.max(1, total((run) => run.carrierSamples)),
        ),
      },
      apoio: {
        "arrasto do alvo pelo portador (1 = colado)": round(average(all((run) => run.supportDrift))),
        "salto CRU de supportTarget entre amostras de 0,1 s (m)": round(average(all((run) => run.rawSupportJumps))),
        "  p90": round(quantile(all((run) => run.rawSupportJumps), 0.9)),
      },
    };
    // eslint-disable-next-line no-console
    console.info("MOVEMENT_DIAGNOSTICS", JSON.stringify(report, null, 2));
    expect(report).toBeTruthy();
  }, 900_000);
});
