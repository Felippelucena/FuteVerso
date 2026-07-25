import { FIELD, PHYSICS } from "../config";
import type { Ball, Vec2 } from "../model";

/**
 * A baliza como corpo físico — dois postes e o travessão — e a janela livre entre eles.
 *
 * Bola inteira dentro das bordas internas da madeira é gol; bola que encosta na madeira
 * ricocheteia pelo ângulo do impacto, e o mesmo ricochete tanto a joga para dentro quanto para
 * fora. Não há caso especial para "bateu na trave" nem para "bateu no travessão": os três
 * membros são cilindros paralelos a um eixo, então o encontro se resolve sempre no plano
 * perpendicular a esse eixo — círculo (secção da bola) contra círculo (secção da madeira).
 * Muda só qual par de coordenadas forma o plano.
 *
 * O eixo vertical tem calibragem própria (ver config), então a secção do travessão é um
 * círculo em unidades mistas. A diferença de escala é menor que a espessura de uma trave e
 * não vale um caso especial.
 */

type Axis = "x" | "y" | "z";

/** Posição no espaço: o plano do gramado (x, y) mais a altura (z). */
interface Point3 {
  x: number;
  y: number;
  z: number;
}

interface FrameMember {
  /** Eixo do cilindro. O contato se resolve no plano formado pelos outros dois. */
  axis: Axis;
  /** Um ponto do eixo — só as coordenadas perpendiculares importam. */
  anchor: Point3;
  /** Trecho ocupado ao longo do eixo. */
  from: number;
  to: number;
}

const PERPENDICULAR: Record<Axis, readonly [Axis, Axis]> = {
  x: ["y", "z"],
  y: ["x", "z"],
  z: ["x", "y"],
};

const CROSSBAR_HEIGHT = FIELD.goalHeight + FIELD.postRadius;
const TOP_POST_Y = FIELD.goalTop - FIELD.postRadius;
const BOTTOM_POST_Y = FIELD.goalBottom + FIELD.postRadius;

/** Raio de contato: a bola encosta na madeira quando os dois círculos se tocam. */
const CONTACT_RADIUS = FIELD.postRadius + FIELD.ballRadius;

const frameAt = (goalLineX: number): FrameMember[] => [
  { axis: "z", anchor: { x: goalLineX, y: TOP_POST_Y, z: 0 }, from: 0, to: CROSSBAR_HEIGHT },
  { axis: "z", anchor: { x: goalLineX, y: BOTTOM_POST_Y, z: 0 }, from: 0, to: CROSSBAR_HEIGHT },
  { axis: "y", anchor: { x: goalLineX, y: 0, z: CROSSBAR_HEIGHT }, from: TOP_POST_Y, to: BOTTOM_POST_Y },
];

const FRAME: readonly FrameMember[] = [...frameAt(0), ...frameAt(FIELD.width)];

/**
 * Janela por onde a bola INTEIRA passa sem tocar a madeira. É o alvo real de quem finaliza e o
 * critério de gol: fora dela a bola ou bateu na baliza (e o ricochete já a desviou) ou passou
 * por cima/ao lado, e aí é bola fora de jogo.
 */
export const GOAL_MOUTH = {
  top: FIELD.goalTop + FIELD.ballRadius,
  bottom: FIELD.goalBottom - FIELD.ballRadius,
  ceiling: FIELD.goalHeight - FIELD.ballRadius,
} as const;

export const insideGoalMouth = (y: number, height: number): boolean =>
  y > GOAL_MOUTH.top && y < GOAL_MOUTH.bottom && height >= 0 && height < GOAL_MOUTH.ceiling;

/**
 * Fração do trajeto em que a bola encosta no membro, ou `null` se não encosta. Só a raiz de
 * ENTRADA no raio de contato conta: quem já está dentro dele (a bola que acabou de ricochetear
 * e ainda não se afastou) ou está saindo não colide de novo, e assim nada gruda na madeira.
 */
const contactFraction = (member: FrameMember, from: Point3, to: Point3): number | null => {
  const [u, v] = PERPENDICULAR[member.axis];
  const offsetU = from[u] - member.anchor[u];
  const offsetV = from[v] - member.anchor[v];
  const stepU = to[u] - from[u];
  const stepV = to[v] - from[v];
  const a = stepU * stepU + stepV * stepV;
  if (a < 1e-9) return null;
  const b = 2 * (offsetU * stepU + offsetV * stepV);
  const c = offsetU * offsetU + offsetV * offsetV - CONTACT_RADIUS * CONTACT_RADIUS;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const fraction = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (fraction < 0 || fraction > 1) return null;
  const along = from[member.axis] + (to[member.axis] - from[member.axis]) * fraction;
  return along >= member.from && along <= member.to ? fraction : null;
};

const reflect = (member: FrameMember, contact: Point3, velocity: Point3): Point3 => {
  const [u, v] = PERPENDICULAR[member.axis];
  // O contato está exatamente a CONTACT_RADIUS do eixo, então dividir por ele já normaliza.
  const normalU = (contact[u] - member.anchor[u]) / CONTACT_RADIUS;
  const normalV = (contact[v] - member.anchor[v]) / CONTACT_RADIUS;
  const impulse = (1 + PHYSICS.goalFrameRestitution) * (velocity[u] * normalU + velocity[v] * normalV);
  const bounced = { ...velocity };
  bounced[u] = velocity[u] - impulse * normalU;
  bounced[v] = velocity[v] - impulse * normalV;
  return bounced;
};

/**
 * Resolve o trajeto da bola contra as duas balizas. Havendo contato, recua a bola até o ponto
 * de impacto e reflete a velocidade — o resto do passo é abandonado, que a menos de um tick de
 * percurso não muda nada e evita atravessar a madeira.
 */
export const resolveGoalFrameContact = (ball: Ball, previousPosition: Vec2, previousHeight: number): boolean => {
  const from: Point3 = { x: previousPosition.x, y: previousPosition.y, z: previousHeight };
  const to: Point3 = { x: ball.position.x, y: ball.position.y, z: ball.height };
  if (Math.min(from.x, to.x) > CONTACT_RADIUS && Math.max(from.x, to.x) < FIELD.width - CONTACT_RADIUS) return false;
  let hit: { member: FrameMember; fraction: number } | null = null;
  for (const member of FRAME) {
    const fraction = contactFraction(member, from, to);
    if (fraction !== null && (hit === null || fraction < hit.fraction)) hit = { member, fraction };
  }
  if (!hit) return false;
  const contact: Point3 = {
    x: from.x + (to.x - from.x) * hit.fraction,
    y: from.y + (to.y - from.y) * hit.fraction,
    z: from.z + (to.z - from.z) * hit.fraction,
  };
  const bounced = reflect(hit.member, contact, { x: ball.velocity.x, y: ball.velocity.y, z: ball.verticalVelocity });
  ball.position = { x: contact.x, y: contact.y };
  ball.height = Math.max(0, contact.z);
  ball.velocity = { x: bounced.x, y: bounced.y };
  ball.verticalVelocity = bounced.z;
  return true;
};
