import type { GameApplication } from "../../application/game-application";
import { find, render } from "../app/dom";
import { html, type Html } from "../app/html";
import { formatMatchClock } from "../app/labels";
import { teamNamesOf } from "./team-names";

const template = (): Html => html`
  <section class="scoreboard" aria-label="Placar">
    <div class="score-team score-team--blue"><span id="score-name-blue">CASA</span><strong id="score-blue">0</strong></div>
    <div class="match-clock"><span id="match-time">00:00</span><small id="match-state">EM CURSO</small></div>
    <div class="score-team score-team--coral"><strong id="score-coral">0</strong><span id="score-name-coral">VISITANTE</span></div>
  </section>
  <div class="simulation-status"><span class="live-dot"></span><span id="simulation-state">SIMULAÇÃO ATIVA</span></div>`;

/**
 * Status da sessão, não conteúdo de tela: por isso é o laço que o atualiza, e não a tela ativa.
 * Fora da partida o navegador esconde a faixa inteira — aqui basta não ter o que dizer.
 */
export class MatchHeader {
  constructor(
    private readonly slot: HTMLElement,
    private readonly application: GameApplication,
  ) {
    render(slot, template());
  }

  render(): void {
    const match = this.application.match;
    if (!match) return;
    const state = match.state;
    const names = teamNamesOf(this.application);
    const paused = match.paused;
    this.find("#score-blue").textContent = String(state.stats.blue.goals);
    this.find("#score-coral").textContent = String(state.stats.coral.goals);
    this.find("#score-name-blue").textContent = names.blue;
    this.find("#score-name-coral").textContent = names.coral;
    this.find("#match-time").textContent = formatMatchClock(state);
    this.find("#match-state").textContent = state.finished
      ? "ENCERRADA"
      : state.stoppage.awaitingEnd ? "ACRÉSCIMOS" : `${state.half}º TEMPO`;
    this.find("#simulation-state").textContent = paused ? "SIMULAÇÃO PAUSADA" : "SIMULAÇÃO ATIVA";
    this.find(".live-dot").classList.toggle("is-paused", paused);
  }

  private find<T extends HTMLElement>(selector: string): T {
    return find<T>(this.slot, selector);
  }
}
