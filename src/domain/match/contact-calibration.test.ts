import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { createMatchState, stepMatch } from "./index";

/**
 * Rede de segurança da reformulação do contato: o motor não pode virar nem um jogo sem disputa nem
 * um festival de desarmes. As faixas são LARGAS de propósito — cerca de 1/3 a 3× do que o motor
 * produzia quando foram escritas. Elas pegam regressão grosseira (contato que parou de acontecer,
 * ou que passou a decidir tudo) sem travar a calibragem fina da próxima mudança.
 *
 * Se um ajuste deliberado estourar uma faixa, mova a faixa e diga por quê — é para isso que ela
 * serve. O que ela não pode é falhar sem ninguém entender o motivo.
 */
const SEEDS = [12_345, 98_765];
const MATCH_SECONDS = 60;

describe("calibragem do contato", () => {
  it("mantém disputa, desarme e troca de posse em faixas plausíveis", () => {
    const totals = { tacklesAttempted: 0, tacklesWon: 0, sprintDribbles: 0, turnoversWon: 0, fouls: 0 };
    for (const seed of SEEDS) {
      const state = createMatchState(referenceMatchConfig(seed));
      for (let tick = 0; tick < MATCH_SECONDS * 120; tick += 1) stepMatch(state, 1 / 120);
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
        totals[key] += state.stats.blue[key] + state.stats.coral[key];
      }
    }

    // Invariante estrutural: não se ganha um desarme que não se tentou.
    expect(totals.tacklesWon).toBeLessThanOrEqual(totals.tacklesAttempted);
    // Os corpos se encontram, e às vezes a bola muda de dono por causa disso.
    expect(totals.tacklesAttempted).toBeGreaterThanOrEqual(6);
    expect(totals.tacklesAttempted).toBeLessThanOrEqual(70);
    expect(totals.tacklesWon).toBeGreaterThanOrEqual(1);
    // Alguém ainda avança com a bola em vez de só trombar.
    expect(totals.sprintDribbles).toBeGreaterThanOrEqual(12);
    expect(totals.sprintDribbles).toBeLessThanOrEqual(120);
    // E a posse circula entre os times.
    expect(totals.turnoversWon).toBeGreaterThanOrEqual(5);
    expect(totals.turnoversWon).toBeLessThanOrEqual(60);
    // Falta é exceção, não o jeito normal de recuperar a bola. Sem piso: em dois minutos de jogo
    // é legítimo não sair nenhuma, e é `foul.test` que garante que o mecanismo funciona. O teto é
    // que importa aqui — o dia em que o jogo virar uma sequência de tiros livres, este teste avisa.
    expect(totals.fouls).toBeLessThanOrEqual(12);
  }, 120_000);
});
