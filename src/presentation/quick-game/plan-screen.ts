import type { CommandError, GameApplication } from "../../application/game-application";
import type { MatchSetup } from "../../application/match/build-match-config";
import type { PlayerProfile } from "../../domain/roster/model";
import type { Team } from "../../domain/shared/model";
import type { TeamTacticalPlan } from "../../domain/tactics/model";
import { autoPickPlan } from "../../domain/tactics/auto-lineup";
import { defaultFormation, findFormation } from "../../domain/tactics/formations";
import { createEmptyPlan, orderedAssignments } from "../../domain/tactics/rules";
import { findSlot } from "../../domain/tactics/slots";
import { find, render } from "../app/dom";
import { html, type Html } from "../app/html";
import { icon } from "../app/icons";
import { POSITION_SHORT_LABELS } from "../app/labels";
import type { Navigation, Screen, ScreenDefinition } from "../app/screen";

const TEAM_LABELS: Record<Team, string> = { blue: "Casa", coral: "Visitante" };

const planTemplate = (): Html => html`
  <section data-screen="quick-plan" class="plan-view">
    <div class="manager-heading">
      <div><span class="eyebrow">JOGO RÁPIDO</span><h2>Plano tático</h2></div>
      <button type="button" class="primary-button" id="plan-start">${icon("Play")}Iniciar partida</button>
    </div>
    <p id="plan-message" class="manager-message" aria-live="polite"></p>
    <div class="plan-grid">
      ${(["blue", "coral"] as const).map((team) => html`
        <div class="plan-column plan-column--${team}">
          <div class="section-heading">
            <h3 id="plan-club-${team}">${TEAM_LABELS[team]}</h3>
            <button type="button" class="secondary-button" data-auto-pick="${team}">${icon("Wand2")}Escalação automática</button>
          </div>
          <div class="plan-lineup" id="plan-lineup-${team}"></div>
        </div>`)}
    </div>
  </section>`;

const commandMessage = (reason: CommandError): string => {
  if (reason === "same-club") return "Os dois lados não podem ser o mesmo clube.";
  if (reason === "club-not-found") return "Um dos clubes não existe mais.";
  if (reason === "invalid-plan") return "A escalação de um dos times está incompleta.";
  return "Não foi possível iniciar a partida.";
};

export const planScreenDefinition = (application: GameApplication): ScreenDefinition => ({
  id: "quick-plan",
  label: "Plano tático",
  icon: "SlidersHorizontal",
  template: planTemplate,
  mount: ({ root, params, navigation }) => new PlanScreen(root, params, navigation, application),
});

/**
 * Edita o plano dos dois times antes do apito. Os planos são cópias: o clube nunca é alterado
 * por uma partida. O campo com slots e o arrasto chegam na fase seguinte — a estrutura que os
 * receberá (uma cópia editável por time, entregue a `startMatch`) já é esta.
 */
export class PlanScreen implements Screen {
  private readonly plans: Record<Team, TeamTacticalPlan>;

  constructor(
    private readonly root: HTMLElement,
    private readonly params: Readonly<Record<string, string>>,
    private readonly navigation: Navigation,
    private readonly application: GameApplication,
  ) {
    this.plans = {
      blue: structuredClone(this.clubOf("blue")?.defaultPlan ?? createEmptyPlan()),
      coral: structuredClone(this.clubOf("coral")?.defaultPlan ?? createEmptyPlan()),
    };
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-auto-pick]")) {
      button.addEventListener("click", () => this.autoPick(button.dataset.autoPick as Team));
    }
    this.find("#plan-start").addEventListener("click", () => this.start());
  }

  render(): void {
    for (const team of ["blue", "coral"] as const) {
      const club = this.clubOf(team);
      this.find(`#plan-club-${team}`).textContent = `${TEAM_LABELS[team]} · ${club?.name ?? "—"}`;
      this.renderLineup(team);
    }
  }

  private renderLineup(team: Team): void {
    const squad = new Map(this.squadOf(team).map((player) => [player.id, player]));
    const plan = this.plans[team];
    const formation = plan.formationId ? findFormation(plan.formationId) : null;
    render(this.find(`#plan-lineup-${team}`), html`
      <div class="plan-formation">${formation?.name ?? "Personalizada"}</div>
      ${orderedAssignments(plan).map((assignment) => {
        const player = squad.get(assignment.playerId);
        const slot = findSlot(assignment.slotId);
        return html`<div class="plan-row">
          <span class="plan-slot">${slot?.label ?? assignment.slotId}</span>
          <strong>${player?.name ?? "—"}</strong>
          <span class="plan-position">${player ? POSITION_SHORT_LABELS[player.position] : ""}</span>
        </div>`;
      })}
      <div class="plan-bench"><small>RESERVAS</small>${plan.bench.length === 0 ? "nenhum" : plan.bench
        .map((playerId) => squad.get(playerId)?.name ?? "—").join(" · ")}</div>`);
  }

  private autoPick(team: Team): void {
    const plan = this.plans[team];
    // Reescalar mantém a formação do plano; só o preenchimento dos slots é refeito.
    const formation = (plan.formationId ? findFormation(plan.formationId) : null) ?? defaultFormation();
    this.plans[team] = autoPickPlan(this.squadOf(team), formation, plan);
    this.render();
  }

  private start(): void {
    const setup: MatchSetup = {
      blue: { clubId: this.params.blue, plan: this.plans.blue },
      coral: { clubId: this.params.coral, plan: this.plans.coral },
    };
    const result = this.application.startMatch(setup);
    if (!result.ok) {
      this.setMessage(commandMessage(result.reason), true);
      return;
    }
    this.navigation.push({ screenId: "match" });
  }

  private clubOf(team: Team) {
    return this.application.world.clubs.find(({ id }) => id === this.params[team]) ?? null;
  }

  private squadOf(team: Team): PlayerProfile[] {
    const club = this.clubOf(team);
    return club ? this.application.squadOfClub(club.id) : [];
  }

  private setMessage(message: string, error = false): void {
    const element = this.find("#plan-message");
    element.textContent = message;
    element.classList.toggle("is-error", error);
  }

  private find<T extends HTMLElement>(selector: string): T {
    return find<T>(this.root, selector);
  }
}
