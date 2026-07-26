import { FIELD } from "../../domain/match/config";
import { html, type Html } from "../app/html";

/**
 * As marcações do gramado em coordenadas de campo — a **descrição**, não o desenho. O canvas da
 * partida e o campo do editor tático leem esta mesma lista, e é isso que impede os dois de
 * divergirem: um risco novo aparece nos dois ou em nenhum.
 */
export type PitchMark =
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "circle"; x: number; y: number; radius: number }
  | { kind: "arc"; x: number; y: number; radius: number; from: number; to: number }
  /** Marca pintada (meio-campo, pênalti). O raio é escolha de desenho, não do regulamento. */
  | { kind: "spot"; x: number; y: number };

/** Raio das marcas pintadas, em unidades de campo. */
export const PITCH_SPOT_RADIUS = 0.34;

/** Proporção oficial do gramado. O campo do editor a respeita em vez de esticar na tela. */
export const PITCH_RATIO = FIELD.width / FIELD.height;

const buildMarkings = (): PitchMark[] => {
  const middle = FIELD.height / 2;
  const marks: PitchMark[] = [
    { kind: "rect", x: 0, y: 0, width: FIELD.width, height: FIELD.height },
    { kind: "line", x1: FIELD.width / 2, y1: 0, x2: FIELD.width / 2, y2: FIELD.height },
    { kind: "circle", x: FIELD.width / 2, y: middle, radius: FIELD.centerCircleRadius },
    { kind: "spot", x: FIELD.width / 2, y: middle },
  ];

  for (const side of [0, FIELD.width]) {
    const direction = side === 0 ? 1 : -1;
    const box = (depth: number, boxWidth: number): PitchMark => ({
      kind: "rect",
      x: direction > 0 ? side : side - depth,
      y: (FIELD.height - boxWidth) / 2,
      width: depth,
      height: boxWidth,
    });
    marks.push(box(FIELD.penaltyDepth, FIELD.penaltyWidth));
    marks.push(box(FIELD.goalAreaDepth, FIELD.goalAreaWidth));

    const spotX = side + direction * FIELD.penaltySpotDistance;
    marks.push({ kind: "spot", x: spotX, y: middle });

    // A meia-lua é o pedaço do círculo de 9,15 m que sobra fora da grande área, por isso o
    // ângulo sai da distância entre a marca do pênalti e a linha da área.
    const arcReach = FIELD.penaltyDepth - FIELD.penaltySpotDistance;
    if (arcReach < FIELD.centerCircleRadius) {
      const half = Math.acos(arcReach / FIELD.centerCircleRadius);
      const axis = direction > 0 ? 0 : Math.PI;
      marks.push({ kind: "arc", x: spotX, y: middle, radius: FIELD.centerCircleRadius, from: axis - half, to: axis + half });
    }
  }

  // Arcos de escanteio: um quarto de círculo em cada quina, virado para dentro.
  for (const cornerX of [0, FIELD.width]) {
    for (const cornerY of [0, FIELD.height]) {
      const towardsCenterX = cornerX === 0 ? 1 : -1;
      const towardsCenterY = cornerY === 0 ? 1 : -1;
      const start = towardsCenterX > 0
        ? (towardsCenterY > 0 ? 0 : -Math.PI / 2)
        : (towardsCenterY > 0 ? Math.PI / 2 : Math.PI);
      marks.push({ kind: "arc", x: cornerX, y: cornerY, radius: FIELD.cornerArcRadius, from: start, to: start + Math.PI / 2 });
    }
  }

  return marks;
};

export const PITCH_MARKINGS: readonly PitchMark[] = buildMarkings();

const onCircle = (mark: Extract<PitchMark, { kind: "arc" }>, angle: number): string =>
  `${mark.x + mark.radius * Math.cos(angle)} ${mark.y + mark.radius * Math.sin(angle)}`;

const svgMark = (mark: PitchMark): Html => {
  switch (mark.kind) {
    case "rect":
      return html`<rect x="${mark.x}" y="${mark.y}" width="${mark.width}" height="${mark.height}" />`;
    case "line":
      return html`<line x1="${mark.x1}" y1="${mark.y1}" x2="${mark.x2}" y2="${mark.y2}" />`;
    case "circle":
      return html`<circle cx="${mark.x}" cy="${mark.y}" r="${mark.radius}" />`;
    case "spot":
      return html`<circle class="is-spot" cx="${mark.x}" cy="${mark.y}" r="${PITCH_SPOT_RADIUS}" />`;
    default:
      // Sentido do arco igual ao do canvas: ângulo crescente, com o eixo y para baixo.
      return html`<path d="M ${onCircle(mark, mark.from)} A ${mark.radius} ${mark.radius} 0 ${mark.to - mark.from > Math.PI ? 1 : 0} 1 ${onCircle(mark, mark.to)}" />`;
  }
};

/** As mesmas marcações como SVG, para quem desenha o gramado sem canvas. */
export const pitchMarkingsSvg = (): Html => html`
  <svg class="pitch-lines" viewBox="0 0 ${FIELD.width} ${FIELD.height}" aria-hidden="true">
    ${PITCH_MARKINGS.map(svgMark)}
  </svg>`;
