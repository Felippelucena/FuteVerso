import { FIELD, PHYSICS } from "../../domain/match/config";
import { clamp, distance, length } from "../../domain/shared/math";
import { goalkeeperJumpHeight } from "../../domain/match/systems/goalkeeper-system";
import type { MatchState, PlayerRuntime, Team, Vec2 } from "../../domain/match/model";

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
    const worldWidth = FIELD.width + FIELD.goalDepth * 2 + 8;
    const worldHeight = FIELD.height + 8;
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

  render(state: MatchState): void {
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
    if (state.kickoffTimer > 0) this.drawKickoff(state.kickoffTimer);
  }

  private updateBallTrail(state: MatchState): void {
    const current = { position: { ...state.ball.position }, height: state.ball.height, time: state.elapsed };
    if (state.ball.controllerId) {
      this.ballTrail = [current];
      this.lastTrailTime = state.elapsed;
      return;
    }
    const latest = this.ballTrail[this.ballTrail.length - 1];
    const restarted = state.elapsed < this.lastTrailTime
      || state.kickoffTimer > 0
      || (latest && distance(latest.position, current.position) > FIELD.width * 0.2);
    if (restarted) this.ballTrail = [];
    const sampleNeeded = !latest
      || current.time - latest.time >= 0.025
      || distance(latest.position, current.position) >= 0.75;
    if (sampleNeeded && state.kickoffTimer <= 0) this.ballTrail.push(current);
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
    ctx.strokeRect(left, top, width, height);

    ctx.beginPath();
    ctx.moveTo(this.x(FIELD.width / 2), top);
    ctx.lineTo(this.x(FIELD.width / 2), top + height);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(this.x(FIELD.width / 2), this.y(FIELD.height / 2), this.scale * 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(235, 247, 238, 0.9)";
    ctx.beginPath();
    ctx.arc(this.x(FIELD.width / 2), this.y(FIELD.height / 2), this.scale * 0.38, 0, Math.PI * 2);
    ctx.fill();

    for (const side of [0, FIELD.width]) {
      const direction = side === 0 ? 1 : -1;
      const penaltyTop = (FIELD.height - FIELD.penaltyWidth) / 2;
      ctx.strokeRect(
        this.x(side + (direction < 0 ? -FIELD.penaltyDepth : 0)),
        this.y(penaltyTop),
        FIELD.penaltyDepth * this.scale,
        FIELD.penaltyWidth * this.scale,
      );
      ctx.strokeRect(
        this.x(side + (direction < 0 ? -FIELD.goalAreaDepth : 0)),
        this.y(FIELD.goalTop),
        FIELD.goalAreaDepth * this.scale,
        (FIELD.goalBottom - FIELD.goalTop) * this.scale,
      );
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
      for (let y = FIELD.goalTop + 5.4; y < FIELD.goalBottom; y += 5.4) {
        ctx.beginPath();
        ctx.moveTo(edge, this.y(y));
        ctx.lineTo(back, this.y(y));
        ctx.stroke();
      }
      for (let depth = 2.7; depth < FIELD.goalDepth; depth += 2.7) {
        const netX = edge + side * depth * this.scale;
        ctx.beginPath();
        ctx.moveTo(netX, top);
        ctx.lineTo(netX, top + height);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
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
    ctx.fillStyle = `rgba(0, 0, 0, ${lift > 0 ? 0.16 : 0.24})`;
    ctx.beginPath();
    ctx.ellipse(x + radius * 0.18, y + radius * 0.58, radius * 0.95, radius * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
    if (lift > 0) ctx.translate(0, -lift);

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
    ctx.fillText(String(player.profile.number), x, y - radius * 0.05);
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

  private drawKickoff(timer: number): void {
    const ctx = this.context;
    const alpha = clamp(timer / 1.1, 0, 1);
    ctx.fillStyle = `rgba(9, 13, 11, ${alpha * 0.52})`;
    ctx.fillRect(this.x(0), this.y(0), FIELD.width * this.scale, FIELD.height * this.scale);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.font = `700 ${Math.max(18, this.scale * 3)}px ui-sans-serif, system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SAIDA", this.x(FIELD.width / 2), this.y(FIELD.height / 2));
  }
}
