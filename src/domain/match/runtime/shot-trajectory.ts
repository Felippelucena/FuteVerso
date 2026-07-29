import { PHYSICS } from "../config";
import { clamp, distance, lerp, normalize, scale } from "../../shared/math";
import type { PlayerSkills } from "../../roster/model";
import type { ShotTechnique, Vec2 } from "../model";
import { GOAL_MOUTH } from "./goal-frame";

export interface ShotTrajectorySolution {
  velocity: Vec2;
  verticalVelocity: number;
  duration: number;
  targetHeight: number;
  arrivalSpeed: number;
}

export interface PredictedShotPoint {
  position: Vec2;
  height: number;
  verticalVelocity: number;
  speed: number;
}

const travelDuration = (travelDistance: number, launchSpeed: number): number => {
  const drag = PHYSICS.airBallDrag;
  const safeSpeed = Math.max(launchSpeed, travelDistance * drag + 0.5);
  const ratio = clamp(travelDistance * drag / safeSpeed, 0, 0.96);
  return -Math.log(1 - ratio) / drag;
};

/**
 * Quanto cada técnica tira da batida. O cabeceio é o extremo: quem dá velocidade à bola é o passe
 * que chegou, e a testa só a redireciona.
 *
 * O 0,55 não é gosto — sai do alcance que se quer para a cabeçada. Sob a trava da mira o voo tem
 * um teto (a bola precisa descer ao gol sem passar por cima do travessão), e esse teto vira uma
 * distância: com 0,55 um jogador de força média alcança a meta da BORDA DA GRANDE ÁREA e não além.
 * É o que faz o cabeceio ser lance de dentro da área por física, sem uma tabela de alcance própria.
 */
const TECHNIQUE_SPEED: Record<ShotTechnique, number> = {
  placed: 1,
  power: 1,
  volley: 1,
  header: 0.55,
  redirect: 0.82,
};

/** De onde sai a força de cada contato. Cabeçada é tronco e pescoço; o resto é perna. */
const strikeAttribute = (skills: PlayerSkills, technique: ShotTechnique): number =>
  technique === "header" ? skills.strength : skills.kickPower;

/**
 * Velocidade que o contato imprime na bola. Fonte única porque quem **avalia** um chute precisa
 * da mesma velocidade que quem o **executa** — senão a rota que o jogador imaginou ao mirar não é
 * a que sai do pé, e a mira deixa de significar coisa alguma.
 */
export const shotLaunchSpeed = (skills: PlayerSkills, power: number, technique: ShotTechnique): number =>
  lerp(54, 92, power) * (0.78 + strikeAttribute(skills, technique) / 220) * TECHNIQUE_SPEED[technique];

/**
 * A maior altura de chegada que ainda cabe sob a boca do gol o **percurso inteiro**, ou `null`
 * quando nem rasteira cabe — e aí não existe finalização desta distância com esta batida.
 *
 * É a trava física da mira. Sem ela a altura pedida era preferência e a parábola saía como
 * consequência: um cabeceio de 30 m subia a nove unidades (o dobro do travessão), passava por
 * cima do goleiro adiantado e descia na linha exatamente onde ele não alcança. Isso não é chute,
 * é morteiro, e não existe goleiro que o defenda. Com a trava, mirar alto é privilégio de quem
 * está perto ou bate forte — o alcance do chute vira consequência da batida, e não uma tabela.
 */
export const highestAimUnderCrossbar = (
  travelDistance: number,
  originHeight: number,
  launchSpeed: number,
): number | null => {
  if (originHeight >= GOAL_MOUTH.ceiling) return null;
  const duration = travelDuration(travelDistance, launchSpeed);
  const rise = Math.sqrt(2 * PHYSICS.gravity * (GOAL_MOUTH.ceiling - originHeight));
  // Ainda subindo ao cruzar a linha: o ápice fica atrás do gol e o teto é a própria boca.
  if (rise >= PHYSICS.gravity * duration) return GOAL_MOUTH.ceiling;
  const highest = originHeight + rise * duration - 0.5 * PHYSICS.gravity * duration * duration;
  return highest >= 0 ? highest : null;
};

export const solveShotTrajectory = (
  origin: Vec2,
  target: Vec2,
  originHeight: number,
  targetHeight: number,
  desiredSpeed: number,
): ShotTrajectorySolution => {
  const travelDistance = distance(origin, target);
  const duration = travelDuration(travelDistance, desiredSpeed);
  const dragFactor = (1 - Math.exp(-PHYSICS.airBallDrag * duration)) / PHYSICS.airBallDrag;
  const horizontalSpeed = travelDistance / Math.max(0.001, dragFactor);
  const clampedHeight = Math.max(0, targetHeight);
  const verticalVelocity = (clampedHeight - Math.max(0, originHeight) + 0.5 * PHYSICS.gravity * duration * duration)
    / Math.max(0.001, duration);
  return {
    velocity: scale(normalize({ x: target.x - origin.x, y: target.y - origin.y }), horizontalSpeed),
    verticalVelocity,
    duration,
    targetHeight: clampedHeight,
    arrivalSpeed: horizontalSpeed * Math.exp(-PHYSICS.airBallDrag * duration),
  };
};

export const predictShotPoint = (
  origin: Vec2,
  velocity: Vec2,
  originHeight: number,
  verticalVelocity: number,
  seconds: number,
): PredictedShotPoint => {
  const duration = Math.max(0, seconds);
  const dragFactor = (1 - Math.exp(-PHYSICS.airBallDrag * duration)) / PHYSICS.airBallDrag;
  const drag = Math.exp(-PHYSICS.airBallDrag * duration);
  return {
    position: {
      x: origin.x + velocity.x * dragFactor,
      y: origin.y + velocity.y * dragFactor,
    },
    height: Math.max(0, originHeight + verticalVelocity * duration - 0.5 * PHYSICS.gravity * duration * duration),
    verticalVelocity: verticalVelocity - PHYSICS.gravity * duration,
    speed: Math.hypot(velocity.x, velocity.y) * drag,
  };
};

export const timeToX = (originX: number, velocityX: number, targetX: number): number | null => {
  if (Math.abs(velocityX) < 0.001) return null;
  const ratio = (targetX - originX) * PHYSICS.airBallDrag / velocityX;
  if (ratio <= 0 || ratio >= 0.98) return null;
  return -Math.log(1 - ratio) / PHYSICS.airBallDrag;
};
