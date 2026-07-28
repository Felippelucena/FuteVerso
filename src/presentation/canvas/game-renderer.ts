import { FIELD, GOALKEEPING, PHYSICS, RESTART } from "../../domain/match/config";
import { clamp, distance, length } from "../../domain/shared/math";
import { goalkeeperJumpHeight, progressToX } from "../../domain/match";
import type { MatchState, PlayerRuntime, Team, Vec2 } from "../../domain/match/model";
import type { OffsideReplay } from "../../application/match/match-session";
import { PITCH_MARKINGS, PITCH_SPOT_RADIUS } from "./pitch-markings";

const COLORS: Record<Team, { fill: string; dark: string; light: string }> = {
  blue: { fill: "#3b82f6", dark: "#172b4d", light: "#dbeafe" },
  coral: { fill: "#f36f56", dark: "#4a211d", light: "#ffebe6" },
};

export class GameRenderer {
  private readonly context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private ballTrail: Array<{ position: Vec2; height: number; time: number }> = [];
  private lastTrailTime = -1;
  private elapsed = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D nao esta disponivel.");
    this.context = context;
  }

  resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const displayWidth = Math.max(1, Math.round(bounds.width * dpr));
    const displayHeight = Math.max(1, Math.round(bounds.height * dpr));
    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
    }
    this.width = displayWidth;
    this.height = displayHeight;
    // Inclui a faixa de segurança (runOff) além das linhas: é onde o cobrador do lateral/escanteio
    // fica, do lado de fora, e precisa caber na tela.
    const worldWidth = FIELD.width + Math.max(FIELD.goalDepth, FIELD.runOff) * 2 + 8;
    const worldHeight = FIELD.height + FIELD.runOff * 2 + 8;
    this.scale = Math.min(this.width / worldWidth, this.height / worldHeight);
    this.offsetX = (this.width - FIELD.width * this.scale) / 2;
    this.offsetY = (this.height - FIELD.height * this.scale) / 2;
  }

  private x(value: number): number {
    return this.offsetX + value * this.scale;
  }

  private y(value: number): number {
    return this.offsetY + value * this.scale;
  }

  render(state: MatchState, offsideReplay: OffsideReplay | null = null): void {
    if (this.width === 0) this.resize();
    this.elapsed = state.elapsed;
    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawSurroundings();
    this.drawPitch();
    this.drawGoals();
    this.updateBallTrail(state);
    for (const player of state.players) {
      const hasPossession = state.ball.controllerId === player.profile.id;
      const isBallTarget = !hasPossession && !state.ball.controllerId && (
        state.ball.dribbleOwnerId === player.profile.id
        || state.pendingPass?.receiverId === player.profile.id
      );
      this.drawPlayer(player, hasPossession, isBallTarget);
    }
    this.drawBall(state);
    // O apito em si não desenha nada — como na falta, a jogada só fica parada. O que se lê é a
    // revisão, e ela acontece no quadro do passe.
    if (offsideReplay) this.drawOffsideFlag(state, offsideReplay);
    else if (state.restart && !state.restart.ballInPlay) this.drawRestart(state);
  }

  private updateBallTrail(state: MatchState): void {
    const current = { position: { ...state.ball.position }, height: state.ball.height, time: state.elapsed };
    if (state.ball.controllerId) {
      this.ballTrail = [current];
      this.lastTrailTime = state.elapsed;
      return;
    }
    const ballParked = state.restart !== null && !state.restart.ballInPlay;
    const latest = this.ballTrail[this.ballTrail.length - 1];
    const restarted = state.elapsed < this.lastTrailTime
      || ballParked
      || (latest && distance(latest.position, current.position) > FIELD.width * 0.2);
    if (restarted) this.ballTrail = [];
    const sampleNeeded = !latest
      || current.time - latest.time >= 0.025
      || distance(latest.position, current.position) >= 0.75;
    if (sampleNeeded && !ballParked) this.ballTrail.push(current);
    this.ballTrail = this.ballTrail.filter((sample) => current.time - sample.time <= 0.72).slice(-24);
    this.lastTrailTime = state.elapsed;
  }

  private drawSurroundings(): void {
    const ctx = this.context;
    ctx.fillStyle = "#17201c";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = "rgba(255, 255, 255, 0.025)";
    for (let x = 0; x < this.width; x += 28 * (this.width / 1000)) {
      ctx.fillRect(x, 0, 1, this.height);
    }
  }

  private drawPitch(): void {
    const ctx = this.context;
    const left = this.x(0);
    const top = this.y(0);
    const width = FIELD.width * this.scale;
    const height = FIELD.height * this.scale;

    // Faixa de segurança (grama fora das linhas), sob o campo: onde o lateral e o escanteio são
    // cobrados, do lado de fora.
    ctx.fillStyle = "#1e5236";
    ctx.fillRect(
      this.x(-FIELD.runOff),
      this.y(-FIELD.runOff),
      (FIELD.width + FIELD.runOff * 2) * this.scale,
      (FIELD.height + FIELD.runOff * 2) * this.scale,
    );

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();
    ctx.fillStyle = "#276a45";
    ctx.fillRect(left, top, width, height);
    const stripeWidth = width / 10;
    for (let index = 0; index < 10; index += 2) {
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      ctx.fillRect(left + index * stripeWidth, top, stripeWidth, height);
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(235, 247, 238, 0.85)";
    ctx.lineWidth = Math.max(1.5, this.scale * 0.18);
    ctx.fillStyle = "rgba(235, 247, 238, 0.9)";
    const spotRadius = Math.max(1.2, PITCH_SPOT_RADIUS * this.scale);

    // O que desenhar sai de `pitch-markings`, junto com o campo do editor tático. Aqui só se
    // decide como: régua, escala e pincel.
    for (const mark of PITCH_MARKINGS) {
      ctx.beginPath();
      switch (mark.kind) {
        case "rect":
          ctx.strokeRect(this.x(mark.x), this.y(mark.y), mark.width * this.scale, mark.height * this.scale);
          continue;
        case "line":
          ctx.moveTo(this.x(mark.x1), this.y(mark.y1));
          ctx.lineTo(this.x(mark.x2), this.y(mark.y2));
          break;
        case "circle":
          ctx.arc(this.x(mark.x), this.y(mark.y), mark.radius * this.scale, 0, Math.PI * 2);
          break;
        case "arc":
          ctx.arc(this.x(mark.x), this.y(mark.y), mark.radius * this.scale, mark.from, mark.to);
          break;
        case "spot":
          ctx.arc(this.x(mark.x), this.y(mark.y), spotRadius, 0, Math.PI * 2);
          ctx.fill();
          continue;
      }
      ctx.stroke();
    }
  }

  private drawGoals(): void {
    const ctx = this.context;
    const top = this.y(FIELD.goalTop);
    const height = (FIELD.goalBottom - FIELD.goalTop) * this.scale;
    ctx.save();
    ctx.strokeStyle = "rgba(231, 238, 233, 0.75)";
    ctx.lineWidth = Math.max(1, this.scale * 0.13);
    for (const side of [-1, 1]) {
      const edge = side < 0 ? this.x(0) : this.x(FIELD.width);
      const back = edge + side * FIELD.goalDepth * this.scale;
      ctx.strokeRect(Math.min(edge, back), top, Math.abs(back - edge), height);
      ctx.globalAlpha = 0.35;
      // Malha da rede com passo de ~1,2 m, para a rede acompanhar o tamanho real do gol.
      const mesh = FIELD.unitsPerMeter * 1.2;
      for (let y = FIELD.goalTop + mesh; y < FIELD.goalBottom - mesh * 0.2; y += mesh) {
        ctx.beginPath();
        ctx.moveTo(edge, this.y(y));
        ctx.lineTo(back, this.y(y));
        ctx.stroke();
      }
      for (let depth = mesh; depth < FIELD.goalDepth; depth += mesh) {
        const netX = edge + side * depth * this.scale;
        ctx.beginPath();
        ctx.moveTo(netX, top);
        ctx.lineTo(netX, top + height);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Os postes, onde a bola ricocheteia. Na escala do campo inteiro a madeira real some, então
      // o desenho tem um piso em pixels — é legibilidade, não a medida usada pela física.
      ctx.fillStyle = "rgba(244, 249, 246, 0.95)";
      for (const postY of [FIELD.goalTop - FIELD.postRadius, FIELD.goalBottom + FIELD.postRadius]) {
        ctx.beginPath();
        ctx.arc(edge, this.y(postY), Math.max(2, FIELD.postRadius * this.scale), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawPlayer(player: PlayerRuntime, hasPossession: boolean, isBallTarget: boolean): void {
    const ctx = this.context;
    const colors = COLORS[player.team];
    const x = this.x(player.position.x);
    const y = this.y(player.position.y);
    const radius = player.radius * this.scale;

    ctx.save();
    // An airborne keeper is drawn lifted off his own shadow, so a dive reads as a dive
    // instead of a body sliding across the grass.
    const saveAttempt = player.goalkeeperAttempt;
    const lift = saveAttempt && saveAttempt.outcome === null
      ? goalkeeperJumpHeight(saveAttempt, this.elapsed) * this.scale * 0.9
      : 0;
    // O corpo em voo estica na direção do mergulho: um círculo deslizando não lê como mergulho,
    // por mais longe que vá. A conta é a do próprio voo — quanto mais rápido, mais esticado.
    const flight = saveAttempt && saveAttempt.launchedAt !== null && saveAttempt.launchDirection
      && this.elapsed - saveAttempt.launchedAt < saveAttempt.flightTime
      ? { direction: saveAttempt.launchDirection, speed: length(player.velocity) }
      : null;
    const stretch = flight ? 1 + clamp(flight.speed / GOALKEEPING.diveLaunchSpeed, 0, 1) * 0.75 : 1;
    ctx.fillStyle = `rgba(0, 0, 0, ${lift > 0 ? 0.16 : 0.24})`;
    ctx.beginPath();
    ctx.ellipse(x + radius * 0.18, y + radius * 0.58, radius * 0.95, radius * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
    if (lift > 0) ctx.translate(0, -lift);
    if (flight && stretch > 1.02) {
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(flight.direction.y, flight.direction.x));
      ctx.scale(stretch, 1 / stretch);
      ctx.rotate(-Math.atan2(flight.direction.y, flight.direction.x));
      ctx.translate(-x, -y);
    }

    if (hasPossession || isBallTarget) {
      ctx.strokeStyle = colors.light;
      ctx.globalAlpha = hasPossession ? 0.82 : 0.58;
      ctx.lineWidth = Math.max(1.5, radius * 0.12);
      if (isBallTarget) ctx.setLineDash([radius * 0.45, radius * 0.34]);
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = colors.dark;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.fill;
    ctx.beginPath();
    ctx.arc(x, y - radius * 0.12, radius * 0.82, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = colors.light;
    ctx.lineWidth = Math.max(1.5, radius * 0.18);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + player.facing.x * radius * 1.22, y + player.facing.y * radius * 1.22);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.max(9, radius * 0.86)}px ui-sans-serif, system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(player.shirtNumber), x, y - radius * 0.05);
    ctx.restore();
  }

  private drawBall(state: MatchState): void {
    const ctx = this.context;
    const speed = length(state.ball.velocity);
    const x = this.x(state.ball.position.x);
    const groundY = this.y(state.ball.position.y);
    const y = groundY - state.ball.height * this.scale * 0.62;
    const altitudeScale = 1 + clamp(state.ball.height / 24, 0, 0.28);
    const radius = Math.max(3.4, state.ball.radius * this.scale) * altitudeScale;

    if (this.ballTrail.length > 1 && speed > 4) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let index = 1; index < this.ballTrail.length; index += 1) {
        const previous = this.ballTrail[index - 1];
        const current = this.ballTrail[index];
        const age = clamp((state.elapsed - current.time) / 0.72, 0, 1);
        ctx.strokeStyle = `rgba(255, 224, 111, ${(1 - age) * 0.52})`;
        ctx.lineWidth = Math.max(1.25, radius * (0.2 + (1 - age) * 0.18));
        ctx.beginPath();
        ctx.moveTo(this.x(previous.position.x), this.y(previous.position.y) - previous.height * this.scale * 0.62);
        ctx.lineTo(this.x(current.position.x), this.y(current.position.y) - current.height * this.scale * 0.62);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (state.ball.height > 0.7 || state.ball.verticalVelocity > 2.2) {
      const landingTime = (state.ball.verticalVelocity + Math.sqrt(
        state.ball.verticalVelocity ** 2 + 2 * PHYSICS.gravity * Math.max(0, state.ball.height),
      )) / PHYSICS.gravity;
      const travelFactor = PHYSICS.airBallDrag > 0
        ? (1 - Math.exp(-PHYSICS.airBallDrag * landingTime)) / PHYSICS.airBallDrag
        : landingTime;
      const landing = {
        x: clamp(state.ball.position.x + state.ball.velocity.x * travelFactor, 0, FIELD.width),
        y: clamp(state.ball.position.y + state.ball.velocity.y * travelFactor, 0, FIELD.height),
      };
      ctx.save();
      ctx.strokeStyle = "rgba(255, 230, 132, 0.72)";
      ctx.fillStyle = "rgba(255, 230, 132, 0.08)";
      ctx.lineWidth = Math.max(1.2, radius * 0.18);
      ctx.setLineDash([radius * 0.65, radius * 0.45]);
      ctx.beginPath();
      ctx.ellipse(this.x(landing.x), this.y(landing.y), radius * 1.25, radius * 0.68, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    const shadowScale = clamp(1 - state.ball.height / 14, 0.35, 1);
    ctx.fillStyle = `rgba(0, 0, 0, ${0.25 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(
      x + radius * 0.35,
      groundY + radius * 0.7,
      radius * (0.45 + shadowScale * 0.5),
      radius * (0.22 + shadowScale * 0.24),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = "rgba(255, 220, 92, 0.24)";
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff9e7";
    ctx.strokeStyle = "#26302b";
    ctx.lineWidth = Math.max(1.2, radius * 0.2);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#26302b";
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * A "bandeira": a linha cresce do centro para as pontas no quadro em que a bola saiu do pé, com
   * o infrator destacado e o rótulo do lance. Só existe durante a revisão — desenhá-la a partir de
   * uma vigilância armada a transformaria em overlay de diagnóstico.
   */
  private drawOffsideFlag(state: MatchState, replay: OffsideReplay): void {
    const ctx = this.context;
    const { reveal } = replay;
    // Escurece o gramado como no pontapé de saída, mas de leve: a leitura é a linha, não o texto.
    ctx.fillStyle = `rgba(9, 13, 11, ${0.32 * reveal})`;
    ctx.fillRect(this.x(0), this.y(0), FIELD.width * this.scale, FIELD.height * this.scale);

    const lineX = this.x(progressToX(replay.team, replay.lineProgress));
    const midY = this.y(FIELD.height / 2);
    const half = (FIELD.height / 2) * this.scale * reveal;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 209, 71, 0.95)";
    ctx.lineWidth = Math.max(2, this.scale * 0.4);
    ctx.setLineDash([this.scale * 1.4, this.scale * 0.9]);
    ctx.beginPath();
    ctx.moveTo(lineX, midY - half);
    ctx.lineTo(lineX, midY + half);
    ctx.stroke();
    ctx.setLineDash([]);

    // Anel no jogador impedido, pulsando com o avanço da animação.
    const offender = state.players.find((player) => player.profile.id === replay.offenderId);
    if (offender) {
      const ox = this.x(offender.position.x);
      const oy = this.y(offender.position.y);
      ctx.strokeStyle = "rgba(255, 209, 71, 0.95)";
      ctx.lineWidth = Math.max(1.5, this.scale * 0.28);
      ctx.beginPath();
      ctx.arc(ox, oy, (offender.radius + 1.2) * this.scale * (0.9 + reveal * 0.2), 0, Math.PI * 2);
      ctx.stroke();
    }

    if (reveal > 0.25) {
      ctx.fillStyle = `rgba(255, 209, 71, ${clamp((reveal - 0.25) / 0.35, 0, 1)})`;
      ctx.font = `700 ${Math.max(14, this.scale * 2.2)}px ui-sans-serif, system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("IMPEDIMENTO", this.x(FIELD.width / 2), this.y(FIELD.height * 0.16));
    }
    ctx.restore();
  }

  private drawRestart(state: MatchState): void {
    const restart = state.restart!;
    const ctx = this.context;
    // Some conforme o preparo avança: quanto mais perto da cobrança, mais leve o véu.
    const remaining = restart.startedAt + RESTART.maxSetupSeconds - state.elapsed;
    const alpha = clamp(remaining / RESTART.maxSetupSeconds, 0, 1);
    const label = restart.kind === "throwIn" ? "LATERAL"
      : restart.kind === "corner" ? "ESCANTEIO"
        : restart.kind === "goalKick" ? "TIRO DE META"
          : restart.kind === "freeKick" ? "FALTA"
            : "SAIDA";
    ctx.fillStyle = `rgba(9, 13, 11, ${alpha * 0.4})`;
    ctx.fillRect(this.x(0), this.y(0), FIELD.width * this.scale, FIELD.height * this.scale);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.font = `700 ${Math.max(18, this.scale * 3)}px ui-sans-serif, system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, this.x(FIELD.width / 2), this.y(FIELD.height / 2));
  }
}
