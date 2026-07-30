import { describe, expect, it } from "vitest";
import { FIELD } from "./config";
import { pitchValue } from "./runtime/pitch-value";
import type { Vec2 } from "./model";

const at = (fractionX: number, fractionY: number): Vec2 =>
  ({ x: FIELD.width * fractionX, y: FIELD.height * fractionY });

/**
 * A superfície de valor de posse. O que este teste trava não são números, e sim as **propriedades
 * pelas quais ela existe** — cravar valores prenderia a próxima calibragem.
 *
 * A propriedade decisiva é a última: um passe seguro para trás tem de VENCER uma bola arriscada
 * para frente. Era exatamente o que a régua antiga não fazia (o piso do progresso valia −0,8, então
 * recuar era punido), e é o defeito que esta superfície existe para corrigir.
 */
describe("valor de posse do gramado", () => {
  it("cresce em direção ao gol atacado e é simétrica entre os times", () => {
    const own = pitchValue("blue", at(0.1, 0.5));
    const middle = pitchValue("blue", at(0.5, 0.5));
    const finalThird = pitchValue("blue", at(0.7, 0.5));
    const box = pitchValue("blue", at(0.9, 0.5));
    expect(own).toBeLessThan(middle);
    expect(middle).toBeLessThan(finalThird);
    expect(finalThird).toBeLessThan(box);

    // O mesmo palmo de grama, pelos dois lados: o meio vale igual, e o terço de um é o do outro.
    expect(pitchValue("coral", at(0.5, 0.5))).toBeCloseTo(pitchValue("blue", at(0.5, 0.5)), 6);
    expect(pitchValue("coral", at(0.25, 0.5))).toBeCloseTo(pitchValue("blue", at(0.75, 0.5)), 6);
  });

  it("paga o miolo mais que a ponta na mesma altura", () => {
    expect(pitchValue("blue", at(0.8, 0.5))).toBeGreaterThan(pitchValue("blue", at(0.8, 0.06)));
  });

  it("mantém a escala do futebol: o meio-campo vale uma fração da área", () => {
    const ratio = pitchValue("blue", at(0.5, 0.5)) / pitchValue("blue", at(0.96, 0.5));
    // Com o desconto por ação frouxo o meio valia um terço da pequena área, e aí toda bola à frente
    // compensava qualquer risco. O futebol paga cerca de um décimo.
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.25);
  });

  it("faz o recuo seguro valer mais que a bola arriscada à frente", () => {
    // A conta é o valor do estado que resulta: chega e é nossa, ou não chega e é deles ali.
    const score = (target: Vec2, completion: number): number =>
      completion * pitchValue("blue", target) - (1 - completion) * pitchValue("coral", target);
    const from = at(0.35, 0.5);
    const back = { x: from.x - FIELD.unitsPerMeter * 15, y: from.y };
    const forward = { x: from.x + FIELD.unitsPerMeter * 20, y: from.y };

    expect(score(back, 0.97)).toBeGreaterThan(score(forward, 0.45));
    // E não é aversão ao risco: a MESMA bola à frente, agora com corredor limpo, ganha de longe.
    expect(score(forward, 0.85)).toBeGreaterThan(score(back, 0.97));
  });
});
