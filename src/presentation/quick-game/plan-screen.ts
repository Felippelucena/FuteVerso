import type { CommandError, GameApplication } from "../../application/game-application";
import type { MatchSetup } from "../../application/match/build-match-config";
import type { Club } from "../../domain/club/model";
import type { PlayerProfile } from "../../domain/roster/model";
import type { Team } from "../../domain/shared/model";
import type { TeamTacticalPlan } from "../../domain/tactics/model";
import { createEmptyPlan } from "../../domain/tactics/rules";
import { find, findAll } from "../app/dom";
import { html, type Html } from "../app/html";
import { icon } from "../app/icons";
import type { Navigation, Screen, ScreenDefinition } from "../app/screen";
import { PlanEditor } from "../tactics/plan-editor";

const TEAM_LABELS: Record<Team, string> = { blue: "Casa", coral: "Visitante" };

const planTemplate = (): Html => html`
  <section data-screen="quick-plan" class="plan-view">
    <div class="manager-heading">
      <div><span class="eyebrow">JOGO RÁPIDO</span><h2>Plano tático</h2></div>
      <button type="button" class="primary-button" id="plan-start">${icon("Play")}Iniciar partida</button>
    </div>
    <div class="plan-teams" role="tablist" aria-label="Time a editar">
      ${(["blue", "coral"] as const).map((team) => html`
        <button type="button" role="tab" data-team="${team}" class="${team === "blue" ? "is-active" : ""}"
          aria-selected="${team === "blue" ? "true" : "false"}">
          <span class="club-crest" data-crest="${team}"></span><strong data-club="${team}">${TEAM_LABELS[team]}</strong>
        </button>`)}
    </div>
    <p id="plan-message" class="manager-message" aria-live="polite"></p>
    <div id="plan-editor-host"></div>
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
 * por uma partida. O campo, as listas e os controles são o `PlanEditor` — o mesmo componente da
 * aba do clube e o da beira do gramado; aqui só existe um por vez, alternado pelas abas de time.
 */
export class PlanScreen implements Screen {
  private readonly plans: Partial<Record<Team, TeamTacticalPlan>> = {};
  private readonly squads: Record<Team, PlayerProfile[]> = { blue: [], coral: [] };
  private team: Team = "blue";
  private readonly editor: PlanEditor;

  constructor(
    private readonly root: HTMLElement,
    private readonly params: Readonly<Record<string, string>>,
    private readonly navigation: Navigation,
    private readonly application: GameApplication,
  ) {
    this.editor = new PlanEditor(this.find("#plan-editor-host"), {
      plan: () => this.plans[this.team] ?? createEmptyPlan(),
      squad: () => this.squads[this.team],
      changed: (plan) => { this.plans[this.team] = plan; },
    });
    for (const button of findAll<HTMLButtonElement>(this.root, "[data-team]")) {
      button.addEventListener("click", () => this.selectTeam(button.dataset.team as Team));
    }
    this.find("#plan-start").addEventListener("click", () => this.start());
  }

  render(): void {
    void this.load();
  }

  /** Só os dois elencos saem do catálogo — a tela não conhece o tamanho do resto. */
  private async load(): Promise<void> {
    for (const team of ["blue", "coral"] as const) {
      const club = await this.application.queries.clubs.get(this.params[team]);
      this.squads[team] = club ? (await this.application.squadOfClub(club.id)).players : [];
      this.plans[team] ??= structuredClone(club?.defaultPlan ?? createEmptyPlan());
      this.renderTab(team, club);
    }
    this.editor.render();
  }

  private renderTab(team: Team, club: Club | null): void {
    this.find(`[data-club="${team}"]`).textContent = `${TEAM_LABELS[team]} · ${club?.name ?? "—"}`;
    const crest = this.find<HTMLElement>(`[data-crest="${team}"]`);
    crest.style.setProperty("--crest", club?.colors.primary ?? "transparent");
    crest.style.setProperty("--crest-alt", club?.colors.secondary ?? "transparent");
  }

  private selectTeam(team: Team): void {
    this.team = team;
    for (const button of findAll<HTMLButtonElement>(this.root, "[data-team]")) {
      const active = button.dataset.team === team;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    }
    this.editor.render();
  }

  private start(): void {
    if (!this.plans.blue || !this.plans.coral) return;
    const setup: MatchSetup = {
      blue: { clubId: this.params.blue, plan: this.plans.blue },
      coral: { clubId: this.params.coral, plan: this.plans.coral },
    };
    void this.application.startMatch(setup).then((result) => {
      if (!result.ok) {
        this.setMessage(commandMessage(result.reason), true);
        return;
      }
      this.navigation.push({ screenId: "match" });
    });
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
