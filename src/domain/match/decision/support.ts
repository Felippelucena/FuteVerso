import { FIELD, TACTICS } from "../config";
import { add, blend, distance, lerp } from "../../shared/math";
import type { AssignmentDuty, DecisionReason, MatchState, PlayerRuntime, TargetFrame, Vec2 } from "../model";
import { assignedAnchor, attackDirection } from "../runtime/formation-geometry";
import { clampToField, edgeRisk, fieldX } from "../runtime/pitch";
import { predictPlayerPosition, predictionHorizon } from "../runtime/prediction";
import { assignmentOf } from "../systems/assignment-system";
import { crowdShift, perceptionDepth } from "./shared";

/**
 * Onde se oferecer quando o time tem a bola e ela não é sua. O alvo sai do DEVER que o coletivo
 * entregou — não da função do atleta —, e a âncora é a célula em que ele foi encarregado de
 * viver agora, que é o que faz o bloco inteiro deslizar com o canal e subir com a fase.
 */

/**
 * Profundidade do apoio por dever, em percentual da largura do campo à frente do portador.
 * Antes vinha de `profile.role`, que tem três valores e não sabia o que o time estava pedindo:
 * agora vem da incumbência, que é o que o coletivo de fato decidiu para este jogador agora.
 */
const DUTY_DEPTH: Record<AssignmentDuty, { fast: number; final: number; base: number }> = {
  runInBehind: { fast: 33, final: 28, base: 23 },
  overlap: { fast: 30, final: 26, base: 22 },
  width: { fast: 18, final: 15, base: 12 },
  support: { fast: 12, final: 9, base: 7 },
  restDefense: { fast: -22, final: -24, base: -18 },
  // A tabela vive logo atrás da bola: perto o bastante para a devolução sair de primeira, longe
  // o bastante para o marcador do portador não cobrir os dois.
  recycle: { fast: -5, final: -7, base: -6 },
  holdLine: { fast: 8, final: 6, base: 4 },
  // Deveres que nunca chegam aqui (quem tem a bola, quem pressiona, o goleiro) ficam neutros.
  carry: { fast: 0, final: 0, base: 0 },
  receive: { fast: 0, final: 0, base: 0 },
  press: { fast: 0, final: 0, base: 0 },
  trackRunner: { fast: 0, final: 0, base: 0 },
  goalkeep: { fast: 0, final: 0, base: 0 },
};

export const supportTarget = (
  player: PlayerRuntime,
  controller: PlayerRuntime,
  state: MatchState,
): { target: Vec2; frame: TargetFrame; reason: DecisionReason; burst: boolean } => {
  const direction = attackDirection(player.team);
  const collective = state.tactics[player.team].collectivePlan;
  const assignment = assignmentOf(collective, player.profile.id);
  // A âncora do apoio é a célula que o coletivo entregou, não a posição fixa da escalação. É
  // ela que faz o bloco inteiro deslizar com o canal de ataque e subir com a fase.
  const anchor = assignedAnchor(collective, player);
  const duty = assignment?.duty ?? "support";
  const supportDepth = perceptionDepth(player, state.ball.position);
  const phase = state.tactics[player.team].phase;
  const phaseIsFast = phase === "counterAttack";
  const phaseIsFinal = phase === "finalThird";
  const controllerNearEdge = edgeRisk(controller.position);
  const depth = DUTY_DEPTH[duty];
  const roleDepth = fieldX(phaseIsFast ? depth.fast : phaseIsFinal ? depth.final : depth.base);
  const anticipatedRoleDepth = roleDepth * (0.86 + player.profile.mental.anticipation / 500);
  const reason: DecisionReason = assignment?.rationale ?? "giveWidth";
  const horizon = predictionHorizon(player, phaseIsFast ? 0.82 : 0.42);
  const predictedController = predictPlayerPosition(controller, horizon * 0.55);
  // **Profundidade vem do PORTADOR; latitude vem da CÉLULA.** A que distância da bola eu me
  // ofereço é pergunta do lance; que faixa do campo eu ocupo é pergunta do time.
  //
  // A latitude vinha do portador também (`predictedController.y + side * roleWidth`), e era o
  // terceiro atrator concorrente que este arquivo hospedou — depois do `channelY` que os dois
  // comentários acima descrevem. Medido: as âncoras abrem o time a **44,5 m**, os corpos ficavam a
  // **33,5 m**, com **8,9 m** de desvio em y por jogador. Não era a âncora nem a célula: era o
  // bolsão puxando todo mundo para a faixa da bola. O escalonamento lateral que `DUTY_WIDTH`
  // desenhava competia com a grade em vez de somar a ela, e agora é passo de busca de corredor
  // (`laneShift`), não alvo.
  const pocketDepth = predictedController.x + direction * anticipatedRoleDepth;
  if (duty === "restDefense") {
    const gap = fieldX(phase === "buildUp" ? 18 : phase === "progression" ? 20 : phaseIsFast ? 22 : 24);
    const ballLine = state.ball.position.x - direction * gap;
    const transitionThreats = state.players.filter((candidatePlayer) => candidatePlayer.team !== player.team
      && direction * (state.ball.position.x - candidatePlayer.position.x) > 0
      && distance(candidatePlayer.position, state.ball.position) < fieldX(36)
      && candidatePlayer.profile.position !== "goalkeeper");
    const threat = [...transitionThreats].sort((first, second) => direction > 0
      ? first.position.x - second.position.x
      : second.position.x - first.position.x)[0];
    const threatGuard = threat ? threat.position.x - direction * fieldX(5) : ballLine;
    const safeX = direction > 0 ? Math.min(ballLine, threatGuard, state.ball.position.x - fieldX(7))
      : Math.max(ballLine, threatGuard, state.ball.position.x + fieldX(7));
    return {
      target: clampToField({ x: safeX, y: blend(anchor, { x: safeX, y: state.ball.position.y }, 0.34).y }, 5),
      // A retaguarda não acompanha o portador: ela acompanha a linha da bola, que já é a
      // profundidade da própria célula.
      frame: { anchor, bodyId: null, bodyShare: { x: 0, y: 0 } },
      reason: "restDefense",
      burst: false,
    };
  }
  // A fatia é o peso da mistura em PROFUNDIDADE, e é ela que o plano guarda: bola perto, o apoio
  // vive mais do portador; bola longe, mais da própria célula.
  const carrierShare = 0.65 - supportDepth * 0.4;
  const candidate = { x: lerp(anchor.x, pocketDepth, carrierShare), y: anchor.y };
  // Portador encurralado na linha: quem se recolhe para dentro é quem está DO MESMO LADO que
  // ele — é esse o amontoado. Quem está do outro lado fica onde está, porque é justamente a
  // largura do lado oposto que dá a saída. Puxar todos para o eixo fechava o campo no momento
  // exato em que ele precisava ser aberto, e era uma das razões de o time nunca passar de 30 m.
  const crowdedSide = (candidate.y - FIELD.height / 2) * (controller.position.y - FIELD.height / 2) > 0;
  if (controllerNearEdge > 0.35 && crowdedSide) {
    candidate.y = blend(candidate, { x: candidate.x, y: FIELD.height / 2 }, controllerNearEdge * 0.65).y;
  }
  // A separação entre companheiros saiu daqui para `resolvePlanDecision`: ali ela é recalculada a
  // cada quadro contra posições vivas, em vez de ser congelada no plano — e vale para os vinte e
  // dois, não só para quem apoia. Fugir da cobertura do MARCADOR é outro conceito, e fica.
  //
  // A mesma conta do espaço pessoal, com adversários no lugar de companheiros (ver `crowdShift`):
  // uma soma contínua, não o empurrão do mais próximo. Aquele era um `argmax`, trocava de vencedor
  // sem aviso e respondia sozinho por 38% do tremor do alvo de apoio.
  const escapeCover = crowdShift(candidate, state.players, fieldX(7), fieldX(4),
    player.team === "blue" ? "coral" : "blue");
  const target = clampToField(add(candidate, escapeCover), 5);
  const targetGap = distance(player.position, target);
  const forwardProgress = direction * (target.x - player.position.x);
  const transitionAge = state.elapsed - state.controlChangedAt;
  // O rest defense já saiu por cima, com alvo próprio: aqui só passa quem apoia o ataque.
  const transitionRun = phaseIsFast
    && transitionAge < TACTICS.counterAttackWindow * 0.72
    && forwardProgress > fieldX(7)
    && targetGap > fieldX(10);
  const depthRun = (duty === "runInBehind" || duty === "overlap")
    && phase !== "buildUp"
    && forwardProgress > fieldX(8)
    && targetGap > fieldX(11)
    && (phaseIsFinal || phaseIsFast || controller.velocity.x * direction > 2.5);
  const workThreshold = 0.58 - player.profile.mental.intensity / 500;
  const burst = player.sprintEnergy > workThreshold && player.sprintCooldown <= 0 && (transitionRun || depthRun);
  // Em profundidade o alvo acompanha o portador; em latitude, a célula. É esta assimetria que
  // mantém o time largo entre um replanejamento e o outro — o alvo já nascia ancorado na célula, e
  // era o quadro que o rebocava de volta para a faixa da bola.
  return {
    target,
    frame: { anchor, bodyId: controller.profile.id, bodyShare: { x: carrierShare, y: 0 } },
    reason,
    burst,
  };
};
